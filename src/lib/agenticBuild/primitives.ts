/**
 * Detail primitives for the agentic build loop: real slope roofs, trees,
 * railings, tile surfaces and ground planting. Each compiles to plain parts
 * in world coordinates with y relative to the surface it rests on (0); the
 * executor drops the result onto that surface and validates every part.
 */
import { brickById } from '../../data/basicBricks'
import { resolvePartColor } from '../colorIds'

export type RelativePart = { brickId: string; color: string; x: number; y: number; z: number; rotation?: number }

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const integer = (value: unknown, min: number, max: number, label: string, fallback?: number) => {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`)
  return value
}
const size2 = (value: unknown, min: number, label: string): [number, number] => {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label} size must be [width, depth].`)
  return [integer(value[0], min, 40, `${label} width`), integer(value[1], min, 40, `${label} depth`)]
}
const colorList = (value: unknown, fallback: string[]) =>
  Array.isArray(value) && value.length ? value.filter((color): color is string => typeof color === 'string').slice(0, 6) : fallback
const carries = (brickId: string, color: string) => Boolean(resolvePartColor(brickById.get(brickId)?.colors ?? [], color))

/** Splits a length into pieces of the given sizes, largest first. */
const pieces = (length: number, sizes: number[]) => {
  const result: Array<[start: number, length: number]> = []
  let position = 0
  while (position < length) {
    const piece = sizes.find(size => size <= length - position) ?? 1
    result.push([position, piece])
    position += piece
  }
  return result
}

/**
 * Splits a run into near-equal pieces of at most 4, rotated by `shift` so
 * consecutive layers put their seams in different places. Never leaves a
 * 1-stud tail on runs longer than one.
 */
const evenRuns = (length: number, shift: number) => {
  const count = Math.ceil(length / 4)
  const sizes = Array.from({ length: count }, (_, index) => Math.floor(length / count) + (index < length % count ? 1 : 0))
  const offset = count > 1 ? shift % count : 0
  const ordered = [...sizes.slice(offset), ...sizes.slice(0, offset)]
  let position = 0
  return ordered.map(size => { const run: [number, number] = [position, size]; position += size; return run })
}

/** Deterministic pseudo-random sequence so a program always builds the same model. */
const random = (seed: number) => {
  let state = (seed >>> 0) || 1
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5
    return ((state >>> 0) % 100_000) / 100_000
  }
}
const seedOf = (...values: number[]) => values.reduce((hash, value) => Math.imul(hash ^ Math.round(value * 10), 16_777_619) >>> 0, 2_166_136_261)

// ------------------------------------------------------------ slope roof

/*
 * Facing (the low side) per rotation, measured from each part's own stud
 * rows: slope-2x2 / slope-2x4 face -z at r0, +x at r1, +z at r2, -x at r3;
 * slope-1x2 (two studs long) faces -x at r0, -z at r1, +x at r2, +z at r3.
 */
const wideSlope = { '-z': 0, '+x': 1, '+z': 2, '-x': 3 } as const
const narrowSlope = { '-x': 0, '-z': 1, '+x': 2, '+z': 3 } as const

/**
 * A gable roof of real 45° slopes. Each course steps in one stud per side
 * and rises one brick; the hidden core is filled with bricks in gableColor
 * (visible on the gable ends). The ridge is capped with double slopes or tiles.
 */
export const compileSlopeRoof = (command: Record<string, unknown>, x0: number, z0: number): RelativePart[] => {
  const [width, depth] = size2(command.size, 2, 'Slope roof')
  const ridge = command.ridge === 'z' ? 'z' : 'x'
  const color = typeof command.color === 'string' ? command.color : 'dark-gray'
  const gable = typeof command.gableColor === 'string' ? command.gableColor : color
  const length = ridge === 'x' ? width : depth
  const span = ridge === 'x' ? depth : width
  if (span % 2) throw new Error(`Slope roof: the span across the ridge (${span}) must be even; the ridge runs along ${ridge}, so make the ${ridge === 'x' ? 'depth' : 'width'} even or turn the ridge.`)
  const useWide4 = carries('slope-2x4', color)
  const result: RelativePart[] = []
  // u runs along the ridge, v across it; convert to world coordinates.
  const at = (u: number, v: number) => ridge === 'x' ? { x: x0 + u, z: z0 + v } : { x: x0 + v, z: z0 + u }
  const front = ridge === 'x' ? '-z' : '-x'
  const back = ridge === 'x' ? '+z' : '+x'
  const slopeRow = (v: number, y: number, facing: '-z' | '+z' | '-x' | '+x') => {
    for (const [u, piece] of pieces(length, useWide4 ? [4, 2, 1] : [2, 1])) {
      if (piece === 1) result.push({ brickId: 'slope-1x2', color, ...at(u, v), y, rotation: narrowSlope[facing] })
      else result.push({ brickId: piece === 4 ? 'slope-2x4' : 'slope-2x2', color, ...at(u, v), y, rotation: wideSlope[facing] })
    }
  }
  const fill = (v0: number, rows: number, y: number) => {
    for (const [v, across] of pieces(rows, [2, 1])) {
      for (const [u, along] of pieces(length, across === 2 ? [4, 2, 1] : [4, 3, 2, 1])) {
        const id = across === 2 ? (along === 1 ? 'brick-1x2' : `brick-2x${along}`) : `brick-1x${along}`
        // 2xN bricks lie along u; a 1-long, 2-deep brick is a rotated 1x2.
        const rotateLong = ridge === 'z' ? along !== 1 || across !== 2 : along === 1 && across === 2
        result.push({ brickId: id, color: gable, ...at(u, v0 + v), y, rotation: rotateLong ? 1 : 0 })
      }
    }
  }
  const cap = (v: number, rows: number, y: number) => {
    if (rows === 2 && carries('slope-double-1x2', color)) {
      for (let u = 0; u < length; u++) result.push({ brickId: 'slope-double-1x2', color, ...at(u, v), y, rotation: ridge === 'x' ? 0 : 1 })
      return
    }
    for (const [u, along] of pieces(length, [4, 2, 1])) {
      for (let row = 0; row < rows; row++) {
        result.push({ brickId: `tile-1x${along}`, color, ...at(u, v + row), y, rotation: ridge === 'x' ? 0 : 1 })
      }
    }
  }
  for (let tier = 0; ; tier++) {
    const remaining = span - tier * 2
    const y = tier * 1.2
    if (remaining <= 0) break
    if (remaining >= 4) {
      slopeRow(tier, y, front)
      slopeRow(span - tier - 2, y, back)
      if (remaining > 4) fill(tier + 2, remaining - 4, y)
    } else {
      cap(tier, remaining, y)
      break
    }
  }
  return result
}

// ------------------------------------------------------------ tree

const leafDefault = ['green', 'dark-green', 'lime']

/**
 * A tree: a trunk of round bricks and a canopy of brick courses, each course
 * a disc (or a shrinking square for pines) about as tall as it is wide.
 * Courses alternate their tiling direction so every brick bonds to the one
 * above or below, and each brick takes one of the leaf colours, giving the
 * mottled foliage of real MOC trees. A plate cap rounds off the top.
 */
export const compileTree = (command: Record<string, unknown>, x: number, z: number): RelativePart[] => {
  const style = command.style === 'pine' || command.style === 'bush' ? command.style : 'round'
  const canopy = integer(command.size, 3, 11, 'Tree size', style === 'bush' ? 4 : 7)
  const trunkCourses = style === 'bush' ? 0 : integer(command.trunk, 1, 8, 'Tree trunk', 3)
  const trunkColor = typeof command.trunkColor === 'string' ? command.trunkColor : 'reddish-brown'
  const leaves = colorList(command.leaves ?? command.colors, leafDefault)
  const next = random(seedOf(x, z, canopy, trunkCourses))
  const leafFor = (brickId: string) => {
    const usable = leaves.filter(color => carries(brickId, color))
    const pool = usable.length ? usable : ['green']
    return pool[Math.floor(next() * pool.length)]
  }
  const result: RelativePart[] = []
  for (let course = 0; course < trunkCourses; course++) result.push({ brickId: 'brick-round-1x1', color: trunkColor, x, y: course * 1.2, z })
  // Canopy cells are centred on the trunk stud (x + 0.5, z + 0.5).
  const radius = canopy / 2
  const courses = style === 'bush' ? Math.max(2, Math.round(canopy * 0.6)) : Math.max(2, Math.round(canopy * 0.85))
  const halfWidthAt = (course: number) => {
    // Pines shrink every second course, so each perpendicular pair covers the same square.
    if (style === 'pine') return radius * (1 - (Math.floor(course / 2) * 2) / courses) + 0.5
    // A sphere (bush: the upper half of one), sampled at the middle of the course.
    const t = style === 'bush' ? (course + 0.5) / courses : ((course + 0.5) / courses) * 2 - 1
    return radius * Math.sqrt(Math.max(0, 1 - t * t)) + 0.35
  }
  const inside = (dx: number, dz: number, half: number) => style === 'pine'
    ? Math.abs(dx + 0.5) < half && Math.abs(dz + 0.5) < half
    : (dx + 0.5) ** 2 + (dz + 0.5) ** 2 <= half * half
  const span = Math.ceil(radius) + 1
  let y = trunkCourses * 1.2
  for (let course = 0; course < courses; course++) {
    const half = Math.max(0.75, halfWidthAt(course))
    const alongX = course % 2 === 0
    for (let lane = -span; lane <= span; lane++) {
      // Contiguous cells of this row (a disc row is one interval).
      const cells = []
      for (let cell = -span; cell <= span; cell++) if (alongX ? inside(cell, lane, half) : inside(lane, cell, half)) cells.push(cell)
      if (!cells.length) continue
      for (const [offset, run] of evenRuns(cells.length, course + lane + span)) {
        const start = cells[0] + offset
        const id = `brick-1x${run}`
        result.push({ brickId: id, color: leafFor(id), x: alongX ? x + start : x + lane, y, z: alongX ? z + lane : z + start, rotation: alongX ? 0 : 1 })
      }
    }
    y += 1.2
  }
  // Rounded top: a small plate cap over the centre.
  if (style !== 'pine') result.push({ brickId: 'plate-2x2', color: leafFor('plate-2x2'), x, y, z })
  return result
}

// ------------------------------------------------------------ fence / railing

/** A railing: round posts on every other stud and a plate rail across their tops. */
export const compileFence = (command: Record<string, unknown>, x: number, z: number): RelativePart[] => {
  const length = integer(command.length, 2, 32, 'Fence length')
  const height = integer(command.height, 1, 3, 'Fence height', 1)
  const alongZ = command.axis === 'z'
  const color = typeof command.color === 'string' ? command.color : 'white'
  const railColor = typeof command.railColor === 'string' ? command.railColor : color
  const result: RelativePart[] = []
  const posts = new Set<number>()
  for (let cell = 0; cell < length; cell += 2) posts.add(cell)
  posts.add(length - 1)
  for (const cell of posts) {
    for (let course = 0; course < height; course++) {
      result.push({ brickId: 'brick-round-1x1', color, x: alongZ ? x : x + cell, y: course * 1.2, z: alongZ ? z + cell : z })
    }
  }
  for (const [cell, run] of pieces(length, [4, 3, 2, 1])) {
    result.push({ brickId: `plate-1x${run}`, color: railColor, x: alongZ ? x : x + cell, y: height * 1.2, z: alongZ ? z + cell : z, rotation: alongZ ? 1 : 0 })
  }
  return result
}

// ------------------------------------------------------------ tiles

const tileShapes: Array<{ id: string; w: number; d: number; rotation: number }> = [
  { id: 'tile-2x4', w: 4, d: 2, rotation: 0 },
  { id: 'tile-2x2', w: 2, d: 2, rotation: 0 },
  { id: 'tile-1x4', w: 4, d: 1, rotation: 0 },
  { id: 'tile-1x2', w: 2, d: 1, rotation: 0 },
  { id: 'tile-1x2', w: 1, d: 2, rotation: 1 },
  { id: 'tile-1x1', w: 1, d: 1, rotation: 0 },
]

/** A smooth surface (path, water, floor, flat roof): tiles covering a rectangle. */
export const compileTiles = (command: Record<string, unknown>, x0: number, z0: number): RelativePart[] => {
  const [width, depth] = size2(command.size, 1, 'Tiles')
  const color = typeof command.color === 'string' ? command.color : 'tan'
  const shapes = tileShapes.filter(shape => carries(shape.id, color))
  const usable = shapes.length ? shapes : tileShapes.filter(shape => shape.id === 'tile-1x1' || shape.id === 'tile-1x2')
  const covered = new Set<string>()
  const result: RelativePart[] = []
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      if (covered.has(`${x},${z}`)) continue
      const shape = usable.find(candidate => x + candidate.w <= width && z + candidate.d <= depth
        && Array.from({ length: candidate.w * candidate.d }, (_, index) => `${x + index % candidate.w},${z + Math.floor(index / candidate.w)}`).every(key => !covered.has(key)))
        ?? usable[usable.length - 1]
      for (let index = 0; index < shape.w * shape.d; index++) covered.add(`${x + index % shape.w},${z + Math.floor(index / shape.w)}`)
      result.push({ brickId: shape.id, color, x: x0 + x, y: 0, z: z0 + z, rotation: shape.rotation })
    }
  }
  return result
}

// ------------------------------------------------------------ planting

const plantParts = ['round-1x1-plate', 'plate-1x1', 'tile-round-1x1-plain', 'cone-1x1-stop', 'plate-1x2']
const plantDefault = ['green', 'lime', 'dark-green', 'red', 'orange', 'yellow']

/**
 * Ground planting: small round plates, cones and plates scattered over a
 * region. Unlike other primitives, each part is placed independently, so
 * occupied cells are simply skipped.
 */
export const compileScatter = (command: Record<string, unknown>, x0: number, z0: number): RelativePart[] => {
  const [width, depth] = size2(command.size, 1, 'Scatter')
  const count = integer(command.count, 1, 200, 'Scatter count', Math.max(3, Math.round(width * depth * 0.2)))
  const colors = colorList(command.colors, plantDefault)
  const parts = Array.isArray(command.parts) && command.parts.length
    ? command.parts.filter((id): id is string => typeof id === 'string' && Boolean(brickById.get(id))).slice(0, 6)
    : plantParts
  const next = random(seedOf(x0, z0, width, depth, count))
  const used = new Set<string>()
  const result: RelativePart[] = []
  for (let attempt = 0; attempt < count * 4 && result.length < count; attempt++) {
    const x = Math.floor(next() * width)
    const z = Math.floor(next() * depth)
    const id = parts[Math.floor(next() * parts.length)] ?? 'round-1x1-plate'
    const usable = colors.filter(color => carries(id, color))
    const long = id === 'plate-1x2'
    const rotation = long && next() < 0.5 ? 1 : 0
    const cells = long ? [`${x},${z}`, rotation ? `${x},${z + 1}` : `${x + 1},${z}`] : [`${x},${z}`]
    if ((long && (rotation ? z + 1 >= depth : x + 1 >= width)) || cells.some(cell => used.has(cell))) continue
    cells.forEach(cell => used.add(cell))
    const pool = usable.length ? usable : colors
    result.push({ brickId: id, color: pool[Math.floor(next() * pool.length)], x: x0 + x, y: 0, z: z0 + z, rotation })
  }
  return result
}

export const detailPrimitiveKinds = ['slope-roof', 'tree', 'fence', 'tiles', 'scatter'] as const
export type DetailPrimitiveKind = typeof detailPrimitiveKinds[number]

export const compileDetailPrimitive = (kind: DetailPrimitiveKind, command: Record<string, unknown>, x: number, z: number): RelativePart[] => {
  if (!record(command)) throw new Error('Primitive must be an object.')
  if (kind === 'slope-roof') return compileSlopeRoof(command, x, z)
  if (kind === 'tree') return compileTree(command, x, z)
  if (kind === 'fence') return compileFence(command, x, z)
  if (kind === 'tiles') return compileTiles(command, x, z)
  return compileScatter(command, x, z)
}
