import { colorHex } from '../data/basicBricks'
import { officialPartColorsByPartNumber } from '../data/officialPartColors'
import type { BrickColor, BuildPlan, PlacedBrick } from '../types/bricks'

export type ObjImportProfileId = 's' | 'm' | 'l'
export type ObjImportOrientation = 'upright' | 'lay-back' | 'lay-side'
export type ObjImportEdgeStyle = 'angular' | 'curved'
export type ObjImportColorMode = 'single' | 'materials'
export type ObjImportStage = 'parse' | 'voxelize' | 'repair' | 'tile' | 'finalize'

export type ObjImportOptions = {
  title: string
  profileId: ObjImportProfileId
  orientation: ObjImportOrientation
  color: BrickColor
  locale: 'zh' | 'en'
  idPrefix: string
  edgeStyle?: ObjImportEdgeStyle
  maxBricks?: number
  colorMode?: ObjImportColorMode
  materialText?: string
}

export type ObjImportProgress = {
  stage: ObjImportStage
  progress: number
}

export type ObjImportStats = {
  dimensions: { width: number; height: number; depth: number }
  resolution: number
  sourceVoxels: number
  finalVoxels: number
  removedComponentVoxels: number
  addedSupportVoxels: number
  addedConnectivityVoxels: number
  prunedUnsupportedVoxels: number
  brickCount: number
  slopeCount: number
  curvedSlopeCount: number
  componentCount: number
  structuralChangeRatio: number
  oddRayRatio: number
  voxelIoU: number
  frontSilhouetteIoU: number
  sideSilhouetteIoU: number
  topSilhouetteIoU: number
  materialCount: number
  materialPalette: Array<{
    material: string
    sourceHex: string
    mappedColor: BrickColor
    brickCount: number
  }>
}

export type ObjImportProjection = {
  width: number
  height: number
  sourceRows: string[]
  finalRows: string[]
}

export type ObjImportPreview = {
  front: ObjImportProjection
  side: ObjImportProjection
  top: ObjImportProjection
}

export type ObjImportResult = {
  plan: BuildPlan
  stats: ObjImportStats
  preview: ObjImportPreview
}

type Point3 = { x: number; y: number; z: number }
type Triangle = [Point3, Point3, Point3]
type Mesh = { vertices: Point3[]; triangles: Triangle[]; triangleMaterialNames: Array<string | undefined> }
type Dimensions = { width: number; height: number; depth: number }
type NormalizedMesh = Mesh & { dimensions: Dimensions }
type BrickType = {
  id: string
  name: string
  width: number
  depth: number
  rotationQuarterTurns: number
  highOffset?: [number, number]
  isSlope?: boolean
}
type Placement = BrickType & {
  x: number
  z: number
  cells: string[]
  connectorCells: string[]
  supportCells: string[]
}
type LayerTiling = {
  placements: Placement[]
  brickByConnector: Map<string, number>
}
type TiledVoxels = {
  bricks: Array<Placement & { y: number }>
  unsupported: Array<{ x: number; y: number; z: number; cells: string[] }>
  componentCount: number
  componentByBrickIndex: number[]
}

const layerHeightStuds = 1.2
const coverageThreshold = 0.26
const raySamples: Array<[number, number]> = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
]

export const objImportProfiles: Array<{ id: ObjImportProfileId; label: string; resolution: number }> = [
  { id: 's', label: 'S', resolution: 16 },
  { id: 'm', label: 'M', resolution: 24 },
  { id: 'l', label: 'L', resolution: 32 },
]

const baseBrickTypes: Array<Omit<BrickType, 'rotationQuarterTurns'>> = [
  { id: 'brick-2x8', name: '2x8 Brick', width: 8, depth: 2 },
  { id: 'brick-1x6', name: '1x6 Brick', width: 6, depth: 1 },
  { id: 'brick-2x4', name: '2x4 Brick', width: 4, depth: 2 },
  { id: 'brick-1x4', name: '1x4 Brick', width: 4, depth: 1 },
  { id: 'brick-2x3', name: '2x3 Brick', width: 3, depth: 2 },
  { id: 'brick-1x3', name: '1x3 Brick', width: 3, depth: 1 },
  { id: 'brick-2x2', name: '2x2 Brick', width: 2, depth: 2 },
  { id: 'brick-1x2', name: '1x2 Brick', width: 2, depth: 1 },
  { id: 'brick-1x1', name: '1x1 Brick', width: 1, depth: 1 },
]

const slopeBrickTypes: BrickType[] = [
  { id: 'slope-1x2', name: '1x2 Slope', width: 2, depth: 1, rotationQuarterTurns: 0, highOffset: [1, 0], isSlope: true },
  { id: 'slope-1x2', name: '1x2 Slope', width: 1, depth: 2, rotationQuarterTurns: 1, highOffset: [0, 1], isSlope: true },
  { id: 'slope-1x2', name: '1x2 Slope', width: 2, depth: 1, rotationQuarterTurns: 2, highOffset: [0, 0], isSlope: true },
  { id: 'slope-1x2', name: '1x2 Slope', width: 1, depth: 2, rotationQuarterTurns: 3, highOffset: [0, 0], isSlope: true },
]

const regularBrickTypes = baseBrickTypes.flatMap((brick): BrickType[] => {
  const orientations: BrickType[] = [{ ...brick, rotationQuarterTurns: 0 }]
  if (brick.width !== brick.depth) {
    orientations.push({ ...brick, width: brick.depth, depth: brick.width, rotationQuarterTurns: 1 })
  }
  return orientations
})
const orientedBrickTypes = [...regularBrickTypes, ...slopeBrickTypes]
const oneByOneBrick = regularBrickTypes.find((brick) => brick.id === 'brick-1x1') as BrickType

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000
const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`
const layerCellKey = (x: number, z: number) => `${x},${z}`
const parseCellKey = (key: string) => key.split(',').map(Number) as [number, number, number]

type RgbColor = { r: number; g: number; b: number }

const objBrickPartNumberById: Record<string, string> = {
  'brick-2x8': '3007',
  'brick-1x6': '3009',
  'brick-2x4': '3001',
  'brick-1x4': '3010',
  'brick-2x3': '3002',
  'brick-1x3': '3622',
  'brick-2x2': '3003',
  'brick-1x2': '3004',
  'brick-1x1': '3005',
  'slope-1x2': '3040',
  'slope-curved-2x1-low': '11477',
}

const brickColorRgb = Object.fromEntries(Object.entries(colorHex).map(([color, hex]) => {
  const value = Number.parseInt(hex.slice(1), 16)
  return [color, { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }]
})) as Record<BrickColor, RgbColor>

const rgbToHex = (color: RgbColor) => `#${[color.r, color.g, color.b]
  .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
  .join('')}`

export const parseMtlPalette = (text = '') => {
  const palette = new Map<string, RgbColor>()
  let currentMaterial = ''
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    const materialMatch = line.match(/^newmtl\s+(.+)$/i)
    if (materialMatch) {
      currentMaterial = materialMatch[1].trim()
      continue
    }
    const diffuseMatch = line.match(/^Kd\s+([\d.+-eE]+)\s+([\d.+-eE]+)\s+([\d.+-eE]+)/)
    if (!currentMaterial || !diffuseMatch) continue
    const components = diffuseMatch.slice(1, 4).map(Number)
    if (!components.every(Number.isFinite)) continue
    const scale = Math.max(...components) <= 1 ? 255 : 1
    palette.set(currentMaterial, {
      r: components[0] * scale,
      g: components[1] * scale,
      b: components[2] * scale,
    })
  }
  return palette
}

const colorDistance = (source: RgbColor, target: RgbColor) => (
  (source.r - target.r) ** 2 * 0.3 +
  (source.g - target.g) ** 2 * 0.59 +
  (source.b - target.b) ** 2 * 0.11
)

const mapMaterialColorToBrick = (source: RgbColor, brickId: string, fallback: BrickColor) => {
  const partNumber = objBrickPartNumberById[brickId]
  const availableColors = (officialPartColorsByPartNumber[partNumber] ?? [fallback]).filter((color) => !color.startsWith('trans-'))
  const initialColor: BrickColor = availableColors.find((color) => color === fallback) ?? availableColors[0] ?? 'gray'
  return availableColors.reduce<BrickColor>((closest, color) => (
    colorDistance(source, brickColorRgb[color]) < colorDistance(source, brickColorRgb[closest]) ? color : closest
  ), initialColor)
}

const parseObj = (text: string): Mesh => {
  const vertices: Point3[] = []
  const triangles: Triangle[] = []
  const triangleMaterialNames: Array<string | undefined> = []
  let currentMaterialName: string | undefined

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (/^v\s/.test(line)) {
      const [x, y, z] = line.split(/\s+/).slice(1, 4).map(Number)
      if ([x, y, z].every(Number.isFinite)) vertices.push({ x, y, z })
      continue
    }
    const materialMatch = line.match(/^usemtl\s+(.+)$/i)
    if (materialMatch) {
      currentMaterialName = materialMatch[1].trim()
      continue
    }
    if (!/^f\s/.test(line)) continue

    const indices = line.split(/\s+/).slice(1).map((token) => {
      const parsed = Number(token.split('/')[0])
      return parsed < 0 ? vertices.length + parsed : parsed - 1
    })
    for (let index = 1; index + 1 < indices.length; index += 1) {
      const a = vertices[indices[0]]
      const b = vertices[indices[index]]
      const c = vertices[indices[index + 1]]
      if (!a || !b || !c) continue
      triangles.push([a, b, c])
      triangleMaterialNames.push(currentMaterialName)
    }
  }

  if (vertices.length === 0 || triangles.length === 0) throw new Error('OBJ_EMPTY_GEOMETRY')
  return { vertices, triangles, triangleMaterialNames }
}

const getBounds = (vertices: Point3[]) => {
  const bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  }
  for (const vertex of vertices) {
    bounds.minX = Math.min(bounds.minX, vertex.x)
    bounds.maxX = Math.max(bounds.maxX, vertex.x)
    bounds.minY = Math.min(bounds.minY, vertex.y)
    bounds.maxY = Math.max(bounds.maxY, vertex.y)
    bounds.minZ = Math.min(bounds.minZ, vertex.z)
    bounds.maxZ = Math.max(bounds.maxZ, vertex.z)
  }
  return bounds
}

const orientMesh = (mesh: Mesh, orientation: ObjImportOrientation): Mesh => {
  if (orientation === 'upright') return mesh
  const transform = orientation === 'lay-back'
    ? (vertex: Point3) => ({ x: vertex.x, y: vertex.z, z: vertex.y })
    : (vertex: Point3) => ({ x: vertex.y, y: vertex.x, z: vertex.z })
  return {
    vertices: mesh.vertices.map(transform),
    triangles: mesh.triangles.map((triangle) => triangle.map(transform) as Triangle),
    triangleMaterialNames: mesh.triangleMaterialNames,
  }
}

const normalizeMesh = (mesh: Mesh, resolution: number): NormalizedMesh => {
  const bounds = getBounds(mesh.vertices)
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const depth = bounds.maxZ - bounds.minZ
  const largestDimension = Math.max(width, depth, height / layerHeightStuds)
  if (!Number.isFinite(largestDimension) || largestDimension <= 0) throw new Error('OBJ_DEGENERATE_GEOMETRY')
  const scale = resolution / largestDimension
  const transform = (vertex: Point3): Point3 => ({
    x: (vertex.x - bounds.minX) * scale,
    y: ((vertex.y - bounds.minY) * scale) / layerHeightStuds,
    z: (vertex.z - bounds.minZ) * scale,
  })
  const dimensions = {
    width: Math.max(1, Math.ceil(width * scale)),
    height: Math.max(1, Math.ceil((height * scale) / layerHeightStuds)),
    depth: Math.max(1, Math.ceil(depth * scale)),
  }
  return {
    vertices: mesh.vertices.map(transform),
    triangles: mesh.triangles.map((triangle) => triangle.map(transform) as Triangle),
    triangleMaterialNames: mesh.triangleMaterialNames,
    dimensions,
  }
}

const buildTriangleBins = (triangles: Triangle[], dimensions: Dimensions) => {
  const bins: number[][] = Array.from({ length: dimensions.width * dimensions.depth }, () => [])
  triangles.forEach((triangle, triangleIndex) => {
    const xs = triangle.map((point) => point.x)
    const zs = triangle.map((point) => point.z)
    const minX = Math.max(0, Math.floor(Math.min(...xs)))
    const maxX = Math.min(dimensions.width - 1, Math.floor(Math.max(...xs)))
    const minZ = Math.max(0, Math.floor(Math.min(...zs)))
    const maxZ = Math.min(dimensions.depth - 1, Math.floor(Math.max(...zs)))
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) bins[z * dimensions.width + x].push(triangleIndex)
    }
  })
  return bins
}

const rayTriangleHeight = (x: number, z: number, triangle: Triangle) => {
  const [a, b, c] = triangle
  const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
  if (Math.abs(denominator) < 1e-10) return undefined
  const weightA = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator
  const weightB = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator
  const weightC = 1 - weightA - weightB
  const tolerance = -1e-8
  if (weightA < tolerance || weightB < tolerance || weightC < tolerance) return undefined
  return weightA * a.y + weightB * b.y + weightC * c.y
}

const makeInsideIntervals = (
  x: number,
  z: number,
  triangleIndices: number[],
  triangles: Triangle[],
  diagnostics: { oddRays: number },
) => {
  const hits = triangleIndices
    .map((index) => rayTriangleHeight(x, z, triangles[index]))
    .filter((value): value is number => Number.isFinite(value))
    .sort((source, target) => source - target)
  const uniqueHits: number[] = []
  for (const hit of hits) {
    if (uniqueHits.length === 0 || Math.abs(hit - uniqueHits[uniqueHits.length - 1]) > 1e-6) uniqueHits.push(hit)
  }
  if (uniqueHits.length % 2 !== 0) diagnostics.oddRays += 1
  const intervals: Array<[number, number]> = []
  for (let index = 0; index + 1 < uniqueHits.length; index += 2) {
    if (uniqueHits[index + 1] - uniqueHits[index] > 1e-7) intervals.push([uniqueHits[index], uniqueHits[index + 1]])
  }
  return intervals
}

const intervalOverlap = (intervals: Array<[number, number]>, minY: number, maxY: number) => intervals.reduce(
  (total, [start, end]) => total + Math.max(0, Math.min(maxY, end) - Math.max(minY, start)),
  0,
)

const voxelizeMesh = (mesh: NormalizedMesh) => {
  const { triangles, triangleMaterialNames, dimensions } = mesh
  const bins = buildTriangleBins(triangles, dimensions)
  const occupied = new Set<string>()
  const diagnostics = { rays: dimensions.width * dimensions.depth * raySamples.length, oddRays: 0 }

  for (let z = 0; z < dimensions.depth; z += 1) {
    for (let x = 0; x < dimensions.width; x += 1) {
      const triangleIndices = bins[z * dimensions.width + x]
      if (triangleIndices.length === 0) continue
      const sampleIntervals = raySamples.map(([offsetX, offsetZ]) =>
        makeInsideIntervals(x + offsetX, z + offsetZ, triangleIndices, triangles, diagnostics)
      )
      for (let y = 0; y < dimensions.height; y += 1) {
        const coverage = sampleIntervals.reduce(
          (total, intervals) => total + intervalOverlap(intervals, y, y + 1),
          0,
        ) / raySamples.length
        const centerVotes = sampleIntervals.filter((intervals) =>
          intervals.some(([start, end]) => start <= y + 0.5 && end >= y + 0.5)
        ).length
        if (coverage >= coverageThreshold || centerVotes >= 2) occupied.add(cellKey(x, y, z))
      }
    }
  }
  if (occupied.size === 0) throw new Error('OBJ_EMPTY_VOXELS')
  const materialByCell = new Map<string, string>()
  if (triangleMaterialNames.some(Boolean)) {
    for (const key of occupied) {
      const [x, y, z] = parseCellKey(key)
      const candidates = bins[z * dimensions.width + x]
      let closestMaterial: string | undefined
      let closestDistance = Infinity
      for (const triangleIndex of candidates) {
        const material = triangleMaterialNames[triangleIndex]
        if (!material) continue
        const triangle = triangles[triangleIndex]
        const center = {
          x: (triangle[0].x + triangle[1].x + triangle[2].x) / 3,
          y: (triangle[0].y + triangle[1].y + triangle[2].y) / 3,
          z: (triangle[0].z + triangle[1].z + triangle[2].z) / 3,
        }
        const distance = (center.x - x - 0.5) ** 2 + (center.y - y - 0.5) ** 2 + (center.z - z - 0.5) ** 2
        if (distance >= closestDistance) continue
        closestDistance = distance
        closestMaterial = material
      }
      if (closestMaterial) materialByCell.set(key, closestMaterial)
    }
  }
  return { occupied, diagnostics, materialByCell }
}

const getNeighbors = (x: number, y: number, z: number) => [
  cellKey(x - 1, y, z),
  cellKey(x + 1, y, z),
  cellKey(x, y - 1, z),
  cellKey(x, y + 1, z),
  cellKey(x, y, z - 1),
  cellKey(x, y, z + 1),
]

const keepLargestComponent = (occupied: Set<string>) => {
  const unseen = new Set(occupied)
  let largest = new Set<string>()
  while (unseen.size > 0) {
    const first = unseen.values().next().value
    if (!first) break
    const component = new Set([first])
    const queue = [first]
    unseen.delete(first)
    for (let index = 0; index < queue.length; index += 1) {
      const [x, y, z] = parseCellKey(queue[index])
      for (const neighbor of getNeighbors(x, y, z)) {
        if (!unseen.delete(neighbor)) continue
        component.add(neighbor)
        queue.push(neighbor)
      }
    }
    if (component.size > largest.size) largest = component
  }
  return { occupied: largest, removed: occupied.size - largest.size }
}

const setIoU = (source: Set<string>, target: Set<string>) => {
  let intersection = 0
  for (const key of source) if (target.has(key)) intersection += 1
  return intersection / Math.max(1, source.size + target.size - intersection)
}

const projectVoxels = (occupied: Set<string>, axes: [number, number]) => {
  const projection = new Set<string>()
  for (const key of occupied) {
    const coordinates = parseCellKey(key)
    projection.add(`${coordinates[axes[0]]},${coordinates[axes[1]]}`)
  }
  return projection
}

const createProjection = (
  source: Set<string>,
  target: Set<string>,
  axes: [number, number],
  width: number,
  height: number,
): ObjImportProjection => {
  const sourceProjection = projectVoxels(source, axes)
  const finalProjection = projectVoxels(target, axes)
  const rows = (projection: Set<string>) => Array.from({ length: height }, (_, rowIndex) => {
    const coordinateY = height - rowIndex - 1
    return Array.from({ length: width }, (_, x) => projection.has(`${x},${coordinateY}`) ? '1' : '0').join('')
  })
  return {
    width,
    height,
    sourceRows: rows(sourceProjection),
    finalRows: rows(finalProjection),
  }
}

const getShapeMetrics = (source: Set<string>, target: Set<string>) => ({
  voxelIoU: setIoU(source, target),
  frontSilhouetteIoU: setIoU(projectVoxels(source, [0, 1]), projectVoxels(target, [0, 1])),
  sideSilhouetteIoU: setIoU(projectVoxels(source, [2, 1]), projectVoxels(target, [2, 1])),
  topSilhouetteIoU: setIoU(projectVoxels(source, [0, 2]), projectVoxels(target, [0, 2])),
})

const placementCells = (placement: Pick<Placement, 'x' | 'z' | 'width' | 'depth'>) => {
  const cells: string[] = []
  for (let dz = 0; dz < placement.depth; dz += 1) {
    for (let dx = 0; dx < placement.width; dx += 1) cells.push(layerCellKey(placement.x + dx, placement.z + dz))
  }
  return cells
}

const placementTopConnectorCells = (placement: Pick<Placement, 'x' | 'z' | 'width' | 'depth' | 'isSlope' | 'highOffset'>) =>
  placement.isSlope && placement.highOffset
    ? [layerCellKey(placement.x + placement.highOffset[0], placement.z + placement.highOffset[1])]
    : placementCells(placement)

const addMinimalSupports = (occupied: Set<string>, dimensions: Dimensions) => {
  const repaired = new Set(occupied)
  let bridgeAdded = 0
  let columnAdded = 0

  for (let y = 1; y < dimensions.height; y += 1) {
    const layer = new Set<string>()
    const below = new Set<string>()
    for (const key of repaired) {
      const [x, cellY, z] = parseCellKey(key)
      if (cellY === y) layer.add(layerCellKey(x, z))
      if (cellY === y - 1) below.add(layerCellKey(x, z))
    }
    for (const key of layer) {
      if (below.has(key)) continue
      const [x, z] = key.split(',').map(Number)
      const bridgeCandidates: Array<{ cells: string[]; missing: string[] }> = []
      for (const brick of regularBrickTypes) {
        for (let offsetZ = 0; offsetZ < brick.depth; offsetZ += 1) {
          for (let offsetX = 0; offsetX < brick.width; offsetX += 1) {
            const placement = { ...brick, x: x - offsetX, z: z - offsetZ }
            const cells = placementCells(placement)
            if (!cells.some((cell) => below.has(cell))) continue
            const missing = cells.filter((cell) => !layer.has(cell))
            if (missing.length <= 2) bridgeCandidates.push({ cells, missing })
          }
        }
      }
      bridgeCandidates.sort((source, target) =>
        source.missing.length - target.missing.length || source.cells.length - target.cells.length
      )
      const bridge = bridgeCandidates[0]
      if (bridge) {
        for (const missingKey of bridge.missing) {
          const [supportX, supportZ] = missingKey.split(',').map(Number)
          layer.add(missingKey)
          repaired.add(cellKey(supportX, y, supportZ))
          bridgeAdded += 1
        }
        continue
      }

      for (let supportY = y - 1; supportY >= 0; supportY -= 1) {
        const supportKey = cellKey(x, supportY, z)
        if (repaired.has(supportKey)) break
        repaired.add(supportKey)
        columnAdded += 1
      }
    }
  }
  return { occupied: repaired, added: bridgeAdded + columnAdded }
}

const isBoundaryCell = (key: string, layer: Set<string>) => {
  const [x, z] = key.split(',').map(Number)
  return [
    layerCellKey(x - 1, z),
    layerCellKey(x + 1, z),
    layerCellKey(x, z - 1),
    layerCellKey(x, z + 1),
  ].some((neighbor) => !layer.has(neighbor))
}

const placementsContaining = (
  targetX: number,
  targetZ: number,
  layer: Set<string>,
  aboveLayer: Set<string>,
  belowConnectors: Set<string>,
  unassigned: Set<string>,
  forcedColumns: Set<string>,
) => {
  const placements: Placement[] = []
  for (const brick of orientedBrickTypes) {
    for (let offsetZ = 0; offsetZ < brick.depth; offsetZ += 1) {
      for (let offsetX = 0; offsetX < brick.width; offsetX += 1) {
        const placement = { ...brick, x: targetX - offsetX, z: targetZ - offsetZ }
        const cells = placementCells(placement)
        if (!cells.every((key) => layer.has(key) && unassigned.has(key))) continue
        if (cells.some((key) => forcedColumns.has(key)) && (brick.id !== 'brick-1x1' || cells.length !== 1)) continue
        if (brick.isSlope && brick.highOffset) {
          const highKey = layerCellKey(placement.x + brick.highOffset[0], placement.z + brick.highOffset[1])
          const lowKey = cells.find((key) => key !== highKey)
          if (!aboveLayer.has(highKey) || (lowKey && aboveLayer.has(lowKey))) continue
        }
        const connectorCells = placementTopConnectorCells(placement)
        const supportCells = cells.filter((key) => belowConnectors.has(key))
        placements.push({ ...placement, cells, connectorCells, supportCells })
      }
    }
  }
  return placements
}

const tileLayer = (
  layer: Set<string>,
  aboveLayer: Set<string>,
  belowBrickByConnector: Map<string, number>,
  y: number,
  forcedColumns: Set<string>,
  findComponent: (index: number) => number,
): LayerTiling => {
  const unassigned = new Set(layer)
  const placements: Placement[] = []
  const brickByConnector = new Map<string, number>()
  const belowConnectors = new Set(belowBrickByConnector.keys())
  const candidatesByCell = new Map<string, Placement[]>()
  const supportedCandidatesByCell = new Map<string, Placement[]>()

  for (const key of layer) {
    const [x, z] = key.split(',').map(Number)
    const candidates = placementsContaining(x, z, layer, aboveLayer, belowConnectors, layer, forcedColumns)
    candidatesByCell.set(key, candidates)
    supportedCandidatesByCell.set(key, y === 0 ? candidates : candidates.filter((candidate) => candidate.supportCells.length > 0))
  }

  while (unassigned.size > 0) {
    let selectedTarget: { x: number; z: number; key: string } | undefined
    let selectedCandidates: Placement[] = []
    let selectedPriority = Infinity
    for (const key of unassigned) {
      const [x, z] = key.split(',').map(Number)
      const candidates = (supportedCandidatesByCell.get(key) ?? [])
        .filter((candidate) => candidate.cells.every((cell) => unassigned.has(cell)))
      const forcedPenalty = forcedColumns.has(key) ? -2000 : 0
      const unsupportedPenalty = y > 0 && !belowConnectors.has(key) ? -1000 : 0
      const priority = forcedPenalty + unsupportedPenalty + candidates.length
      if (priority >= selectedPriority) continue
      selectedPriority = priority
      selectedTarget = { x, z, key }
      selectedCandidates = candidates
    }
    if (!selectedTarget) break

    const candidates = selectedCandidates.length > 0
      ? selectedCandidates
      : (candidatesByCell.get(selectedTarget.key) ?? [])
        .filter((candidate) => candidate.cells.every((cell) => unassigned.has(cell)))
    const scored = candidates.map((candidate) => {
      const area = candidate.cells.length
      const boundaryCount = candidate.cells.filter((key) => isBoundaryCell(key, layer)).length
      const belowBricks = new Set(candidate.supportCells.map((key) => belowBrickByConnector.get(key)).filter((value): value is number => value !== undefined))
      const belowComponents = new Set([...belowBricks].map(findComponent))
      const preferredOrientation = y % 2 === 0 ? candidate.width > candidate.depth : candidate.width <= candidate.depth
      const slopeBonus = candidate.isSlope ? 1500 : 0
      const score = area * 20 - boundaryCount * Math.max(0, area - 2) * 6 + belowBricks.size * 12 + belowComponents.size * 1000 + slopeBonus + (preferredOrientation ? 5 : 0)
      return { candidate, score }
    }).sort((source, target) =>
      target.score - source.score ||
      target.candidate.cells.length - source.candidate.cells.length ||
      source.candidate.id.localeCompare(target.candidate.id) ||
      source.candidate.rotationQuarterTurns - target.candidate.rotationQuarterTurns
    )
    const placement: Placement = scored[0]?.candidate ?? {
      ...oneByOneBrick,
      x: selectedTarget.x,
      z: selectedTarget.z,
      cells: [selectedTarget.key],
      connectorCells: [selectedTarget.key],
      supportCells: belowConnectors.has(selectedTarget.key) ? [selectedTarget.key] : [],
    }
    const placementIndex = placements.length
    placements.push(placement)
    placement.cells.forEach((key) => unassigned.delete(key))
    placement.connectorCells.forEach((key) => brickByConnector.set(key, placementIndex))
  }
  return { placements, brickByConnector }
}

const analyzeTiledBricks = (
  sourceBricks: Array<Placement & { y: number }>,
  dimensions: Dimensions,
): TiledVoxels => {
  const bricks = sourceBricks.map((brick) => ({ ...brick, supportCells: [...brick.supportCells] }))
  const brickIndicesByLayer = Array.from({ length: dimensions.height }, () => [] as number[])
  bricks.forEach((brick, index) => brickIndicesByLayer[brick.y]?.push(index))
  const parents = bricks.map((_, index) => index)
  const findComponent = (sourceIndex: number) => {
    let index = sourceIndex
    let root = index
    while (parents[root] !== root) root = parents[root]
    while (parents[index] !== index) {
      const next = parents[index]
      parents[index] = root
      index = next
    }
    return root
  }
  const unionComponents = (source: number, target: number) => {
    const sourceRoot = findComponent(source)
    const targetRoot = findComponent(target)
    if (sourceRoot !== targetRoot) parents[targetRoot] = sourceRoot
  }
  const unsupported: TiledVoxels['unsupported'] = []
  let previousBrickByConnector = new Map<string, number>()

  for (let y = 0; y < dimensions.height; y += 1) {
    const layerBrickIndices = brickIndicesByLayer[y]
    if (layerBrickIndices.length === 0) {
      previousBrickByConnector = new Map()
      continue
    }

    const globalBrickByConnector = new Map<string, number>()
    for (const brickIndex of layerBrickIndices) {
      const brick = bricks[brickIndex]
      brick.supportCells = brick.cells.filter((key) => previousBrickByConnector.has(key))
      const supportingBricks = new Set(brick.supportCells
        .map((key) => previousBrickByConnector.get(key))
        .filter((value): value is number => value !== undefined))
      for (const supportingBrick of supportingBricks) unionComponents(brickIndex, supportingBrick)
      if (y > 0 && brick.supportCells.length === 0) {
        const [x, z] = brick.connectorCells[0].split(',').map(Number)
        unsupported.push({ x, y, z, cells: brick.cells })
      }
      brick.connectorCells.forEach((key) => globalBrickByConnector.set(key, brickIndex))
    }
    previousBrickByConnector = globalBrickByConnector
  }

  const componentByBrickIndex = bricks.map((_, index) => findComponent(index))
  return {
    bricks,
    unsupported,
    componentByBrickIndex,
    componentCount: new Set(componentByBrickIndex).size,
  }
}

const mergeDisconnectedPlacements = (tiled: TiledVoxels, dimensions: Dimensions) => {
  let current = tiled

  for (let attempt = 0; attempt < 24 && current.componentCount > 1; attempt += 1) {
    const brickIndexByLayerCell = new Map<string, number>()
    current.bricks.forEach((brick, brickIndex) => {
      brick.cells.forEach((key) => brickIndexByLayerCell.set(`${brick.y}:${key}`, brickIndex))
    })
    const candidates: Array<{
      placement: Placement & { y: number }
      ownerIndices: number[]
      bridgedComponentCount: number
    }> = []
    const seenPlacements = new Set<string>()

    for (let y = 0; y < dimensions.height; y += 1) {
      for (const brick of regularBrickTypes) {
        for (let z = 0; z <= dimensions.depth - brick.depth; z += 1) {
          for (let x = 0; x <= dimensions.width - brick.width; x += 1) {
            const placementKey = `${y}:${brick.id}:${x},${z}:${brick.rotationQuarterTurns}`
            if (seenPlacements.has(placementKey)) continue
            seenPlacements.add(placementKey)
            const placement = { ...brick, x, y, z }
            const cells = placementCells(placement)
            const ownerIndices = [...new Set(cells
              .map((key) => brickIndexByLayerCell.get(`${y}:${key}`))
              .filter((value): value is number => value !== undefined))]
            if (ownerIndices.length < 2 || cells.some((key) => !brickIndexByLayerCell.has(`${y}:${key}`))) continue
            if (ownerIndices.some((index) => current.bricks[index].isSlope)) continue
            const cellSet = new Set(cells)
            if (ownerIndices.some((index) => current.bricks[index].cells.some((key) => !cellSet.has(key)))) continue
            const bridgedComponents = new Set(ownerIndices.map((index) => current.componentByBrickIndex[index]))
            if (bridgedComponents.size < 2) continue
            candidates.push({
              placement: {
                ...placement,
                cells,
                connectorCells: placementTopConnectorCells(placement),
                supportCells: [],
              },
              ownerIndices,
              bridgedComponentCount: bridgedComponents.size,
            })
          }
        }
      }
    }

    candidates.sort((source, target) =>
      target.bridgedComponentCount - source.bridgedComponentCount ||
      source.placement.cells.length - target.placement.cells.length ||
      target.ownerIndices.length - source.ownerIndices.length ||
      source.placement.id.localeCompare(target.placement.id)
    )
    let merged = false
    for (const candidate of candidates) {
      const ownerIndexSet = new Set(candidate.ownerIndices)
      const insertionIndex = Math.min(...candidate.ownerIndices)
      const nextBricks = current.bricks.flatMap((brick, index) => {
        if (index === insertionIndex) return [candidate.placement]
        return ownerIndexSet.has(index) ? [] : [brick]
      })
      const analyzed = analyzeTiledBricks(nextBricks, dimensions)
      if (analyzed.componentCount >= current.componentCount) continue
      current = analyzed
      merged = true
      break
    }
    if (!merged) break
  }

  return current
}

const addMinimalComponentBridges = (
  tiled: TiledVoxels,
  occupied: Set<string>,
  dimensions: Dimensions,
) => {
  let current = tiled
  let added = 0

  for (let attempt = 0; attempt < 24 && current.componentCount > 1; attempt += 1) {
    const brickIndexByLayerCell = new Map<string, number>()
    current.bricks.forEach((brick, brickIndex) => {
      brick.cells.forEach((key) => brickIndexByLayerCell.set(`${brick.y}:${key}`, brickIndex))
    })
    const candidates: Array<{
      placement: Placement & { y: number }
      ownerIndices: number[]
      missingCells: string[]
      bridgedComponentCount: number
    }> = []

    for (let y = 1; y < dimensions.height; y += 1) {
      const belowComponentByConnector = new Map<string, number>()
      current.bricks.forEach((brick, brickIndex) => {
        if (brick.y !== y - 1) return
        const component = current.componentByBrickIndex[brickIndex]
        brick.connectorCells.forEach((key) => belowComponentByConnector.set(key, component))
      })
      if (belowComponentByConnector.size === 0) continue

      for (const brick of regularBrickTypes) {
        for (let z = 0; z <= dimensions.depth - brick.depth; z += 1) {
          for (let x = 0; x <= dimensions.width - brick.width; x += 1) {
            const placement = { ...brick, x, y, z }
            const cells = placementCells(placement)
            const bridgedComponents = new Set(cells
              .map((key) => belowComponentByConnector.get(key))
              .filter((value): value is number => value !== undefined))
            if (bridgedComponents.size < 2) continue
            const ownerIndices = [...new Set(cells
              .map((key) => brickIndexByLayerCell.get(`${y}:${key}`))
              .filter((value): value is number => value !== undefined))]
            if (ownerIndices.some((index) => current.bricks[index].isSlope)) continue
            const cellSet = new Set(cells)
            if (ownerIndices.some((index) => current.bricks[index].cells.some((key) => !cellSet.has(key)))) continue
            const missingCells = cells
              .filter((key) => !brickIndexByLayerCell.has(`${y}:${key}`))
              .map((key) => {
                const [cellX, cellZ] = key.split(',').map(Number)
                return cellKey(cellX, y, cellZ)
              })
            if (missingCells.length > 2) continue

            const candidatePlacement: Placement & { y: number } = {
              ...placement,
              cells,
              connectorCells: placementTopConnectorCells(placement),
              supportCells: [],
            }
            candidates.push({
              placement: candidatePlacement,
              ownerIndices,
              missingCells,
              bridgedComponentCount: bridgedComponents.size,
            })
          }
        }
      }
    }

    candidates.sort((source, target) =>
      source.missingCells.length - target.missingCells.length ||
      target.bridgedComponentCount - source.bridgedComponentCount ||
      source.placement.cells.length - target.placement.cells.length ||
      target.ownerIndices.length - source.ownerIndices.length ||
      source.placement.y - target.placement.y
    )
    let selected: { candidate: (typeof candidates)[number]; analyzed: TiledVoxels } | undefined
    for (const candidate of candidates) {
      const ownerIndexSet = new Set(candidate.ownerIndices)
      const insertionIndex = candidate.ownerIndices.length > 0 ? Math.min(...candidate.ownerIndices) : current.bricks.length
      const nextBricks = current.bricks.flatMap((source, index) => {
        if (index === insertionIndex) return [candidate.placement]
        return ownerIndexSet.has(index) ? [] : [source]
      })
      if (insertionIndex === current.bricks.length) nextBricks.push(candidate.placement)
      const analyzed = analyzeTiledBricks(nextBricks, dimensions)
      if (analyzed.componentCount >= current.componentCount) continue
      selected = { candidate, analyzed }
      break
    }
    if (selected) {
      selected.candidate.missingCells.forEach((key) => occupied.add(key))
      added += selected.candidate.missingCells.length
      current = selected.analyzed
      continue
    }

    const componentSizes = new Map<number, number>()
    current.componentByBrickIndex.forEach((component) => {
      componentSizes.set(component, (componentSizes.get(component) ?? 0) + 1)
    })
    const extensionComponents = [...componentSizes]
      .sort((source, target) => source[1] - target[1])
      .map(([component]) => component)
    let extended = false
    for (const component of extensionComponents) {
      const componentBricks = current.bricks.flatMap((brick, index) =>
        current.componentByBrickIndex[index] === component ? [{ brick, index }] : [])
      const topY = Math.max(...componentBricks.map(({ brick }) => brick.y))
      const nextY = topY + 1
      if (nextY >= dimensions.height) continue
      const sourceBricks = componentBricks.filter(({ brick }) => brick.y === topY)
      const targetBricks = current.bricks.flatMap((brick, index) => (
        brick.y === nextY && current.componentByBrickIndex[index] !== component
          ? [{ brick, index }]
          : []
      ))
      const extensionOptions = sourceBricks.flatMap(({ brick: source }) =>
        source.connectorCells.flatMap((sourceKey) => {
          const [sourceX, sourceZ] = sourceKey.split(',').map(Number)
          if (brickIndexByLayerCell.has(`${nextY}:${sourceKey}`)) return []
          return targetBricks.flatMap(({ brick: target }) =>
            target.connectorCells.flatMap((targetKey) => {
              const [targetX, targetZ] = targetKey.split(',').map(Number)
              const spanWidth = Math.abs(targetX - sourceX) + 1
              const spanDepth = Math.abs(targetZ - sourceZ) + 1
              const bridgeArea = regularBrickTypes.reduce((smallest, candidate) => (
                candidate.width >= spanWidth && candidate.depth >= spanDepth
                  ? Math.min(smallest, candidate.width * candidate.depth)
                  : smallest
              ), Infinity)
              return Number.isFinite(bridgeArea)
                ? [{ sourceX, sourceZ, bridgeArea, distance: spanWidth + spanDepth - 2 }]
                : []
            })
          )
        })
      ).sort((source, target) =>
        source.bridgeArea - target.bridgeArea || source.distance - target.distance
      )
      const extension = extensionOptions[0]
      if (!extension) continue
      const placement: Placement & { y: number } = {
        ...oneByOneBrick,
        x: extension.sourceX,
        y: nextY,
        z: extension.sourceZ,
        cells: [layerCellKey(extension.sourceX, extension.sourceZ)],
        connectorCells: [layerCellKey(extension.sourceX, extension.sourceZ)],
        supportCells: [layerCellKey(extension.sourceX, extension.sourceZ)],
      }
      const analyzed = analyzeTiledBricks([...current.bricks, placement], dimensions)
      if (analyzed.componentCount > current.componentCount) continue
      occupied.add(cellKey(extension.sourceX, nextY, extension.sourceZ))
      added += 1
      current = analyzed
      extended = true
      break
    }
    if (!extended) break
  }

  return { tiled: current, added }
}

const tileVoxels = (occupied: Set<string>, dimensions: Dimensions, forcedColumns = new Set<string>()): TiledVoxels => {
  const bricks: Array<Placement & { y: number }> = []
  const unsupported: TiledVoxels['unsupported'] = []
  let previousBrickByConnector = new Map<string, number>()
  const layers = Array.from({ length: dimensions.height }, () => new Set<string>())
  for (const key of occupied) {
    const [x, y, z] = parseCellKey(key)
    layers[y]?.add(layerCellKey(x, z))
  }
  const parents: number[] = []
  const findComponent = (sourceIndex: number) => {
    let index = sourceIndex
    let root = index
    while (parents[root] !== root) root = parents[root]
    while (parents[index] !== index) {
      const next = parents[index]
      parents[index] = root
      index = next
    }
    return root
  }
  const unionComponents = (source: number, target: number) => {
    const sourceRoot = findComponent(source)
    const targetRoot = findComponent(target)
    if (sourceRoot !== targetRoot) parents[targetRoot] = sourceRoot
  }

  for (let y = 0; y < dimensions.height; y += 1) {
    const layer = layers[y]
    const aboveLayer = layers[y + 1] ?? new Set<string>()
    if (layer.size === 0) {
      previousBrickByConnector = new Map()
      continue
    }
    const tiled = tileLayer(layer, aboveLayer, previousBrickByConnector, y, forcedColumns, findComponent)
    const globalBrickByConnector = new Map<string, number>()
    tiled.placements.forEach((placement) => {
      const brickIndex = bricks.length
      bricks.push({ ...placement, y })
      parents.push(brickIndex)
      const supportingBricks = new Set(placement.supportCells.map((key) => previousBrickByConnector.get(key)).filter((value): value is number => value !== undefined))
      for (const supportingBrick of supportingBricks) unionComponents(brickIndex, supportingBrick)
      if (y > 0 && placement.supportCells.length === 0) {
        const [x, z] = placement.connectorCells[0].split(',').map(Number)
        unsupported.push({ x, y, z, cells: placement.cells })
      }
      placement.connectorCells.forEach((key) => globalBrickByConnector.set(key, brickIndex))
    })
    previousBrickByConnector = globalBrickByConnector
  }
  return analyzeTiledBricks(bricks, dimensions)
}

const sanitizeId = (value: string) => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'model'

const convertMeshAtResolution = (
  mesh: Mesh,
  resolution: number,
  onProgress: (progress: ObjImportProgress) => void,
) => {
  const normalized = normalizeMesh(mesh, resolution)
  onProgress({ stage: 'voxelize', progress: 0.25 })
  const voxelized = voxelizeMesh(normalized)
  const connected = keepLargestComponent(voxelized.occupied)

  onProgress({ stage: 'repair', progress: 0.56 })
  const repaired = addMinimalSupports(connected.occupied, normalized.dimensions)
  const finalOccupied = new Set(repaired.occupied)
  let prunedUnsupportedVoxels = 0
  let tiled: TiledVoxels = { bricks: [], unsupported: [], componentCount: 0, componentByBrickIndex: [] }

  onProgress({ stage: 'tile', progress: 0.68 })
  for (let attempt = 0; attempt < 8; attempt += 1) {
    tiled = tileVoxels(finalOccupied, normalized.dimensions)
    if (tiled.unsupported.length === 0) break
    let removedThisAttempt = 0
    for (const unsupported of tiled.unsupported) {
      for (const layerKey of unsupported.cells) {
        const [x, z] = layerKey.split(',').map(Number)
        if (finalOccupied.delete(cellKey(x, unsupported.y, z))) {
          prunedUnsupportedVoxels += 1
          removedThisAttempt += 1
        }
      }
    }
    if (removedThisAttempt === 0) break
    if (attempt === 7) tiled = tileVoxels(finalOccupied, normalized.dimensions)
  }
  tiled = mergeDisconnectedPlacements(tiled, normalized.dimensions)
  const connectivityRepair = addMinimalComponentBridges(tiled, finalOccupied, normalized.dimensions)
  tiled = connectivityRepair.tiled

  return {
    normalized,
    voxelized,
    connected,
    repaired,
    finalOccupied,
    prunedUnsupportedVoxels,
    addedConnectivityVoxels: connectivityRepair.added,
    tiled,
  }
}

export const importObjToBrickPlan = (
  text: string,
  options: ObjImportOptions,
  onProgress: (progress: ObjImportProgress) => void = () => undefined,
): ObjImportResult => {
  const profile = objImportProfiles.find((candidate) => candidate.id === options.profileId) ?? objImportProfiles[0]
  const useCurvedEdges = options.edgeStyle === 'curved'
  const getConvertedBrickCount = (converted: ReturnType<typeof convertMeshAtResolution>) => converted.tiled.bricks.reduce(
    (total, placement) => total + (useCurvedEdges && placement.id === 'slope-1x2' ? 2 : 1),
    0,
  )
  onProgress({ stage: 'parse', progress: 0.08 })
  const orientedMesh = orientMesh(parseObj(text), options.orientation)
  const maxBricks = Number.isFinite(options.maxBricks) ? Math.max(1, options.maxBricks ?? Infinity) : Infinity
  let resolution = profile.resolution
  let converted = convertMeshAtResolution(orientedMesh, resolution, onProgress)
  for (let attempt = 0; attempt < 5 && getConvertedBrickCount(converted) > maxBricks && resolution > 8; attempt += 1) {
    const scale = Math.cbrt(maxBricks / getConvertedBrickCount(converted)) * 0.96
    const nextResolution = Math.max(8, Math.min(resolution - 1, Math.floor(resolution * scale)))
    if (nextResolution >= resolution) break
    resolution = nextResolution
    converted = convertMeshAtResolution(orientedMesh, resolution, onProgress)
  }
  const { normalized, voxelized, connected, repaired, finalOccupied, prunedUnsupportedVoxels, addedConnectivityVoxels, tiled } = converted
  if (tiled.bricks.length === 0) throw new Error('OBJ_EMPTY_PLAN')

  onProgress({ stage: 'finalize', progress: 0.94 })
  const prefix = sanitizeId(options.idPrefix)
  const materialPalette = parseMtlPalette(options.materialText)
  const useMaterials = options.colorMode === 'materials' && materialPalette.size > 0
  const materialColorCounts = new Map<string, Map<BrickColor, number>>()
  const getPlacementColor = (placement: (typeof tiled.bricks)[number], brickId: string): BrickColor => {
      if (!useMaterials) return options.color
      const counts = new Map<string, number>()
      for (const layerKey of placement.cells) {
        const [x, z] = layerKey.split(',').map(Number)
        const material = voxelized.materialByCell.get(cellKey(x, placement.y, z))
        if (material && materialPalette.has(material)) counts.set(material, (counts.get(material) ?? 0) + 1)
      }
      const material = [...counts.entries()].sort((source, target) => target[1] - source[1])[0]?.[0]
      const sourceColor = material ? materialPalette.get(material) : undefined
      if (!material || !sourceColor) return options.color
      const mappedColor = mapMaterialColorToBrick(sourceColor, brickId, options.color)
      const mappedCounts = materialColorCounts.get(material) ?? new Map<BrickColor, number>()
      mappedCounts.set(mappedColor, (mappedCounts.get(mappedColor) ?? 0) + 1)
      materialColorCounts.set(material, mappedCounts)
      return mappedColor
  }
  const brickSpecs = tiled.bricks.flatMap((placement) => (
    useCurvedEdges && placement.id === 'slope-1x2'
      ? [
          { placement, brickId: 'plate-1x2', yOffsetStud: 0 },
          { placement, brickId: 'slope-curved-2x1-low', yOffsetStud: 0.4 },
        ]
      : [{ placement, brickId: placement.id, yOffsetStud: 0 }]
  ))
  const bricks: PlacedBrick[] = brickSpecs.map(({ placement, brickId, yOffsetStud }, index) => ({
    id: `piece-${prefix}-${index + 1}`,
    brickId,
    color: getPlacementColor(placement, brickId),
    pose: {
      xStud: placement.x,
      yStud: round(placement.y * layerHeightStuds + yOffsetStud),
      zStud: placement.z,
      rotationQuarterTurns: placement.rotationQuarterTurns as 0 | 1 | 2 | 3,
      verticalQuarterTurns: 0,
    },
  }))
  const nameById = new Map([
    ...[...baseBrickTypes, ...slopeBrickTypes].map((brick) => [brick.id, brick.name] as const),
    ['plate-1x2', '1x2 Plate'] as const,
    ['slope-curved-2x1-low', '2x1 Low Curved Slope'] as const,
  ])
  const title = options.title.trim() || 'Imported OBJ'
  const steps = bricks.map((brick, index) => {
    const name = nameById.get(brick.brickId) ?? brick.brickId
    return {
      id: `step-${prefix}-${index + 1}`,
      title: options.locale === 'zh' ? `放置 ${name}` : `Place ${name}`,
      description: options.locale === 'zh'
        ? `放置第 ${index + 1} 个零件：${name}。`
        : `Place part ${index + 1}: ${name}.`,
      brickIds: [brick.id],
    }
  })
  const structuralChanges = repaired.added + addedConnectivityVoxels + prunedUnsupportedVoxels
  const shapeMetrics = getShapeMetrics(connected.occupied, finalOccupied)
  const preview: ObjImportPreview = {
    front: createProjection(connected.occupied, finalOccupied, [0, 1], normalized.dimensions.width, normalized.dimensions.height),
    side: createProjection(connected.occupied, finalOccupied, [2, 1], normalized.dimensions.depth, normalized.dimensions.height),
    top: createProjection(connected.occupied, finalOccupied, [0, 2], normalized.dimensions.width, normalized.dimensions.depth),
  }
  const stats: ObjImportStats = {
    dimensions: normalized.dimensions,
    resolution,
    sourceVoxels: connected.occupied.size,
    finalVoxels: finalOccupied.size,
    removedComponentVoxels: connected.removed,
    addedSupportVoxels: repaired.added,
    addedConnectivityVoxels,
    prunedUnsupportedVoxels,
    brickCount: bricks.length,
    slopeCount: bricks.filter((brick) => brick.brickId === 'slope-1x2' || brick.brickId === 'slope-curved-2x1-low').length,
    curvedSlopeCount: bricks.filter((brick) => brick.brickId === 'slope-curved-2x1-low').length,
    componentCount: tiled.componentCount,
    structuralChangeRatio: structuralChanges / Math.max(1, connected.occupied.size),
    oddRayRatio: voxelized.diagnostics.oddRays / Math.max(1, voxelized.diagnostics.rays),
    materialCount: materialColorCounts.size,
    materialPalette: [...materialColorCounts.entries()].map(([material, counts]) => ({
      material,
      sourceHex: rgbToHex(materialPalette.get(material) ?? brickColorRgb[options.color]),
      mappedColor: [...counts.entries()].sort((source, target) => target[1] - source[1])[0]?.[0] ?? options.color,
      brickCount: [...counts.values()].reduce((total, count) => total + count, 0),
    })).sort((source, target) => target.brickCount - source.brickCount),
    ...shapeMetrics,
  }
  const plan: BuildPlan = {
    id: `plan-obj-${prefix}`,
    title,
    prompt: `${title} imported OBJ shape-preserving ${useMaterials ? 'multi-material ' : ''}brick model ${profile.label}`,
    source: 'template-local',
    bricks,
    steps,
  }
  onProgress({ stage: 'finalize', progress: 1 })
  return { plan, stats, preview }
}

export type ObjImportWorkerRequest = {
  type: 'import'
  file: File
  materialFiles?: File[]
  options: ObjImportOptions
}

export type ObjImportWorkerResponse =
  | { type: 'progress'; progress: ObjImportProgress }
  | { type: 'result'; result: ObjImportResult }
  | { type: 'error'; code: string }
