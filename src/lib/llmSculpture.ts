type Point = [number, number, number]
type Shape = { name: string; shape: 'ellipsoid' | 'box'; center: Point; size: Point; color: string }
type Feature = { name: string; on: string; shape: 'ellipse' | 'rectangle'; center: [number, number]; size: [number, number]; color: string }

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const vector = (value: unknown, length: number): number[] => {
  if (!Array.isArray(value) || value.length !== length || !value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 128)) {
    throw new Error(`Sculpture vectors must contain ${length} finite coordinates within ±128 studs.`)
  }
  return [...value]
}

const intersectsCell = (solid: Shape, x: number, course: number, z: number) => {
  const halfCell = [0.5, 0.2, 0.5]
  const offsets = [x + 0.5, (course + 0.5) * 0.4, z + 0.5].map((n, axis) => Math.max(0, Math.abs(n - solid.center[axis]) - halfCell[axis]) / (solid.size[axis] / 2))
  return solid.shape === 'box' ? offsets.every(n => n < 1) : offsets.reduce((sum, n) => sum + n * n, 0) < 1
}

const supportSolids = (solids: Shape[], size: Point) => {
  const shifts = new Map<string, number>()
  const ordered = [...solids].sort((a, b) => a.center[1] - a.size[1] / 2 - (b.center[1] - b.size[1] / 2))
  for (const solid of ordered) {
    const originalY = solid.center[1]
    let supported = false
    for (let step = 0; step <= 6 && !supported; step++) {
      solid.center[1] = originalY + step * 0.4
      if (solid.center[1] + solid.size[1] / 2 > size[1] + 0.001) break
      const course = Math.max(0, Math.floor((solid.center[1] - solid.size[1] / 2 + 0.000001) / 0.4))
      if (course === 0) { supported = true; break }
      for (let z = 0; z < size[2] && !supported; z++) {
        for (let x = 0; x < size[0] && !supported; x++) {
          supported = intersectsCell(solid, x, course, z) && solids.some(other => other !== solid && intersectsCell(other, x, course - 1, z))
        }
      }
    }
    if (supported) shifts.set(solid.name, solid.center[1] - originalY)
    else solid.center[1] = originalY
  }
  return shifts
}

/** Rasterizes a subject-independent solid model and its visible surface markings. */
export const createSculptureLayers = (command: Record<string, unknown>) => {
  const size = vector(command.size, 3) as Point
  if (!size.every(Number.isInteger) || size[0] < 2 || size[0] > 24 || size[1] < 2 || size[1] > 32 || size[2] < 2 || size[2] > 24) {
    throw new Error('Sculpture size is [width, height, depth] in studs, with width/depth 2–24 and height 2–32.')
  }
  if (!Array.isArray(command.solids) || !command.solids.length || command.solids.length > 32
    || !Array.isArray(command.features) || command.features.length > 48) {
    throw new Error('A sculpture requires 1–32 solids and up to 48 surface features.')
  }
  const names = new Set<string>()
  const solids: Shape[] = command.solids.map(value => {
    if (!record(value) || typeof value.name !== 'string' || !value.name.trim() || names.has(value.name)
      || !['ellipsoid', 'box'].includes(String(value.shape)) || typeof value.color !== 'string') {
      throw new Error('Each solid requires a unique name, ellipsoid/box shape and legal colour.')
    }
    names.add(value.name)
    const dimensions = vector(value.size, 3) as Point
    if (!dimensions.every(n => n > 0 && n <= 32)) throw new Error('Solid dimensions must be positive and at most 32 studs.')
    const center = vector(value.center, 3) as Point
    if (center.some((n, axis) => n - dimensions[axis] / 2 < -0.001 || n + dimensions[axis] / 2 > size[axis] + 0.001)) {
      throw new Error(`Solid "${value.name}" extends outside the sculpture bounds. Centres are local to the sculpture bounding box.`)
    }
    return { name: value.name, shape: value.shape as Shape['shape'], center, size: dimensions, color: value.color }
  })
  const featureNames = new Set<string>()
  const shifts = supportSolids(solids, size)
  const features: Feature[] = command.features.map(value => {
    if (!record(value) || typeof value.name !== 'string' || !value.name.trim() || featureNames.has(value.name)
      || typeof value.on !== 'string' || !names.has(value.on) || !['ellipse', 'rectangle'].includes(String(value.shape)) || typeof value.color !== 'string') {
      throw new Error('Each surface feature requires a unique name, an existing solid name, ellipse/rectangle shape and colour.')
    }
    featureNames.add(value.name)
    const dimensions = vector(value.size, 2) as [number, number]
    if (!dimensions.every(n => n > 0 && n <= 32)) throw new Error('Surface feature dimensions must be positive and at most 32 studs.')
    const center = vector(value.center, 2) as [number, number]
    center[1] += shifts.get(value.on) ?? 0
    return { name: value.name, on: value.on, shape: value.shape as Feature['shape'], center, size: dimensions, color: value.color }
  })
  const layerHeight = 0.4
  const [width, height, depth] = size
  const courses = Math.round(height / layerHeight)
  const palette: Record<string, string> = {}
  const symbols = new Map<string, string>()
  const symbolFor = (color: string) => {
    if (!brickById.get('plate-1x1')!.colors.includes(color as BrickColor)) throw new Error(`Invalid sculpture colour: ${color}. Choose an available plate colour.`)
    let symbol = symbols.get(color)
    if (!symbol) {
      symbol = String.fromCharCode(65 + symbols.size)
      symbols.set(color, symbol)
      palette[symbol] = color
    }
    return symbol
  }
  // Validate even colours belonging to a fully hidden solid in the shared compiler.
  solids.forEach(solid => symbolFor(solid.color))
  features.forEach(feature => symbolFor(feature.color))
  const visibleFeatures = new Set<number>()
  const layers = []
  for (let course = 0; course < courses; course++) {
    const y = (course + 0.5) * layerHeight
    const rows = Array.from({ length: depth }, () => Array<string>(width).fill('.'))
    for (let x = 0; x < width; x++) {
      const owners = Array<string | undefined>(depth)
      for (let z = 0; z < depth; z++) {
        for (const solid of solids) {
          if (intersectsCell(solid, x, course, z)) { rows[z][x] = symbolFor(solid.color); owners[z] = solid.name }
        }
      }
      const front = owners.map(owner => owner !== undefined).lastIndexOf(true)
      if (front < 0) continue
      const projectedFeatures: number[] = []
      for (const [index, feature] of features.entries()) {
        if (feature.on !== owners[front]) continue
        const centerX = feature.size[0] < 1 ? Math.floor(feature.center[0]) + 0.5 : feature.center[0]
        const centerY = feature.size[1] < layerHeight ? (Math.floor(feature.center[1] / layerHeight) + 0.5) * layerHeight : feature.center[1]
        const dx = (x + 0.5 - centerX) / (Math.max(1, feature.size[0]) / 2)
        const dy = (y - centerY) / (Math.max(layerHeight, feature.size[1]) / 2)
        const inside = feature.shape === 'ellipse' ? dx * dx + dy * dy <= 1 : Math.abs(dx) <= 1 && Math.abs(dy) <= 1
        if (inside) {
          // A two-stud skin lets markings bond to the solid behind curved edges.
          for (let z = front; z >= Math.max(0, front - 1) && owners[z] === feature.on; z--) rows[z][x] = symbolFor(feature.color)
          projectedFeatures.push(index)
        }
      }
      for (const index of projectedFeatures) {
        if (features[index].color === palette[rows[front][x]]) visibleFeatures.add(index)
      }
    }
    layers.push({ rows: rows.map(row => row.join('')) })
  }
  for (const [index, feature] of features.entries()) {
    if (!visibleFeatures.has(index)) throw new Error(`Surface feature "${feature.name}" is absent, occluded or smaller than the brick resolution. Reposition or enlarge it on the visible front of "${feature.on}".`)
  }
  return { kind: 'voxel-layers', at: command.at, layerHeight, palette, layers }
}
import { brickById } from '../data/basicBricks'
import type { BrickColor } from '../types/bricks'


class SculptureSupportError extends Error {
  constructor(readonly course: number, readonly cell: number) {
    super(`Sculpture course ${course} cannot be tiled with supported plates. Increase the overlap between neighbouring solids or use a thicker connecting neck/limb.`)
  }
}

const tileSupportedLayers = (sculpture: ReturnType<typeof createSculptureLayers>, limit: number) => {
  const at = vector(sculpture.at, 3)
  const width = sculpture.layers[0].rows[0].length
  const depth = sculpture.layers[0].rows.length
  const shapes = [
    { id: 'plate-1x1', width: 1, depth: 1, rotation: 0 },
    ...[2, 3, 4].flatMap(length => [
      { id: `plate-1x${length}`, width: length, depth: 1, rotation: 0 },
      { id: `plate-1x${length}`, width: 1, depth: length, rotation: 1 },
    ]),
    { id: 'plate-2x2', width: 2, depth: 2, rotation: 0 },
    { id: 'plate-2x3', width: 3, depth: 2, rotation: 0 },
    { id: 'plate-2x3', width: 2, depth: 3, rotation: 1 },
    { id: 'plate-4x4', width: 4, depth: 4, rotation: 0 },
    { id: 'plate-2x4', width: 4, depth: 2, rotation: 0 },
    { id: 'plate-2x4', width: 2, depth: 4, rotation: 1 },
  ]
  type Candidate = typeof shapes[number] & { x: number; z: number; cells: number[]; supports: number[]; color: string; extraCells: number }
  const commands: Record<string, unknown>[] = []
  const parents: number[] = []
  const root = (index: number): number => {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index] }
    return index
  }
  let below = new Map<number, number>()
  for (const [course, layer] of sculpture.layers.entries()) {
    const cells = layer.rows.join('')
    const unassigned = new Set([...cells].flatMap((symbol, index) => symbol === '.' ? [] : [index]))
    const candidates = new Map<number, Candidate[]>()
    for (const cell of unassigned) {
      const options: Candidate[] = []
      const color = sculpture.palette[cells[cell]]
      for (const shape of shapes) {
        if (!brickById.get(shape.id)?.colors.includes(color as BrickColor)) continue
        for (let dz = 0; dz < shape.depth; dz++) {
          for (let dx = 0; dx < shape.width; dx++) {
            const x = cell % width - dx
            const z = Math.floor(cell / width) - dz
            if (x < 0 || z < 0 || x + shape.width > width || z + shape.depth > depth) continue
            const covered = []
            for (let row = 0; row < shape.depth; row++) {
              for (let col = 0; col < shape.width; col++) covered.push((z + row) * width + x + col)
            }
            if (!covered.every(index => cells[index] === cells[cell] || cells[index] === '.')) continue
            const extraCells = covered.filter(index => cells[index] === '.').length
            if (extraCells > 2 || extraCells * 2 > covered.length) continue
            const supports = [...new Set(covered.flatMap(index => below.has(index) ? [below.get(index)!] : []))]
            if (course > 0 && !supports.length) continue
            options.push({ ...shape, x, z, cells: covered, supports, color, extraCells })
          }
        }
      }
      candidates.set(cell, options)
    }
    const above = new Map<number, number>()
    const placements: Candidate[] = []
    const assigned = new Set<number>()
    const score = (option: Candidate) => new Set(option.supports.map(root)).size * 1000
      + option.supports.length * 12 + option.cells.length * 20 - option.extraCells * 80 + (option.rotation === course % 2 ? 5 : 0)
    let attempts = 0
    const solve = (): boolean => {
      if (!unassigned.size) return true
      if (++attempts > 20_000) return false
      let selected: Candidate[] = []
      let priority = Infinity
      for (const cell of unassigned) {
        const options = candidates.get(cell)!.filter(option => option.cells.every(index => !assigned.has(index)))
        if (!options.length) return false
        const bridging = Math.max(...options.map(option => new Set(option.supports.map(root)).size))
        const value = options.length * 2 + (below.has(cell) ? 1 : 0) - bridging * 1000
        if (value < priority) { priority = value; selected = options }
      }
      selected.sort((a, b) => score(b) - score(a))
      for (const tile of selected) {
        tile.cells.forEach(cell => { unassigned.delete(cell); assigned.add(cell) })
        placements.push(tile)
        if (solve()) return true
        placements.pop()
        tile.cells.forEach(cell => { if (cells[cell] !== '.') unassigned.add(cell); assigned.delete(cell) })
      }
      return false
    }
    if (!solve()) {
      const cell = [...unassigned].find(cell => !below.has(cell)) ?? -1
      throw new SculptureSupportError(course, cell)
    }
    for (const tile of placements) {
      const index = commands.length
      parents.push(index)
      for (const support of tile.supports) parents[root(support)] = index
      commands.push({ brickId: tile.id, color: tile.color,
        at: [at[0] + tile.x, at[1] + course * sculpture.layerHeight, at[2] + tile.z], rotationQuarterTurns: tile.rotation })
      if (commands.length > limit) throw new Error('Sculpture part budget exceeded. Reduce the solid dimensions.')
      for (const cell of tile.cells) above.set(cell, index)
    }
    below = above
  }
  if (!commands.length) throw new Error('The sculpture contains no occupied cells.')
  return commands
}

export const tileSculptureLayers = (input: ReturnType<typeof createSculptureLayers>, limit: number) => {
  const sculpture = { ...input, layers: input.layers.map(layer => ({ rows: [...layer.rows] })) }
  const width = sculpture.layers[0].rows[0].length
  for (let attempt = 0; ; attempt++) {
    try { return tileSupportedLayers(sculpture, limit) } catch (error) {
      if (!(error instanceof SculptureSupportError) || error.course < 1 || error.cell < 0 || attempt >= 64) throw error
      const x = error.cell % width
      const z = Math.floor(error.cell / width)
      const rows = sculpture.layers[error.course - 1].rows
      let support: string | undefined
      // Extend only a nearby lower surface, preserving every original marked cell.
      for (let distance = 1; distance <= 2 && !support; distance++) {
        for (let dz = -distance; dz <= distance && !support; dz++) {
          for (let dx = -distance; dx <= distance && !support; dx++) {
            if (Math.abs(dx) + Math.abs(dz) !== distance) continue
            const cell = rows[z + dz]?.[x + dx]
            if (cell && cell !== '.') support = cell
          }
        }
      }
      if (!support || rows[z][x] !== '.') throw new Error(`${error.message} Unbridgeable cell X=${x}, Z=${z}, colour=${sculpture.palette[sculpture.layers[error.course].rows[z][x]]}.`)
      rows[z] = rows[z].slice(0, x) + support + rows[z].slice(x + 1)
    }
  }
}
