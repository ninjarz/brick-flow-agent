import { brickById } from '../data/basicBricks'
import type { BrickConnector, BrickDefinition, PlacedBrick } from '../types/bricks'
import {
  getLoadedLDrawGeneratedVisualTriangles,
  onLDrawGeneratedVisualLoaded,
} from './ldrawGeneratedVisualLoader'
import { getTriangleBounds, type BrickBounds } from './ldrawBounds'
import { normalizeLDrawPartNumber } from './ldrawPartNumbers'
import { getConnectorLocalPoint, transformBrickLocalPoint } from './brickUnits'
import { voxelizeMeshStructuralCells, type MeshTriangle } from './structuralVoxelizer'

export const STRUCTURAL_VOXEL_SIZE = 1 / 5
const STRUCTURAL_HASH_STEP = STRUCTURAL_VOXEL_SIZE
const COLLISION_INDEX_HASH_STEP = 1
const STRUCTURAL_OVERLAP_TOLERANCE = 0.000001
const WORLD_STRUCTURAL_CACHE_LIMIT = 5000
const structuralCellCache = new Map<string, StructuralCell[]>()
const renderStructuralCellCache = new Map<string, StructuralCell[]>()
const interactionStructuralCellCache = new Map<string, StructuralCell[]>()
const localSupportBoundsCache = new Map<string, BrickBounds | undefined>()
const localSupportFaceCache = new Map<string, WorldStructuralSupportFaces>()
const worldStructuralCellBoxCache = new Map<string, WorldStructuralCellBox[]>()
const worldRenderStructuralCellBoxCache = new Map<string, WorldStructuralCellBox[]>()
const worldSupportCellBoxCache = new Map<string, WorldStructuralCellBox[]>()
const worldSupportFaceCache = new Map<string, WorldStructuralSupportFaces>()
const worldSupportBoundsCache = new Map<string, BrickBounds | undefined>()
const worldCollisionCellBoxCache = new Map<string, WorldStructuralCellBox[]>()
const worldCollisionKeyCache = new Map<string, Set<string>>()
let structuralCacheVersion = 0

export const getStructuralCacheVersion = () => structuralCacheVersion

export type StructuralCellKind = 'solid' | 'stud' | 'socket' | 'studsocket' | 'enterable'
export type StructuralEntryDirection = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back'
export type StructuralConnectorKind = BrickConnector['kind']

export type StructuralCell = {
  kind: StructuralCellKind
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
  accepts?: StructuralConnectorKind[]
  entersFrom?: StructuralEntryDirection[]
}

export type WorldStructuralCell = StructuralCell & {
  key: string
}

export type WorldStructuralCellBox = StructuralCell

export type WorldStructuralSupportFace = {
  y: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type WorldStructuralSupportFaces = {
  top: WorldStructuralSupportFace[]
  bottom: WorldStructuralSupportFace[]
  topPlanes: Map<string, WorldStructuralSupportFace[]>
  bottomPlanes: Map<string, WorldStructuralSupportFace[]>
}

export type StructuralCollisionIndex = {
  keyToBrickIds: Map<string, Set<string>>
  brickKeys: Map<string, Set<string>>
  bricksById: Map<string, PlacedBrick>
}

const round = (value: number) => Number(value.toFixed(6))

const setLimitedWorldCache = <T>(cache: Map<string, T>, key: string, value: T) => {
  if (!cache.has(key) && cache.size >= WORLD_STRUCTURAL_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) cache.delete(oldestKey)
  }

  cache.set(key, value)
}

const structuralCellKindPriority: Record<StructuralCellKind, number> = {
  solid: 1,
  enterable: 2,
  stud: 3,
  socket: 3,
  studsocket: 3,
}

const makeCell = (
  kind: StructuralCellKind,
  minX: number,
  minY: number,
  minZ: number,
  sizeX = STRUCTURAL_VOXEL_SIZE,
  sizeY = STRUCTURAL_VOXEL_SIZE,
  sizeZ = STRUCTURAL_VOXEL_SIZE,
  extra: Pick<StructuralCell, 'accepts' | 'entersFrom'> = {},
): StructuralCell => ({
  kind,
  minX: round(minX),
  maxX: round(minX + sizeX),
  minY: round(minY),
  maxY: round(minY + sizeY),
  minZ: round(minZ),
  maxZ: round(minZ + sizeZ),
  ...extra,
})

const makeSolidBlockCells = (
  widthStuds: number,
  heightStuds: number,
  depthStuds: number,
) => [makeCell('solid', 0, 0, 0, widthStuds, heightStuds, depthStuds)]

const makeCellLocalKey = (cell: StructuralCell) =>
  `${cell.minX},${cell.minY},${cell.minZ}`

const axisEntryDirection: Record<BrickConnector['axis'], [StructuralEntryDirection, StructuralEntryDirection]> = {
  x: ['left', 'right'],
  y: ['bottom', 'top'],
  z: ['front', 'back'],
}

const connectorEntryDirection = (connector: BrickConnector): StructuralEntryDirection => {
  const direction = connector.direction ?? { x: 0, y: 1, z: 0 }
  const value = direction[connector.axis] ?? 1
  const [negativeDirection, positiveDirection] = axisEntryDirection[connector.axis]

  return value < 0 ? negativeDirection : positiveDirection
}

const makeAxisAlignedConnectorCell = (
  definition: BrickDefinition,
  connector: BrickConnector,
  kind: Extract<StructuralCellKind, 'stud' | 'socket' | 'studsocket'>,
  extra: Pick<StructuralCell, 'accepts'> = {},
): StructuralCell => {
  const localPoint = getConnectorLocalPoint(definition, connector)
  const direction = connector.direction?.[connector.axis] ?? 1
  const extendsPositive = kind === 'stud' ? direction >= 0 : direction < 0
  const min = {
    x: localPoint.x - STRUCTURAL_VOXEL_SIZE / 2,
    y: localPoint.y - STRUCTURAL_VOXEL_SIZE / 2,
    z: localPoint.z - STRUCTURAL_VOXEL_SIZE / 2,
  }

  min[connector.axis] = extendsPositive
    ? localPoint[connector.axis]
    : localPoint[connector.axis] - STRUCTURAL_VOXEL_SIZE

  return makeCell(
    kind,
    min.x,
    min.y,
    min.z,
    STRUCTURAL_VOXEL_SIZE,
    STRUCTURAL_VOXEL_SIZE,
    STRUCTURAL_VOXEL_SIZE,
    { ...extra, entersFrom: [connectorEntryDirection(connector)] },
  )
}

const structuralAxes = ['x', 'y', 'z'] as const

const getDefinitionAxisSize = (definition: BrickDefinition, axis: BrickConnector['axis']) => {
  if (axis === 'x') return definition.footprint.widthStuds
  if (axis === 'z') return definition.footprint.depthStuds
  return definition.footprint.heightStuds
}

const getVoxelMinContaining = (value: number) =>
  Math.floor((value + STRUCTURAL_OVERLAP_TOLERANCE) / STRUCTURAL_VOXEL_SIZE) * STRUCTURAL_VOXEL_SIZE

const cellFitsDefinitionAxis = (definition: BrickDefinition, axis: BrickConnector['axis'], min: number) =>
  min >= -STRUCTURAL_OVERLAP_TOLERANCE &&
  min + STRUCTURAL_VOXEL_SIZE <= getDefinitionAxisSize(definition, axis) + STRUCTURAL_OVERLAP_TOLERANCE

const makeSocketClearanceCells = (
  definition: BrickDefinition,
  connector: BrickConnector,
): StructuralCell[] => {
  const localPoint = getConnectorLocalPoint(definition, connector)
  const direction = connector.direction?.[connector.axis] ?? 1
  const interiorSign = direction < 0 ? 1 : -1
  const perpendicularAxes = structuralAxes.filter((axis) => axis !== connector.axis)
  const centerMins = {
    x: getVoxelMinContaining(localPoint.x),
    y: getVoxelMinContaining(localPoint.y),
    z: getVoxelMinContaining(localPoint.z),
  }
  const axisMin = interiorSign > 0
    ? localPoint[connector.axis]
    : localPoint[connector.axis] - STRUCTURAL_VOXEL_SIZE
  const cells: StructuralCell[] = []

  for (let firstOffset = -1; firstOffset <= 1; firstOffset += 1) {
    for (let secondOffset = -1; secondOffset <= 1; secondOffset += 1) {
      const min = {
        x: centerMins.x,
        y: centerMins.y,
        z: centerMins.z,
      }
      min[connector.axis] = axisMin
      min[perpendicularAxes[0]] = centerMins[perpendicularAxes[0]] + firstOffset * STRUCTURAL_VOXEL_SIZE
      min[perpendicularAxes[1]] = centerMins[perpendicularAxes[1]] + secondOffset * STRUCTURAL_VOXEL_SIZE

      if (!structuralAxes.every((axis) => cellFitsDefinitionAxis(definition, axis, min[axis]))) continue

      cells.push(makeCell(
        'enterable',
        min.x,
        min.y,
        min.z,
        STRUCTURAL_VOXEL_SIZE,
        STRUCTURAL_VOXEL_SIZE,
        STRUCTURAL_VOXEL_SIZE,
        { entersFrom: [connectorEntryDirection(connector)] },
      ))
    }
  }

  return cells
}

const makeConnectorCells = (definition: BrickDefinition) =>
  definition.connectors.flatMap((connector): StructuralCell[] => {
    if (connector.kind === 'stud' && connector.gender === 'male') {
      return [
        makeAxisAlignedConnectorCell(definition, connector, 'stud'),
      ]
    }

    if (connector.kind === 'tube' && connector.gender === 'female') {
      return [
        ...makeSocketClearanceCells(definition, connector),
        makeAxisAlignedConnectorCell(definition, connector, 'socket', { accepts: ['stud'] }),
      ]
    }

    if (connector.kind === 'studsocket' && connector.gender === 'bidirectional') {
      return [
        makeAxisAlignedConnectorCell(definition, connector, 'studsocket', { accepts: ['studsocket'] }),
      ]
    }

    return []
  })

const overlayStructuralCells = (...cellGroups: StructuralCell[][]) => {
  const cellsByKey = new Map<string, StructuralCell>()

  for (const cell of cellGroups.flat()) {
    const key = makeCellLocalKey(cell)
    const existing = cellsByKey.get(key)
    if (!existing || structuralCellKindPriority[cell.kind] >= structuralCellKindPriority[existing.kind]) {
      cellsByKey.set(key, cell)
    }
  }

  return Array.from(cellsByKey.values())
}

const makeMeshStructuralCells = (definition: BrickDefinition, triangles: MeshTriangle[]) => {
  const triangleBounds = getTriangleBounds(triangles)
  const bounds = triangleBounds ?? {
    minX: 0,
    maxX: definition.footprint.widthStuds,
    minY: 0,
    maxY: definition.footprint.heightStuds,
    minZ: 0,
    maxZ: definition.footprint.depthStuds,
  }

  const usesSlopeProfileEnvelope = definition.id === 'inverted-slope-3x2'

  return overlayStructuralCells(
    voxelizeMeshStructuralCells({
      minXStuds: bounds.minX,
      maxXStuds: bounds.maxX,
      minYStuds: bounds.minY,
      maxYStuds: bounds.maxY,
      minZStuds: bounds.minZ,
      maxZStuds: bounds.maxZ,
      voxelSize: STRUCTURAL_VOXEL_SIZE,
      triangles,
      surfaceVoxelMode: usesSlopeProfileEnvelope
        ? 'profile-envelope-x'
        : definition.kind === 'slope' ? 'preserve-shell' : 'thin-aware',
      bodyMaxYStuds: usesSlopeProfileEnvelope
        ? definition.footprint.heightStuds
        : undefined,
    }),
    makeConnectorCells(definition),
  )
}

const makeDefaultStructuralCells = (definition: BrickDefinition) => [
  ...makeSolidBlockCells(
    definition.footprint.widthStuds,
    definition.footprint.heightStuds,
    definition.footprint.depthStuds,
  ),
  ...makeConnectorCells(definition),
]

const nominalBlockStructureIds = new Set([
  'brick-1x1',
  'brick-1x2',
  'brick-1x3',
  'brick-1x4',
  'brick-1x6',
  'brick-2x2',
  'brick-2x3',
  'brick-2x4',
  'brick-2x8',
  'brick-trans-1x2',
  'plate-1x1',
  'plate-1x2',
  'plate-1x3',
  'plate-1x4',
  'plate-1x6',
  'plate-2x2',
  'plate-2x3',
  'plate-2x4',
  'plate-2x6',
  'plate-2x8',
  'plate-4x4',
  'plate-4x6',
  'plate-4x8',
  'plate-6x8',
  'plate-8x16',
  'tile-1x1',
  'tile-1x2',
  'tile-1x4',
  'tile-2x4',
])

const usesNominalBlockStructure = (definition: BrickDefinition) =>
  definition.kind === 'block' || nominalBlockStructureIds.has(definition.id)

const deleteDefinitionCacheEntries = <T>(cache: Map<string, T>, definitionIds: Set<string>) => {
  for (const key of cache.keys()) {
    const separatorIndex = key.indexOf(':')
    if (separatorIndex >= 0 && definitionIds.has(key.slice(0, separatorIndex))) cache.delete(key)
  }
}

onLDrawGeneratedVisualLoaded((partNumbers) => {
  const loadedPartNumbers = new Set(partNumbers)
  const affectedDefinitionIds = new Set(Array.from(brickById.values())
    .filter((definition) => (
      !usesNominalBlockStructure(definition)
      && loadedPartNumbers.has(normalizeLDrawPartNumber(definition.partNumber))
    ))
    .map((definition) => definition.id))
  if (affectedDefinitionIds.size === 0) return

  structuralCacheVersion += 1
  deleteDefinitionCacheEntries(structuralCellCache, affectedDefinitionIds)
  deleteDefinitionCacheEntries(renderStructuralCellCache, affectedDefinitionIds)
  deleteDefinitionCacheEntries(interactionStructuralCellCache, affectedDefinitionIds)
  deleteDefinitionCacheEntries(localSupportBoundsCache, affectedDefinitionIds)
  deleteDefinitionCacheEntries(localSupportFaceCache, affectedDefinitionIds)
  deleteDefinitionCacheEntries(worldStructuralCellBoxCache, affectedDefinitionIds)
  deleteDefinitionCacheEntries(worldRenderStructuralCellBoxCache, affectedDefinitionIds)
  deleteDefinitionCacheEntries(worldSupportCellBoxCache, affectedDefinitionIds)
  deleteDefinitionCacheEntries(worldSupportFaceCache, affectedDefinitionIds)
  deleteDefinitionCacheEntries(worldSupportBoundsCache, affectedDefinitionIds)
  deleteDefinitionCacheEntries(worldCollisionCellBoxCache, affectedDefinitionIds)
  deleteDefinitionCacheEntries(worldCollisionKeyCache, affectedDefinitionIds)
})

const makeStructuralDefinitionCacheKey = (definition: BrickDefinition) =>
  `${definition.id}:${definition.partNumber}:${definition.footprint.widthStuds},${definition.footprint.depthStuds},${definition.footprint.heightStuds}`

export const getBrickStructuralCells = (definition: BrickDefinition): StructuralCell[] => {
  const cacheKey = makeStructuralDefinitionCacheKey(definition)
  const cached = structuralCellCache.get(cacheKey)
  if (cached) return cached

  const structuralTriangles = usesNominalBlockStructure(definition)
    ? undefined
    : getLoadedLDrawGeneratedVisualTriangles(normalizeLDrawPartNumber(definition.partNumber))
  const cells = structuralTriangles
    ? makeMeshStructuralCells(definition, structuralTriangles)
    : makeDefaultStructuralCells(definition)

  structuralCellCache.set(cacheKey, cells)
  return cells
}

const subdivideStructuralCell = (cell: StructuralCell) => {
  const width = cell.maxX - cell.minX
  const height = cell.maxY - cell.minY
  const depth = cell.maxZ - cell.minZ
  const xCount = Math.max(1, Math.ceil((width - STRUCTURAL_OVERLAP_TOLERANCE) / STRUCTURAL_VOXEL_SIZE))
  const yCount = Math.max(1, Math.ceil((height - STRUCTURAL_OVERLAP_TOLERANCE) / STRUCTURAL_VOXEL_SIZE))
  const zCount = Math.max(1, Math.ceil((depth - STRUCTURAL_OVERLAP_TOLERANCE) / STRUCTURAL_VOXEL_SIZE))
  const cells: StructuralCell[] = []

  for (let x = 0; x < xCount; x += 1) {
    for (let y = 0; y < yCount; y += 1) {
      for (let z = 0; z < zCount; z += 1) {
        const minX = cell.minX + x * STRUCTURAL_VOXEL_SIZE
        const minY = cell.minY + y * STRUCTURAL_VOXEL_SIZE
        const minZ = cell.minZ + z * STRUCTURAL_VOXEL_SIZE
        cells.push(makeCell(
          cell.kind,
          minX,
          minY,
          minZ,
          Math.min(STRUCTURAL_VOXEL_SIZE, cell.maxX - minX),
          Math.min(STRUCTURAL_VOXEL_SIZE, cell.maxY - minY),
          Math.min(STRUCTURAL_VOXEL_SIZE, cell.maxZ - minZ),
          { accepts: cell.accepts, entersFrom: cell.entersFrom },
        ))
      }
    }
  }

  return cells
}

export const getBrickRenderStructuralCells = (definition: BrickDefinition) => {
  const cacheKey = makeStructuralDefinitionCacheKey(definition)
  const cached = renderStructuralCellCache.get(cacheKey)
  if (cached) return cached

  const structuralCells = getBrickStructuralCells(definition)
  // Mesh voxelization records all in-bounds empty cells as enterable so collision
  // and clearance analysis can distinguish arcs, cavities and open undersides.
  // Rendering that entire negative volume produces a misleading translucent box;
  // only directional connector clearances are useful in the visual voxel legend.
  const visibleStructuralCells = structuralCells.filter((cell) =>
    cell.kind !== 'enterable' || (cell.entersFrom?.length ?? 0) < 6
  )
  const hasMergedSolidBody = visibleStructuralCells.some((cell) =>
    cell.kind === 'solid' && (
      cell.maxX - cell.minX > STRUCTURAL_VOXEL_SIZE + STRUCTURAL_OVERLAP_TOLERANCE ||
      cell.maxY - cell.minY > STRUCTURAL_VOXEL_SIZE + STRUCTURAL_OVERLAP_TOLERANCE ||
      cell.maxZ - cell.minZ > STRUCTURAL_VOXEL_SIZE + STRUCTURAL_OVERLAP_TOLERANCE
    ),
  )
  const cells = hasMergedSolidBody
    ? overlayStructuralCells(
      visibleStructuralCells
        .filter((cell) => cell.kind === 'solid')
        .flatMap(subdivideStructuralCell),
      visibleStructuralCells.filter((cell) => cell.kind !== 'solid'),
    )
    : visibleStructuralCells

  renderStructuralCellCache.set(cacheKey, cells)
  return cells
}

type StructuralMergeAxis = 'x' | 'y' | 'z'

const getStructuralMergeGroupKey = (cell: StructuralCell, axis: StructuralMergeAxis) => {
  const metadata = `${cell.kind}:${cell.accepts?.join(',') ?? ''}:${cell.entersFrom?.join(',') ?? ''}`
  if (axis === 'x') return `${metadata}:${cell.minY},${cell.maxY}:${cell.minZ},${cell.maxZ}`
  if (axis === 'y') return `${metadata}:${cell.minX},${cell.maxX}:${cell.minZ},${cell.maxZ}`
  return `${metadata}:${cell.minX},${cell.maxX}:${cell.minY},${cell.maxY}`
}

const getStructuralAxisStart = (cell: StructuralCell, axis: StructuralMergeAxis) =>
  axis === 'x' ? cell.minX : axis === 'y' ? cell.minY : cell.minZ

const getStructuralAxisEnd = (cell: StructuralCell, axis: StructuralMergeAxis) =>
  axis === 'x' ? cell.maxX : axis === 'y' ? cell.maxY : cell.maxZ

const extendStructuralCell = (
  cell: StructuralCell,
  next: StructuralCell,
  axis: StructuralMergeAxis,
): StructuralCell => {
  if (axis === 'x') return { ...cell, maxX: next.maxX }
  if (axis === 'y') return { ...cell, maxY: next.maxY }
  return { ...cell, maxZ: next.maxZ }
}

const mergeStructuralCellsAlongAxis = (
  cells: StructuralCell[],
  axis: StructuralMergeAxis,
) => {
  const groups = new Map<string, StructuralCell[]>()

  for (const cell of cells) {
    const key = getStructuralMergeGroupKey(cell, axis)
    const group = groups.get(key)
    if (group) group.push(cell)
    else groups.set(key, [cell])
  }

  const merged: StructuralCell[] = []
  for (const group of groups.values()) {
    group.sort((source, target) => getStructuralAxisStart(source, axis) - getStructuralAxisStart(target, axis))
    let current = group[0]

    for (let index = 1; index < group.length; index += 1) {
      const next = group[index]
      if (Math.abs(getStructuralAxisEnd(current, axis) - getStructuralAxisStart(next, axis)) <= STRUCTURAL_OVERLAP_TOLERANCE) {
        current = extendStructuralCell(current, next, axis)
      } else {
        merged.push(current)
        current = next
      }
    }

    if (current) merged.push(current)
  }

  return merged
}

const compactStructuralCells = (cells: StructuralCell[]) => {
  const passthroughCells = cells.filter((cell) => cell.kind !== 'solid')
  let solidCells = cells.filter((cell) => cell.kind === 'solid')
  let previousCount = -1

  while (solidCells.length !== previousCount) {
    previousCount = solidCells.length
    solidCells = mergeStructuralCellsAlongAxis(solidCells, 'x')
    solidCells = mergeStructuralCellsAlongAxis(solidCells, 'z')
    solidCells = mergeStructuralCellsAlongAxis(solidCells, 'y')
  }

  return [...solidCells, ...passthroughCells]
}

export const getBrickInteractionStructuralCells = (definition: BrickDefinition) => {
  const cacheKey = makeStructuralDefinitionCacheKey(definition)
  const cached = interactionStructuralCellCache.get(cacheKey)
  if (cached) return cached

  const cells = compactStructuralCells(
    getBrickStructuralCells(definition).filter(structuralCellBlocksCollision),
  )
  interactionStructuralCellCache.set(cacheKey, cells)
  return cells
}

const transformLocalBox = (
  definition: BrickDefinition,
  brick: PlacedBrick,
  bounds: BrickBounds,
): BrickBounds => {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (let xIndex = 0; xIndex < 2; xIndex += 1) {
    for (let yIndex = 0; yIndex < 2; yIndex += 1) {
      for (let zIndex = 0; zIndex < 2; zIndex += 1) {
        const x = xIndex === 0 ? bounds.minX : bounds.maxX
        const y = yIndex === 0 ? bounds.minY : bounds.maxY
        const z = zIndex === 0 ? bounds.minZ : bounds.maxZ
        const point = transformBrickLocalPoint(definition, brick.pose, { x, y, z })
        minX = Math.min(minX, point.x)
        maxX = Math.max(maxX, point.x)
        minY = Math.min(minY, point.y)
        maxY = Math.max(maxY, point.y)
        minZ = Math.min(minZ, point.z)
        maxZ = Math.max(maxZ, point.z)
      }
    }
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
  }
}

const transformStructuralCellBox = (
  definition: BrickDefinition,
  brick: PlacedBrick,
  cell: StructuralCell,
): WorldStructuralCellBox => {
  const bounds = transformLocalBox(definition, brick, cell)

  return {
    ...cell,
    ...bounds,
  }
}

const hashCoordinate = (value: number, step = STRUCTURAL_HASH_STEP) =>
{
  const scaled = value / step
  const nearest = Math.round(scaled)
  return Math.abs(scaled - nearest) < 0.000001 ? nearest : Math.floor(scaled)
}

const makeKey = (x: number, y: number, z: number) =>
  `${x},${y},${z}`

const getCellHashKeys = (
  cell: Pick<StructuralCell, 'minX' | 'maxX' | 'minY' | 'maxY' | 'minZ' | 'maxZ'>,
  step = STRUCTURAL_HASH_STEP,
) => {
  const minX = hashCoordinate(cell.minX, step)
  const maxX = hashCoordinate(cell.maxX - 0.000001, step)
  const minY = hashCoordinate(cell.minY, step)
  const maxY = hashCoordinate(cell.maxY - 0.000001, step)
  const minZ = hashCoordinate(cell.minZ, step)
  const maxZ = hashCoordinate(cell.maxZ - 0.000001, step)
  const keys: string[] = []

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        keys.push(makeKey(x, y, z))
      }
    }
  }

  return keys
}

const getPlacedBrickCacheKey = (brick: PlacedBrick) =>
  `${brick.brickId}:${brick.pose.xStud},${brick.pose.yStud},${brick.pose.zStud},${brick.pose.rotationQuarterTurns},${brick.pose.verticalQuarterTurns ?? 0}`

export const getBrickWorldStructuralCellBoxes = (brick: PlacedBrick): WorldStructuralCellBox[] => {
  const cacheKey = getPlacedBrickCacheKey(brick)
  const cached = worldStructuralCellBoxCache.get(cacheKey)
  if (cached) return cached

  const definition = brickById.get(brick.brickId)
  if (!definition) return []

  const boxes = getBrickStructuralCells(definition).map((cell) =>
    transformStructuralCellBox(definition, brick, cell)
  )

  setLimitedWorldCache(worldStructuralCellBoxCache, cacheKey, boxes)
  return boxes
}

export const getBrickWorldRenderStructuralCellBoxes = (brick: PlacedBrick): WorldStructuralCellBox[] => {
  const cacheKey = getPlacedBrickCacheKey(brick)
  const cached = worldRenderStructuralCellBoxCache.get(cacheKey)
  if (cached) return cached

  const definition = brickById.get(brick.brickId)
  if (!definition) return []

  const boxes = getBrickRenderStructuralCells(definition).map((cell) =>
    transformStructuralCellBox(definition, brick, cell)
  )

  setLimitedWorldCache(worldRenderStructuralCellBoxCache, cacheKey, boxes)
  return boxes
}

export const getBrickWorldStructuralCells = (brick: PlacedBrick): WorldStructuralCell[] =>
  getBrickWorldStructuralCellBoxes(brick).flatMap((worldCell) =>
    getCellHashKeys(worldCell).map((key) => ({ ...worldCell, key }))
  )

export const structuralCellBlocksCollision = (cell: Pick<StructuralCell, 'kind'>) =>
  cell.kind === 'solid' || cell.kind === 'studsocket'

const supportCellCenterTolerance = 0.000001

const cellCenterIsInsideNominalBody = (definition: BrickDefinition, cell: StructuralCell) => {
  const centerX = (cell.minX + cell.maxX) / 2
  const centerY = (cell.minY + cell.maxY) / 2
  const centerZ = (cell.minZ + cell.maxZ) / 2

  return (
    centerX >= -supportCellCenterTolerance &&
    centerX <= definition.footprint.widthStuds + supportCellCenterTolerance &&
    centerY >= -supportCellCenterTolerance &&
    centerY <= definition.footprint.heightStuds + supportCellCenterTolerance &&
    centerZ >= -supportCellCenterTolerance &&
    centerZ <= definition.footprint.depthStuds + supportCellCenterTolerance
  )
}

const supportCellCarriesLoad = (definition: BrickDefinition, cell: StructuralCell) =>
  structuralCellBlocksCollision(cell) && cellCenterIsInsideNominalBody(definition, cell)

const getBrickLocalSupportCellBoxes = (definition: BrickDefinition) =>
  getBrickStructuralCells(definition).filter((cell) => supportCellCarriesLoad(definition, cell))

export const getBrickWorldSupportCellBoxes = (brick: PlacedBrick): WorldStructuralCellBox[] => {
  const cacheKey = getPlacedBrickCacheKey(brick)
  const cached = worldSupportCellBoxCache.get(cacheKey)
  if (cached) return cached

  const definition = brickById.get(brick.brickId)
  if (!definition) return []

  const boxes = getBrickLocalSupportCellBoxes(definition).map((cell) =>
    transformStructuralCellBox(definition, brick, cell)
  )

  setLimitedWorldCache(worldSupportCellBoxCache, cacheKey, boxes)
  return boxes
}

const makeSupportFaceKey = (
  y: number,
  box: Pick<WorldStructuralCellBox, 'minX' | 'maxX' | 'minZ' | 'maxZ'>,
) =>
  `${round(y)}:${round(box.minX)},${round(box.maxX)},${round(box.minZ)},${round(box.maxZ)}`

const makeSupportFace = (
  y: number,
  box: Pick<WorldStructuralCellBox, 'minX' | 'maxX' | 'minZ' | 'maxZ'>,
): WorldStructuralSupportFace => ({
  y: round(y),
  minX: round(box.minX),
  maxX: round(box.maxX),
  minZ: round(box.minZ),
  maxZ: round(box.maxZ),
})

const makeSupportFacePlaneKey = (y: number) => String(round(y))

const mergeSupportFaceRows = (faces: WorldStructuralSupportFace[]) => {
  const rowsByZ = new Map<string, WorldStructuralSupportFace[]>()

  for (const face of faces) {
    const key = `${face.y}:${face.minZ},${face.maxZ}`
    const rows = rowsByZ.get(key)
    if (rows) {
      rows.push(face)
    } else {
      rowsByZ.set(key, [face])
    }
  }

  const rows: WorldStructuralSupportFace[] = []
  for (const rowFaces of rowsByZ.values()) {
    const sorted = [...rowFaces].sort((source, target) => source.minX - target.minX)
    for (const face of sorted) {
      const previous = rows.at(-1)
      if (
        previous &&
        previous.y === face.y &&
        previous.minZ === face.minZ &&
        previous.maxZ === face.maxZ &&
        face.minX <= previous.maxX + STRUCTURAL_OVERLAP_TOLERANCE
      ) {
        previous.maxX = Math.max(previous.maxX, face.maxX)
      } else {
        rows.push({ ...face })
      }
    }
  }

  return rows
}

const mergeSupportFaceColumns = (faces: WorldStructuralSupportFace[]) => {
  const sorted = [...faces].sort((source, target) =>
    source.y - target.y ||
    source.minX - target.minX ||
    source.maxX - target.maxX ||
    source.minZ - target.minZ
  )
  const merged: WorldStructuralSupportFace[] = []

  for (const face of sorted) {
    const previous = merged.at(-1)
    if (
      previous &&
      previous.y === face.y &&
      previous.minX === face.minX &&
      previous.maxX === face.maxX &&
      face.minZ <= previous.maxZ + STRUCTURAL_OVERLAP_TOLERANCE
    ) {
      previous.maxZ = Math.max(previous.maxZ, face.maxZ)
    } else {
      merged.push({ ...face })
    }
  }

  return merged
}

const mergeSupportFaces = (faces: WorldStructuralSupportFace[]) =>
  mergeSupportFaceColumns(mergeSupportFaceRows(faces))

const groupSupportFacesByPlane = (faces: WorldStructuralSupportFace[]) => {
  const grouped = new Map<string, WorldStructuralSupportFace[]>()
  const facesByPlane = new Map<string, WorldStructuralSupportFace[]>()

  for (const face of faces) {
    const key = makeSupportFacePlaneKey(face.y)
    const planeFaces = facesByPlane.get(key)
    if (planeFaces) {
      planeFaces.push(face)
    } else {
      facesByPlane.set(key, [face])
    }
  }

  for (const [key, planeFaces] of facesByPlane) {
    grouped.set(key, mergeSupportFaces(planeFaces))
  }

  return grouped
}

const makeSupportFaces = (
  top: WorldStructuralSupportFace[],
  bottom: WorldStructuralSupportFace[],
): WorldStructuralSupportFaces => ({
  top,
  bottom,
  topPlanes: groupSupportFacesByPlane(top),
  bottomPlanes: groupSupportFacesByPlane(bottom),
})

const getBrickLocalSupportFaces = (definition: BrickDefinition): WorldStructuralSupportFaces => {
  const cacheKey = makeStructuralDefinitionCacheKey(definition)
  const cached = localSupportFaceCache.get(cacheKey)
  if (cached) return cached

  const boxes = getBrickLocalSupportCellBoxes(definition)
  const bottomFaceKeys = new Set(boxes.map((box) => makeSupportFaceKey(box.minY, box)))
  const topFaceKeys = new Set(boxes.map((box) => makeSupportFaceKey(box.maxY, box)))
  const faces = makeSupportFaces(
    boxes
      .filter((box) => !bottomFaceKeys.has(makeSupportFaceKey(box.maxY, box)))
      .map((box) => makeSupportFace(box.maxY, box)),
    boxes
      .filter((box) => !topFaceKeys.has(makeSupportFaceKey(box.minY, box)))
      .map((box) => makeSupportFace(box.minY, box)),
  )

  localSupportFaceCache.set(cacheKey, faces)
  return faces
}

const transformHorizontalSupportFace = (
  definition: BrickDefinition,
  brick: PlacedBrick,
  face: WorldStructuralSupportFace,
): WorldStructuralSupportFace => {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let y = face.y

  for (let xIndex = 0; xIndex < 2; xIndex += 1) {
    for (let zIndex = 0; zIndex < 2; zIndex += 1) {
      const x = xIndex === 0 ? face.minX : face.maxX
      const z = zIndex === 0 ? face.minZ : face.maxZ
      const point = transformBrickLocalPoint(definition, brick.pose, { x, y: face.y, z })
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      minZ = Math.min(minZ, point.z)
      maxZ = Math.max(maxZ, point.z)
      y = point.y
    }
  }

  return makeSupportFace(y, { minX, maxX, minZ, maxZ })
}

const getBrickWorldHorizontalSupportFaces = (
  definition: BrickDefinition,
  brick: PlacedBrick,
) => {
  const localFaces = getBrickLocalSupportFaces(definition)

  return makeSupportFaces(
    localFaces.top.map((face) => transformHorizontalSupportFace(definition, brick, face)),
    localFaces.bottom.map((face) => transformHorizontalSupportFace(definition, brick, face)),
  )
}

export const getBrickWorldSupportFaces = (brick: PlacedBrick): WorldStructuralSupportFaces => {
  const cacheKey = getPlacedBrickCacheKey(brick)
  const cached = worldSupportFaceCache.get(cacheKey)
  if (cached) return cached

  const definition = brickById.get(brick.brickId)
  if (!definition) return makeSupportFaces([], [])

  if ((brick.pose.verticalQuarterTurns ?? 0) === 0) {
    const faces = getBrickWorldHorizontalSupportFaces(definition, brick)
    setLimitedWorldCache(worldSupportFaceCache, cacheKey, faces)
    return faces
  }

  const boxes = getBrickWorldSupportCellBoxes(brick)
  const bottomFaceKeys = new Set(boxes.map((box) => makeSupportFaceKey(box.minY, box)))
  const topFaceKeys = new Set(boxes.map((box) => makeSupportFaceKey(box.maxY, box)))
  const top = boxes
    .filter((box) => !bottomFaceKeys.has(makeSupportFaceKey(box.maxY, box)))
    .map((box) => makeSupportFace(box.maxY, box))
  const bottom = boxes
    .filter((box) => !topFaceKeys.has(makeSupportFaceKey(box.minY, box)))
    .map((box) => makeSupportFace(box.minY, box))
  const faces = makeSupportFaces(top, bottom)

  setLimitedWorldCache(worldSupportFaceCache, cacheKey, faces)
  return faces
}

const getCellBoxBounds = (boxes: WorldStructuralCellBox[]): BrickBounds | undefined => {
  if (boxes.length === 0) return undefined

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (const box of boxes) {
    minX = Math.min(minX, box.minX)
    maxX = Math.max(maxX, box.maxX)
    minY = Math.min(minY, box.minY)
    maxY = Math.max(maxY, box.maxY)
    minZ = Math.min(minZ, box.minZ)
    maxZ = Math.max(maxZ, box.maxZ)
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
  }
}

const getBrickLocalSupportBounds = (definition: BrickDefinition) => {
  const cacheKey = makeStructuralDefinitionCacheKey(definition)
  if (localSupportBoundsCache.has(cacheKey)) return localSupportBoundsCache.get(cacheKey)

  const bounds = getCellBoxBounds(getBrickLocalSupportCellBoxes(definition))
  localSupportBoundsCache.set(cacheKey, bounds)
  return bounds
}

export const getBrickWorldSupportBounds = (brick: PlacedBrick) => {
  const cacheKey = getPlacedBrickCacheKey(brick)
  if (worldSupportBoundsCache.has(cacheKey)) return worldSupportBoundsCache.get(cacheKey)

  const definition = brickById.get(brick.brickId)
  const localBounds = definition ? getBrickLocalSupportBounds(definition) : undefined
  const bounds = definition && localBounds ? transformLocalBox(definition, brick, localBounds) : undefined
  setLimitedWorldCache(worldSupportBoundsCache, cacheKey, bounds)
  return bounds
}

const getBrickWorldCollisionCellBoxes = (brick: PlacedBrick): WorldStructuralCellBox[] => {
  const cacheKey = getPlacedBrickCacheKey(brick)
  const cached = worldCollisionCellBoxCache.get(cacheKey)
  if (cached) return cached

  const definition = brickById.get(brick.brickId)
  if (!definition) return []

  const boxes = getBrickInteractionStructuralCells(definition)
    .filter(structuralCellBlocksCollision)
    .map((cell) => transformStructuralCellBox(definition, brick, cell))
  setLimitedWorldCache(worldCollisionCellBoxCache, cacheKey, boxes)
  return boxes
}

const doCellBoxesOverlap = (
  source: Pick<StructuralCell, 'minX' | 'maxX' | 'minY' | 'maxY' | 'minZ' | 'maxZ'>,
  target: Pick<StructuralCell, 'minX' | 'maxX' | 'minY' | 'maxY' | 'minZ' | 'maxZ'>,
) =>
  source.minX < target.maxX - STRUCTURAL_OVERLAP_TOLERANCE &&
  source.maxX > target.minX + STRUCTURAL_OVERLAP_TOLERANCE &&
  source.minY < target.maxY - STRUCTURAL_OVERLAP_TOLERANCE &&
  source.maxY > target.minY + STRUCTURAL_OVERLAP_TOLERANCE &&
  source.minZ < target.maxZ - STRUCTURAL_OVERLAP_TOLERANCE &&
  source.maxZ > target.minZ + STRUCTURAL_OVERLAP_TOLERANCE

export const getBrickWorldCollisionKeys = (brick: PlacedBrick) => {
  const cacheKey = getPlacedBrickCacheKey(brick)
  const cached = worldCollisionKeyCache.get(cacheKey)
  if (cached) return cached

  const keys = new Set<string>()
  for (const worldCell of getBrickWorldCollisionCellBoxes(brick)) {
    for (const key of getCellHashKeys(worldCell)) {
      keys.add(key)
    }
  }
  setLimitedWorldCache(worldCollisionKeyCache, cacheKey, keys)
  return keys
}

export const createStructuralCollisionIndex = (bricks: PlacedBrick[]): StructuralCollisionIndex => {
  const keyToBrickIds = new Map<string, Set<string>>()
  const brickKeys = new Map<string, Set<string>>()
  const bricksById = new Map(bricks.map((brick) => [brick.id, brick]))

  for (const brick of bricks) {
    const collisionBounds = getCellBoxBounds(getBrickWorldCollisionCellBoxes(brick))
    const keys = new Set(collisionBounds
      ? getCellHashKeys(collisionBounds, COLLISION_INDEX_HASH_STEP)
      : [])
    brickKeys.set(brick.id, keys)

    for (const key of keys) {
      const brickIds = keyToBrickIds.get(key)
      if (brickIds) {
        brickIds.add(brick.id)
      } else {
        keyToBrickIds.set(key, new Set([brick.id]))
      }
    }
  }

  return { keyToBrickIds, brickKeys, bricksById }
}

export const getStructuralCollisionCandidateIds = (
  brick: PlacedBrick,
  index: StructuralCollisionIndex,
) => {
  const candidateIds = new Set<string>()
  const collisionBounds = getCellBoxBounds(getBrickWorldCollisionCellBoxes(brick))
  if (!collisionBounds) return candidateIds

  for (const key of getCellHashKeys(collisionBounds, COLLISION_INDEX_HASH_STEP)) {
    const brickIds = index.keyToBrickIds.get(key)
    if (!brickIds) continue

    for (const brickId of brickIds) {
      if (brickId !== brick.id) candidateIds.add(brickId)
    }
  }

  return candidateIds
}

export const getStructuralOverlapScore = (
  brick: PlacedBrick,
  index: StructuralCollisionIndex,
) => {
  let overlapVolume = 0
  const sourceBoxes = getBrickWorldCollisionCellBoxes(brick)

  for (const brickId of getStructuralCollisionCandidateIds(brick, index)) {
    const other = index.bricksById.get(brickId)
    if (!other) continue

    for (const source of sourceBoxes) {
      for (const target of getBrickWorldCollisionCellBoxes(other)) {
        const width = Math.max(0, Math.min(source.maxX, target.maxX) - Math.max(source.minX, target.minX))
        const height = Math.max(0, Math.min(source.maxY, target.maxY) - Math.max(source.minY, target.minY))
        const depth = Math.max(0, Math.min(source.maxZ, target.maxZ) - Math.max(source.minZ, target.minZ))
        overlapVolume += width * height * depth
      }
    }
  }

  return overlapVolume
}

export const doBrickStructuralCellsCollide = (
  source: PlacedBrick,
  target: PlacedBrick,
) => {
  const sourceCells = getBrickWorldCollisionCellBoxes(source)
  const targetCells = getBrickWorldCollisionCellBoxes(target)

  return sourceCells.some((sourceCell) =>
    targetCells.some((targetCell) => doCellBoxesOverlap(sourceCell, targetCell)),
  )
}

export const doStructuralCellsCollide = (
  source: Pick<StructuralCell, 'kind'>,
  target: Pick<StructuralCell, 'kind'>,
) =>
  structuralCellBlocksCollision(source) && structuralCellBlocksCollision(target)
