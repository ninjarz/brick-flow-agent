/**
 * Deterministic executor for the agentic build loop (see
 * .agents/design/agentic-build-loop.md). It applies one model action to a
 * build and only ever accepts placements that pass collision and support
 * checks, so the build stays valid after every turn. No LLM is involved here.
 */
import { brickById, brickDefinitions, colorHex } from '../../data/basicBricks'
import { hogwartsExactColors } from '../../data/hogwartsExactColors'
import type { BrickColor, PlacedBrick } from '../../types/bricks'
import { canonicalColorId, canonicalColorIds, resolveColorId, resolvePartColor } from '../colorIds'
import { expandAssemblyProgram } from '../llmAssembly'
import { createBrickCollisionIndex, createBuildGraph, getBrickBounds, hasBrickCollision, isBrickSupported, makeBrick } from '../planUtils'
import { compileDetailPrimitive, detailPrimitiveKinds, type DetailPrimitiveKind } from './primitives'

export type AgentPart = {
  brickId: string
  color: string
  x: number
  z: number
  /** Bottom height in studs. Omit to drop the part onto the highest support under it. */
  y?: number
  rotation?: number
  repeat?: { count: number; dx?: number; dz?: number; dy?: number }
}

export type AgentPrimitive = {
  kind: 'deck' | 'walls' | 'wall' | 'stepped-roof' | DetailPrimitiveKind
  x: number
  z: number
  y?: number
  [parameter: string]: unknown
}

export type AgentItem = AgentPart | AgentPrimitive

export type AgentAction =
  | { action: 'place'; items: AgentItem[]; done?: boolean }
  | { action: 'remove'; ids: string[] }
  | { action: 'done'; note?: string }

export type Rejection = { item: number; reason: string; part?: string; at?: number[]; candidates?: number[][] }
export type ColorSubstitution = { item: number; requested: string; used: string }

export type ActionResult = {
  ok: boolean
  placed: number
  placedIds: string[]
  removed: number
  rejected: Rejection[]
  colorSubstitutions: ColorSubstitution[]
  error?: string
}

export type BuildState = { bricks: PlacedBrick[]; nextId: number }

export const createBuildState = (bricks: PlacedBrick[] = []): BuildState => ({ bricks: [...bricks], nextId: bricks.length + 1 })

const epsilon = 1e-6
const plateHeight = 0.4
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// ---------------------------------------------------------------- parsing

/** Validates the shape of a model response. Throws with a message meant to be sent back to the model. */
export const parseAgentAction = (value: unknown): AgentAction => {
  if (!record(value) || typeof value.action !== 'string') throw new Error('Return one JSON object with an "action" field: place, remove or done.')
  if (value.action === 'done') return { action: 'done', ...(typeof value.note === 'string' ? { note: value.note } : {}) }
  if (value.action === 'remove') {
    if (!Array.isArray(value.ids) || !value.ids.every(id => typeof id === 'string')) throw new Error('remove needs "ids": an array of part ids.')
    return { action: 'remove', ids: value.ids as string[] }
  }
  if (value.action === 'place') {
    const items = value.items ?? value.parts
    if (!Array.isArray(items) || items.length === 0) throw new Error('place needs a non-empty "items" array.')
    if (items.length > 80) throw new Error('Place at most 80 items per turn.')
    return { action: 'place', items: items as AgentItem[], ...(value.done === true ? { done: true } : {}) }
  }
  throw new Error(`Unknown action "${value.action}". Use place, remove or done.`)
}

// ---------------------------------------------------------------- geometry

const bodyHeight = (brick: PlacedBrick) => brickById.get(brick.brickId)?.footprint.heightStuds ?? 1.2

/** Height of the surface a part rests on: the top of its body, not of its studs. */
export const getBrickTop = (brick: PlacedBrick) => {
  const bounds = getBrickBounds(brick)
  return bounds ? bounds.minY + bodyHeight(brick) : 0
}

const overlapsXZ = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
  a.minX < b.maxX - epsilon && a.maxX > b.minX + epsilon && a.minZ < b.maxZ - epsilon && a.maxZ > b.minZ + epsilon

/** The highest body top under a footprint, or 0 for bare ground. */
const dropHeight = (footprints: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>, bricks: PlacedBrick[]) => {
  let height = 0
  for (const brick of bricks) {
    const bounds = getBrickBounds(brick)
    if (!bounds || !footprints.some(footprint => overlapsXZ(footprint, bounds))) continue
    height = Math.max(height, getBrickTop(brick))
  }
  return Math.round(height / plateHeight) * plateHeight
}

// ---------------------------------------------------------------- colours

const hexOf = (color: string) => (colorHex as Record<string, string>)[color]
  ?? (hogwartsExactColors as Record<string, { hex: string }>)[color]?.hex
const rgb = (hex: string | undefined) => {
  const match = hex && /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) return undefined
  const value = parseInt(match[1], 16)
  return [value >> 16 & 255, value >> 8 & 255, value & 255]
}

/** The colour of the given ones closest to the requested colour, by RGB distance. */
export const nearestColor = (requested: string, available: readonly string[]): string | undefined => {
  // Resolve loose names first: "dark brown" is only known as an LDraw code.
  const resolved = resolveColorId(requested)
  const target = rgb(hexOf(requested) ?? (resolved ? hexOf(resolved) ?? hexOf(canonicalColorId(resolved)) : undefined))
  if (!available.length) return undefined
  // Keep transparency: an opaque request should not become glass, and vice versa.
  const wantsTransparent = canonicalColorId(requested).startsWith('trans-')
  const sameKind = available.filter(color => canonicalColorId(color).startsWith('trans-') === wantsTransparent)
  const pool = sameKind.length ? sameKind : available
  if (!target) return pool[0]
  let best = pool[0]
  let bestDistance = Infinity
  for (const color of pool) {
    const value = rgb(hexOf(color))
    if (!value) continue
    // Weighted RGB distance approximates perceived difference.
    const distance = 2 * (value[0] - target[0]) ** 2 + 4 * (value[1] - target[1]) ** 2 + 3 * (value[2] - target[2]) ** 2
    if (distance < bestDistance) { bestDistance = distance; best = color }
  }
  return best
}

/** A colour the part really carries: the requested one when possible, otherwise the nearest. */
const partColor = (brickId: string, requested: string): { color: BrickColor; substituted: boolean } | undefined => {
  const definition = brickById.get(brickId)
  if (!definition) return undefined
  const exact = resolvePartColor(definition.colors, requested)
  if (exact) return { color: exact, substituted: false }
  const nearest = nearestColor(requested, definition.colors)
  return nearest ? { color: nearest as BrickColor, substituted: true } : undefined
}

/** Parts each primitive is compiled from; a colour must exist on all of them. */
const primitiveParts: Record<AgentPrimitive['kind'], string[]> = {
  deck: ['plate-1x1', 'plate-1x2', 'plate-1x3', 'plate-1x4', 'plate-2x2', 'plate-2x3', 'plate-2x4'],
  walls: ['brick-1x1', 'brick-1x2'],
  wall: ['brick-1x1', 'brick-1x2'],
  'stepped-roof': ['brick-1x1', 'brick-1x2'],
  // Detail primitives colour each part on its own; these list what the prompt shows.
  'slope-roof': ['slope-2x2', 'slope-1x2'],
  tree: ['plate-1x2', 'plate-2x2'],
  fence: ['brick-round-1x1', 'plate-1x2'],
  tiles: ['tile-1x1', 'tile-1x2'],
  scatter: ['round-1x1-plate'],
}

const isDetailKind = (kind: string): kind is DetailPrimitiveKind => (detailPrimitiveKinds as readonly string[]).includes(kind)

const sharedColors = (partIds: string[]) => {
  const [first, ...rest] = partIds.map(id => canonicalColorIds(brickById.get(id)?.colors ?? []))
  return (first ?? []).filter(color => rest.every(colors => colors.includes(color)))
}

/** Colours each primitive can use as-is, for the prompt. */
export const getPrimitiveColors = () => Object.fromEntries(
  (Object.keys(primitiveParts) as AgentPrimitive['kind'][]).map(kind => [kind, sharedColors(primitiveParts[kind])]),
) as Record<AgentPrimitive['kind'], string[]>

const primitiveColor = (kind: AgentPrimitive['kind'], requested: unknown) => {
  if (typeof requested !== 'string') return { color: requested, substituted: false }
  const parts = primitiveParts[kind]
  if (parts.every(id => resolvePartColor(brickById.get(id)?.colors ?? [], requested))) return { color: requested, substituted: false }
  const nearest = nearestColor(requested, sharedColors(parts))
  return nearest ? { color: nearest, substituted: true } : { color: requested, substituted: false }
}

// ---------------------------------------------------------------- placement

type Check = { ok: true } | { ok: false; reason: string }

const checkPlacement = (brick: PlacedBrick, bricks: PlacedBrick[]): Check => {
  const bounds = getBrickBounds(brick)
  if (!bounds) return { ok: false, reason: 'unknown part geometry' }
  if (bounds.minY < -epsilon) return { ok: false, reason: 'below ground' }
  if (hasBrickCollision(brick, bricks)) return { ok: false, reason: 'collides with an existing part' }
  if (bounds.minY > epsilon && !isBrickSupported(brick, bricks)) return { ok: false, reason: 'not supported: nothing to connect to below it' }
  return { ok: true }
}

const assignId = (state: BuildState, brick: PlacedBrick): PlacedBrick => ({ ...brick, id: `p${state.nextId++}` })

const isPrimitive = (item: AgentItem): item is AgentPrimitive => record(item) && typeof (item as AgentPrimitive).kind === 'string'

/** Nearby positions where a single part would be accepted, for rejected placements. */
const findCandidates = (brickId: string, color: BrickColor, x: number, z: number, rotation: number, bricks: PlacedBrick[]) => {
  const found: number[][] = []
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
    const probe = makeBrick(brickId, color, x + dx, 0, z + dz, rotation)
    const footprint = getBrickBounds(probe)
    if (!footprint) continue
    const y = dropHeight([footprint], bricks)
    const candidate = makeBrick(brickId, color, x + dx, y, z + dz, rotation)
    if (checkPlacement(candidate, bricks).ok) found.push([x + dx, y, z + dz])
    if (found.length >= 3) break
  }
  return found
}

const placePart = (state: BuildState, part: AgentPart, index: number, result: ActionResult) => {
  if (typeof part.brickId !== 'string' || !brickById.get(part.brickId) || brickById.get(part.brickId)!.pack !== 'lego') {
    result.rejected.push({ item: index, reason: `unknown brickId ${String(part.brickId)}` })
    return
  }
  if (!finite(part.x) || !finite(part.z) || (part.y !== undefined && !finite(part.y))) {
    result.rejected.push({ item: index, reason: 'x and z must be numbers (y optional)' })
    return
  }
  const rotation = finite(part.rotation) ? ((Math.round(part.rotation) % 4) + 4) % 4 : 0
  const colored = partColor(part.brickId, String(part.color))
  if (!colored) { result.rejected.push({ item: index, reason: 'part has no colours' }); return }
  if (colored.substituted) result.colorSubstitutions.push({ item: index, requested: String(part.color), used: canonicalColorId(colored.color) })
  const count = part.repeat && finite(part.repeat.count) ? Math.max(1, Math.min(64, Math.round(part.repeat.count))) : 1
  for (let copy = 0; copy < count; copy++) {
    const x = part.x + copy * (part.repeat?.dx ?? 0)
    const z = part.z + copy * (part.repeat?.dz ?? 0)
    const probe = makeBrick(part.brickId, colored.color, x, 0, z, rotation)
    const footprint = getBrickBounds(probe)
    const y = part.y !== undefined ? part.y + copy * (part.repeat?.dy ?? 0) : footprint ? dropHeight([footprint], state.bricks) : 0
    const brick = makeBrick(part.brickId, colored.color, x, y, z, rotation)
    const check = checkPlacement(brick, state.bricks)
    if (check.ok === false) {
      result.rejected.push({
        item: index, reason: check.reason, part: part.brickId, at: [x, y, z],
        candidates: findCandidates(part.brickId, colored.color, x, z, rotation, state.bricks),
      })
      continue
    }
    const placed = assignId(state, brick)
    state.bricks.push(placed)
    result.placed++
    result.placedIds.push(placed.id)
  }
}

/**
 * Accepts a group of parts only if none collides and, once all are placed,
 * every one is connected to the ground (parts of a group may hold each other).
 */
const acceptGroup = (state: BuildState, kind: string, bricks: PlacedBrick[], index: number, result: ActionResult) => {
  const trial = [...state.bricks, ...bricks]
  const collisionIndex = createBrickCollisionIndex(trial)
  const at = (brick: PlacedBrick) => { const bounds = getBrickBounds(brick); return bounds ? [bounds.minX, bounds.minY, bounds.minZ] : undefined }
  for (const brick of bricks) {
    const bounds = getBrickBounds(brick)
    const reason = !bounds ? 'unknown part geometry' : bounds.minY < -epsilon ? 'below ground' : hasBrickCollision(brick, trial, collisionIndex) ? 'collides with another part' : undefined
    if (reason) { result.rejected.push({ item: index, reason: `${kind}: ${reason}`, part: brick.brickId, at: at(brick) }); return false }
  }
  const grounded = createBuildGraph(trial).groundedIds
  const floating = bricks.filter(brick => !grounded.has(brick.id))
  if (floating.length) {
    result.rejected.push({ item: index, reason: `${kind}: ${floating.length} of its parts would not connect to anything below; place it on a surface that covers its footprint`, part: floating[0].brickId, at: at(floating[0]) })
    return false
  }
  for (const brick of bricks) {
    const placed = assignId(state, brick)
    state.bricks.push(placed)
    result.placedIds.push(placed.id)
  }
  result.placed += bricks.length
  return true
}

/** Roofs, trees, railings, tiles and planting: compiled to parts, coloured per part, dropped as one piece. */
const placeDetail = (state: BuildState, primitive: AgentPrimitive, kind: DetailPrimitiveKind, index: number, result: ActionResult) => {
  let parts
  try {
    parts = compileDetailPrimitive(kind, primitive, primitive.x, primitive.z)
  } catch (error) {
    result.rejected.push({ item: index, reason: error instanceof Error ? error.message.slice(0, 300) : String(error) })
    return
  }
  const substituted = new Map<string, string>()
  const colored = parts.flatMap(part => {
    const color = partColor(part.brickId, part.color)
    if (!color) return []
    if (color.substituted) substituted.set(part.color, canonicalColorId(color.color))
    return [{ ...part, color: color.color }]
  })
  for (const [requested, used] of substituted) result.colorSubstitutions.push({ item: index, requested, used })
  if (kind === 'scatter') {
    // Planting is loose: each piece lands where it can, occupied cells are
    // skipped, and only on the lowest surface of the region (the ground,
    // not roofs or walls that happen to lie inside it).
    const surface = (part: typeof colored[number]) => {
      const bounds = getBrickBounds(makeBrick(part.brickId, part.color, part.x, 0, part.z, part.rotation ?? 0))
      return bounds ? dropHeight([bounds], state.bricks) : Infinity
    }
    const heights = colored.map(surface)
    const ground = primitive.y ?? Math.min(...heights)
    const before = result.rejected.length
    for (const [position, part] of colored.entries()) {
      if (Math.abs(heights[position] - ground) > epsilon) continue
      placePart(state, { brickId: part.brickId, color: part.color, x: part.x, z: part.z, y: ground, rotation: part.rotation }, index, result)
    }
    const skipped = result.rejected.length - before
    result.rejected.splice(before)
    if (skipped && skipped === colored.length) result.rejected.push({ item: index, reason: 'scatter: no free cell in the region' })
    return
  }
  const toBricks = (y: number) => colored.map(part => makeBrick(part.brickId, part.color, part.x, y + part.y, part.z, part.rotation ?? 0))
  // Drop onto the highest support under the group's lowest layer.
  const y = primitive.y ?? dropHeight(toBricks(0).flatMap((brick, position) => {
    const bounds = getBrickBounds(brick)
    return bounds && colored[position].y < epsilon ? [bounds] : []
  }), state.bricks)
  acceptGroup(state, kind, toBricks(y).map((brick, position) => ({ ...brick, id: `trial-${position}` })), index, result)
}

/** Compiles a structural primitive and accepts it only if every part it produces is valid. */
const placePrimitive = (state: BuildState, primitive: AgentPrimitive, index: number, result: ActionResult) => {
  if (!finite(primitive.x) || !finite(primitive.z) || (primitive.y !== undefined && !finite(primitive.y))) {
    result.rejected.push({ item: index, reason: 'x and z must be numbers (y optional)' })
    return
  }
  if (!primitiveParts[primitive.kind]) { result.rejected.push({ item: index, reason: `unknown kind ${primitive.kind}` }); return }
  if (isDetailKind(primitive.kind)) { placeDetail(state, primitive, primitive.kind, index, result); return }
  const command: Record<string, unknown> = { ...primitive, at: [0, 0, 0] }
  delete command.x; delete command.y; delete command.z
  const main = primitiveColor(primitive.kind, primitive.color)
  command.color = main.color
  if (main.substituted) result.colorSubstitutions.push({ item: index, requested: String(primitive.color), used: String(main.color) })
  if (Array.isArray(primitive.openings)) {
    command.openings = primitive.openings.map(opening => {
      if (!record(opening)) return opening
      if (opening.part === 'window' && typeof opening.color === 'string') {
        // Window openings take real frames; the colour is the frame's.
        const frame = partColor('window-1x2x2', opening.color)
        if (frame?.substituted) result.colorSubstitutions.push({ item: index, requested: opening.color, used: canonicalColorId(frame.color) })
        return { ...opening, color: frame?.color ?? opening.color }
      }
      const mapped = primitiveColor(primitive.kind, opening.color)
      if (mapped.substituted) result.colorSubstitutions.push({ item: index, requested: String(opening.color), used: String(mapped.color) })
      return { ...opening, color: mapped.color }
    })
  }
  let bricks: PlacedBrick[]
  try {
    const expandAt = (y: number) => expandAssemblyProgram({ commands: [command] }, [primitive.x, y, primitive.z], {}, state.bricks)
    let y = primitive.y
    if (y === undefined) {
      // Drop onto whatever lies under the primitive's lowest layer.
      const bounds = expandAt(0).flatMap(brick => getBrickBounds(brick) ?? [])
      const lowest = Math.min(...bounds.map(box => box.minY))
      y = dropHeight(bounds.filter(box => Math.abs(box.minY - lowest) < epsilon), state.bricks)
    }
    bricks = expandAt(y)
  } catch (error) {
    result.rejected.push({ item: index, reason: error instanceof Error ? error.message.slice(0, 300) : String(error) })
    return
  }
  acceptGroup(state, primitive.kind, bricks, index, result)
}

/** Applies one action. The state is mutated; rejected items leave it unchanged. */
export const applyAgentAction = (state: BuildState, action: AgentAction, protectedIds?: ReadonlySet<string>): ActionResult => {
  const result: ActionResult = { ok: true, placed: 0, placedIds: [], removed: 0, rejected: [], colorSubstitutions: [] }
  if (action.action === 'done') return result
  if (action.action === 'remove') {
    const ids = new Set(action.ids)
    const rejectProtectedRemoval = () => {
      result.ok = false
      result.error = 'This removal would remove parts from a protected, completed structure.'
      result.rejected.push({ item: 0, reason: result.error })
      return result
    }
    if (action.ids.some(id => protectedIds?.has(id))) return rejectProtectedRemoval()
    // Removing a part can leave parts above it unsupported; remove those too.
    let removing = state.bricks.filter(brick => ids.has(brick.id))
    let remaining = state.bricks.filter(brick => !ids.has(brick.id))
    for (let changed = true; changed;) {
      changed = false
      for (const brick of remaining) {
        const bounds = getBrickBounds(brick)
        if (bounds && bounds.minY > epsilon && !isBrickSupported(brick, remaining.filter(other => other !== brick))) {
          removing = [...removing, brick]
          remaining = remaining.filter(other => other !== brick)
          changed = true
          break
        }
      }
    }
    if (removing.some(brick => protectedIds?.has(brick.id))) return rejectProtectedRemoval()
    // A removal that would bring down much more than was asked for is almost
    // always a mistake (an id of a load-bearing part): refuse it.
    const requested = removing.length && ids.size
    const cascade = removing.length - state.bricks.filter(brick => ids.has(brick.id)).length
    if (cascade > Math.max(12, requested * 2)) {
      result.ok = false
      result.error = `Removing ${[...ids].slice(0, 6).join(', ')} would also remove ${cascade} parts resting on them; nothing was removed. Remove only loose detail parts, or place new parts instead.`
      result.rejected.push({ item: 0, reason: result.error })
      return result
    }
    state.bricks = remaining
    result.removed = removing.length
    return result
  }
  for (const [index, item] of action.items.entries()) {
    if (!record(item)) { result.rejected.push({ item: index, reason: 'item must be an object' }); continue }
    if (isPrimitive(item)) placePrimitive(state, item, index, result)
    else placePart(state, item as AgentPart, index, result)
  }
  result.ok = result.rejected.length === 0
  return result
}

// ---------------------------------------------------------------- state summary

const heightSymbols = '0123456789abcdefghijklmnopqrstuvwxyz'

export type BuildSummary = {
  parts: number
  bounds?: { min: number[]; max: number[] }
  /** Top surface height in plates per stud cell, rows along +z, columns along +x. */
  heightMap?: { x0: number; z0: number; rows: string[]; legend: string }
  recent: Array<{ id: string; part: string; color: string; at: number[]; rotation: number }>
}

/** A compact view of the build for the model: extent, a top-surface height map and recent parts. */
export const summarizeBuild = (bricks: PlacedBrick[], recent = 24): BuildSummary => {
  if (!bricks.length) return { parts: 0, recent: [] }
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const tops: Array<{ bounds: NonNullable<ReturnType<typeof getBrickBounds>>; top: number }> = []
  for (const brick of bricks) {
    const bounds = getBrickBounds(brick)
    if (!bounds) continue
    min[0] = Math.min(min[0], bounds.minX); min[1] = Math.min(min[1], bounds.minY); min[2] = Math.min(min[2], bounds.minZ)
    max[0] = Math.max(max[0], bounds.maxX); max[1] = Math.max(max[1], bounds.maxY); max[2] = Math.max(max[2], bounds.maxZ)
    tops.push({ bounds, top: getBrickTop(brick) })
  }
  const x0 = Math.floor(min[0])
  const z0 = Math.floor(min[2])
  const width = Math.min(40, Math.ceil(max[0]) - x0)
  const depth = Math.min(40, Math.ceil(max[2]) - z0)
  const rows: string[] = []
  for (let z = 0; z < depth; z++) {
    let row = ''
    for (let x = 0; x < width; x++) {
      const cell = { minX: x0 + x, maxX: x0 + x + 1, minZ: z0 + z, maxZ: z0 + z + 1 }
      let top = 0
      for (const item of tops) if (overlapsXZ(cell, item.bounds)) top = Math.max(top, item.top)
      const plates = Math.round(top / plateHeight)
      row += top <= epsilon ? '.' : heightSymbols[Math.min(plates, heightSymbols.length - 1)]
    }
    rows.push(row)
  }
  const round = (value: number) => Math.round(value * 10) / 10
  return {
    parts: bricks.length,
    bounds: { min: min.map(round), max: max.map(round) },
    heightMap: { x0, z0, rows, legend: 'one char per stud cell: "." empty, digits/letters = top height in plates (3 plates = 1 brick = 1.2 studs; a=10, z=35)' },
    recent: bricks.slice(-recent).map(brick => ({
      id: brick.id, part: brick.brickId, color: canonicalColorId(brick.color),
      at: [round(brick.pose.xStud), round(brick.pose.yStud), round(brick.pose.zStud)], rotation: brick.pose.rotationQuarterTurns,
    })),
  }
}

// ---------------------------------------------------------------- catalogue

/** A short part list for the loop: common structural parts and their footprints. Colours are substituted automatically. */
export const formatAgentCatalogue = () => {
  const kinds = new Set(['brick', 'plate', 'tile', 'slope', 'round'])
  const parts = brickDefinitions.filter(definition => definition.pack === 'lego' && kinds.has(definition.kind)
    && !definition.id.startsWith('hogwarts-') && !definition.id.startsWith('architecture-') && !definition.id.endsWith('-nameplate')
    && !definition.id.includes('eye') && !definition.id.includes('clock'))
  const lines = parts.map(definition => `${definition.id} ${definition.footprint.widthStuds}x${definition.footprint.depthStuds}x${Math.round(definition.footprint.heightStuds / plateHeight)}p ${definition.kind}`)
  const colors = canonicalColorIds(brickById.get('brick-1x2')?.colors ?? []).filter(color => !color.startsWith('lego-'))
  return `Parts (id WxDxHeight-in-plates kind; W is along x at rotation 0, rotation 1/3 swaps W and D):\n${lines.join('\n')}\nCommon colours: ${colors.join(', ')}. Any other colour name is replaced by the nearest colour the part has.`
}
