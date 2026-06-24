import { brickById } from '../data/basicBricks'
import type { BrickConnector, BrickDefinition, PlacedBrick } from '../types/bricks'
import { onLDrawGeneratedVisualLoaded } from './ldrawGeneratedVisualLoader'
import { getTriangleBounds, type BrickBounds } from './ldrawBounds'
import { getLDrawStructuralTriangles } from './ldrawPartRegistry'
import { getConnectorLocalPoint, transformBrickLocalPoint } from './brickUnits'
import { voxelizeMeshStructuralCells, type MeshTriangle } from './structuralVoxelizer'

export const STRUCTURAL_VOXEL_SIZE = 1 / 5
const STRUCTURAL_HASH_STEP = STRUCTURAL_VOXEL_SIZE / 2
const STRUCTURAL_OVERLAP_TOLERANCE = 0.000001
const WORLD_STRUCTURAL_CACHE_LIMIT = 5000
const structuralCellCache = new Map<string, StructuralCell[]>()
const localSupportBoundsCache = new Map<string, BrickBounds | undefined>()
const localSupportFaceCache = new Map<string, WorldStructuralSupportFaces>()
const worldStructuralCellBoxCache = new Map<string, WorldStructuralCellBox[]>()
const worldSupportCellBoxCache = new Map<string, WorldStructuralCellBox[]>()
const worldSupportFaceCache = new Map<string, WorldStructuralSupportFaces>()
const worldSupportBoundsCache = new Map<string, BrickBounds | undefined>()
const worldCollisionCellBoxCache = new Map<string, WorldStructuralCellBox[]>()
const worldCollisionCellSpatialIndexCache = new Map<string, Map<string, WorldStructuralCellBox[]>>()
const worldCollisionKeyCache = new Map<string, Set<string>>()
let structuralCacheVersion = 0

onLDrawGeneratedVisualLoaded(() => {
  structuralCacheVersion += 1
  structuralCellCache.clear()
  localSupportBoundsCache.clear()
  localSupportFaceCache.clear()
  worldStructuralCellBoxCache.clear()
  worldSupportCellBoxCache.clear()
  worldSupportFaceCache.clear()
  worldSupportBoundsCache.clear()
  worldCollisionCellBoxCache.clear()
  worldCollisionCellSpatialIndexCache.clear()
  worldCollisionKeyCache.clear()
})

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

  const boxes = getBrickStructuralCells(definition).map((cell) =>
    transformStructuralCellBox(definition, brick, cell)
  )

  setLimitedWorldCache(worldStructuralCellBoxCache, cacheKey, boxes)
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

  const boxes = getBrickWorldStructuralCellBoxes(brick).filter(structuralCellBlocksCollision)
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

const getBrickWorldCollisionCellSpatialIndex = (brick: PlacedBrick) => {
  const cacheKey = getPlacedBrickCacheKey(brick)
  const cached = worldCollisionCellSpatialIndexCache.get(cacheKey)
  if (cached) return cached

  const index = new Map<string, WorldStructuralCellBox[]>()
  for (const worldCell of getBrickWorldCollisionCellBoxes(brick)) {
    for (const key of getCellHashKeys(worldCell)) {
      const cells = index.get(key)
      if (cells) {
        cells.push(worldCell)
      } else {
        index.set(key, [worldCell])
      }
    }
  }

  setLimitedWorldCache(worldCollisionCellSpatialIndexCache, cacheKey, index)
  return index
}

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
  const sourceKeys = getBrickWorldCollisionKeys(brick)

  for (const candidateId of getStructuralCollisionCandidateIds(brick, index)) {
    const targetKeys = index.brickKeys.get(candidateId)
    if (!targetKeys) continue

    for (const key of sourceKeys) {
      if (targetKeys.has(key)) overlapCount += 1
    }
  }

  return overlapCount * STRUCTURAL_VOXEL_SIZE ** 3
}

export const doBrickStructuralCellsCollide = (
  source: PlacedBrick,
  target: PlacedBrick,
) => {
  const sourceCells = getBrickWorldCollisionCellBoxes(source)
  const targetCellIndex = getBrickWorldCollisionCellSpatialIndex(target)

  for (const sourceCell of sourceCells) {
    const checkedCells = new Set<WorldStructuralCellBox>()
    for (const key of getCellHashKeys(sourceCell)) {
      const targetCells = targetCellIndex.get(key)
      if (!targetCells) continue

      for (const targetCell of targetCells) {
        if (checkedCells.has(targetCell)) continue
        checkedCells.add(targetCell)
        if (doCellBoxesOverlap(sourceCell, targetCell)) return true
      }
    }
  }

  return false
}

export const doStructuralCellsCollide = (
  source: Pick<StructuralCell, 'kind'>,
  target: Pick<StructuralCell, 'kind'>,
) =>
  structuralCellBlocksCollision(source) && structuralCellBlocksCollision(target)
