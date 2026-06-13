import { brickById } from '../data/basicBricks'
import type { BrickConnector, BrickDefinition, PlacedBrick } from '../types/bricks'
import { onLDrawGeneratedVisualLoaded } from './ldrawGeneratedVisualLoader'
import { getTriangleBounds } from './ldrawBounds'
import { getLDrawStructuralTriangles } from './ldrawPartRegistry'
import { getConnectorLocalPoint, transformBrickLocalPoint } from './brickUnits'
import { voxelizeMeshStructuralCells, type MeshTriangle } from './structuralVoxelizer'

export const STRUCTURAL_VOXEL_SIZE = 1 / 5
const STRUCTURAL_HASH_STEP = STRUCTURAL_VOXEL_SIZE / 2
const STRUCTURAL_OVERLAP_TOLERANCE = 0.000001
const WORLD_STRUCTURAL_CACHE_LIMIT = 5000
const structuralCellCache = new Map<string, StructuralCell[]>()
const worldStructuralCellBoxCache = new Map<string, WorldStructuralCellBox[]>()
const worldCollisionKeyCache = new Map<string, Set<string>>()

onLDrawGeneratedVisualLoaded(() => {
  structuralCellCache.clear()
  worldStructuralCellBoxCache.clear()
  worldCollisionKeyCache.clear()
})

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

const rangeCount = (size: number) => Math.max(1, Math.round(size / STRUCTURAL_VOXEL_SIZE))
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
) => {
  const cells: StructuralCell[] = []
  const xCount = rangeCount(widthStuds)
  const yCount = rangeCount(heightStuds)
  const zCount = rangeCount(depthStuds)

  for (let x = 0; x < xCount; x += 1) {
    for (let y = 0; y < yCount; y += 1) {
      for (let z = 0; z < zCount; z += 1) {
        cells.push(makeCell('solid', x * STRUCTURAL_VOXEL_SIZE, y * STRUCTURAL_VOXEL_SIZE, z * STRUCTURAL_VOXEL_SIZE))
      }
    }
  }

  return cells
}

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

  return overlayStructuralCells(
    voxelizeMeshStructuralCells({
      widthStuds: triangleBounds?.maxX ?? definition.footprint.widthStuds,
      heightStuds: triangleBounds?.maxY ?? definition.footprint.heightStuds,
      depthStuds: triangleBounds?.maxZ ?? definition.footprint.depthStuds,
      voxelSize: STRUCTURAL_VOXEL_SIZE,
      triangles,
    }),
    makeConnectorCells(definition),
  )
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

const makeDefaultStructuralCells = (definition: BrickDefinition) => [
  ...makeSolidBlockCells(
    definition.footprint.widthStuds,
    definition.footprint.heightStuds,
    definition.footprint.depthStuds,
  ),
  ...makeConnectorCells(definition),
]

const makeStructuralDefinitionCacheKey = (definition: BrickDefinition) =>
  `${definition.id}:${definition.partNumber}:${definition.footprint.widthStuds},${definition.footprint.depthStuds},${definition.footprint.heightStuds}`

export const getBrickStructuralCells = (definition: BrickDefinition): StructuralCell[] => {
  const cacheKey = makeStructuralDefinitionCacheKey(definition)
  const cached = structuralCellCache.get(cacheKey)
  if (cached) return cached

  const structuralTriangles = getLDrawStructuralTriangles(definition.partNumber)
  const cells = structuralTriangles
    ? makeMeshStructuralCells(definition, structuralTriangles)
    : makeDefaultStructuralCells(definition)

  structuralCellCache.set(cacheKey, cells)
  return cells
}

const cellCorners = (cell: StructuralCell) => [
  { x: cell.minX, y: cell.minY, z: cell.minZ },
  { x: cell.minX, y: cell.minY, z: cell.maxZ },
  { x: cell.minX, y: cell.maxY, z: cell.minZ },
  { x: cell.minX, y: cell.maxY, z: cell.maxZ },
  { x: cell.maxX, y: cell.minY, z: cell.minZ },
  { x: cell.maxX, y: cell.minY, z: cell.maxZ },
  { x: cell.maxX, y: cell.maxY, z: cell.minZ },
  { x: cell.maxX, y: cell.maxY, z: cell.maxZ },
]

const hashCoordinate = (value: number) =>
{
  const scaled = value / STRUCTURAL_HASH_STEP
  const nearest = Math.round(scaled)
  return Math.abs(scaled - nearest) < 0.000001 ? nearest : Math.floor(scaled)
}

const makeKey = (x: number, y: number, z: number) =>
  `${x},${y},${z}`

const getCellHashKeys = (cell: StructuralCell) => {
  const minX = hashCoordinate(cell.minX)
  const maxX = hashCoordinate(cell.maxX - 0.000001)
  const minY = hashCoordinate(cell.minY)
  const maxY = hashCoordinate(cell.maxY - 0.000001)
  const minZ = hashCoordinate(cell.minZ)
  const maxZ = hashCoordinate(cell.maxZ - 0.000001)
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

  const boxes = getBrickStructuralCells(definition).map((cell) => {
    const transformedCorners = cellCorners(cell).map((corner) => transformBrickLocalPoint(definition, brick.pose, corner))

    return {
      ...cell,
      minX: Math.min(...transformedCorners.map((corner) => corner.x)),
      maxX: Math.max(...transformedCorners.map((corner) => corner.x)),
      minY: Math.min(...transformedCorners.map((corner) => corner.y)),
      maxY: Math.max(...transformedCorners.map((corner) => corner.y)),
      minZ: Math.min(...transformedCorners.map((corner) => corner.z)),
      maxZ: Math.max(...transformedCorners.map((corner) => corner.z)),
    }
  })

  setLimitedWorldCache(worldStructuralCellBoxCache, cacheKey, boxes)
  return boxes
}

export const getBrickWorldStructuralCells = (brick: PlacedBrick): WorldStructuralCell[] =>
  getBrickWorldStructuralCellBoxes(brick).flatMap((worldCell) =>
    getCellHashKeys(worldCell).map((key) => ({ ...worldCell, key }))
  )

export const structuralCellBlocksCollision = (cell: Pick<StructuralCell, 'kind'>) =>
  cell.kind === 'solid' || cell.kind === 'studsocket'

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

  const keys = new Set(
    getBrickWorldStructuralCells(brick)
      .filter(structuralCellBlocksCollision)
      .map((cell) => cell.key),
  )
  setLimitedWorldCache(worldCollisionKeyCache, cacheKey, keys)
  return keys
}

export const createStructuralCollisionIndex = (bricks: PlacedBrick[]): StructuralCollisionIndex => {
  const keyToBrickIds = new Map<string, Set<string>>()
  const brickKeys = new Map<string, Set<string>>()
  const bricksById = new Map(bricks.map((brick) => [brick.id, brick]))

  for (const brick of bricks) {
    const keys = getBrickWorldCollisionKeys(brick)
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

  for (const key of getBrickWorldCollisionKeys(brick)) {
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
  let overlapCount = 0
  const sourceCells = getBrickWorldStructuralCellBoxes(brick).filter(structuralCellBlocksCollision)

  for (const candidateId of getStructuralCollisionCandidateIds(brick, index)) {
    const candidate = index.bricksById.get(candidateId)
    if (!candidate) continue

    const targetCells = getBrickWorldStructuralCellBoxes(candidate).filter(structuralCellBlocksCollision)
    for (const sourceCell of sourceCells) {
      for (const targetCell of targetCells) {
        if (doCellBoxesOverlap(sourceCell, targetCell)) overlapCount += 1
      }
    }
  }

  return overlapCount * STRUCTURAL_VOXEL_SIZE ** 3
}

export const doBrickStructuralCellsCollide = (
  source: PlacedBrick,
  target: PlacedBrick,
) => {
  const sourceCells = getBrickWorldStructuralCellBoxes(source).filter(structuralCellBlocksCollision)
  const targetCells = getBrickWorldStructuralCellBoxes(target).filter(structuralCellBlocksCollision)

  return sourceCells.some((sourceCell) =>
    targetCells.some((targetCell) => doCellBoxesOverlap(sourceCell, targetCell)),
  )
}

export const doStructuralCellsCollide = (
  source: Pick<StructuralCell, 'kind'>,
  target: Pick<StructuralCell, 'kind'>,
) =>
  structuralCellBlocksCollision(source) && structuralCellBlocksCollision(target)
