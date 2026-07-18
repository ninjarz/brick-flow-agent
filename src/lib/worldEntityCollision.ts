import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import type { WorldEntity } from '../types/world'

export type WorldEntityGroundPoint = { x: number; z: number }

export type WorldEntityOccupancyIndex = {
  entitiesById: Map<string, WorldEntity>
  entityIdsByCell: Map<string, Set<string>>
  cellKeysByEntityId: Map<string, string[]>
}

const occupancyCellSizeStuds = 4
const placementGridStuds = 0.5
const placementSearchRadiusStuds = 20
const overlapToleranceStuds = 0.02
const separatingToleranceStuds = 0.0001
const toCell = (value: number) => Math.floor(value / occupancyCellSizeStuds)
const cellKey = (x: number, z: number) => `${x}:${z}`

export const getWorldEntityCollisionRadius = (entity: WorldEntity) => {
  const body = worldEntityDefinitionById.get(entity.definitionId)?.body
  if (!body) return 0.7
  return body.shape === 'capsule'
    ? body.radiusStuds
    : Math.hypot(body.widthStuds, body.depthStuds) / 2
}

const getOccupiedCellKeys = (entity: WorldEntity) => {
  const radius = getWorldEntityCollisionRadius(entity)
  const keys: string[] = []
  for (let x = toCell(entity.transform.x - radius); x <= toCell(entity.transform.x + radius); x += 1) {
    for (let z = toCell(entity.transform.z - radius); z <= toCell(entity.transform.z + radius); z += 1) {
      keys.push(cellKey(x, z))
    }
  }
  return keys
}

export const createWorldEntityOccupancyIndex = (entities: WorldEntity[]): WorldEntityOccupancyIndex => {
  const index: WorldEntityOccupancyIndex = {
    entitiesById: new Map(),
    entityIdsByCell: new Map(),
    cellKeysByEntityId: new Map(),
  }
  for (const entity of entities) updateWorldEntityOccupancy(index, entity)
  return index
}

export const updateWorldEntityOccupancy = (index: WorldEntityOccupancyIndex, entity: WorldEntity) => {
  for (const key of index.cellKeysByEntityId.get(entity.id) ?? []) {
    const entityIds = index.entityIdsByCell.get(key)
    entityIds?.delete(entity.id)
    if (entityIds?.size === 0) index.entityIdsByCell.delete(key)
  }

  const keys = getOccupiedCellKeys(entity)
  index.entitiesById.set(entity.id, entity)
  index.cellKeysByEntityId.set(entity.id, keys)
  for (const key of keys) {
    const entityIds = index.entityIdsByCell.get(key)
    if (entityIds) entityIds.add(entity.id)
    else index.entityIdsByCell.set(key, new Set([entity.id]))
  }
}

const queryNearbyEntities = (
  index: WorldEntityOccupancyIndex,
  entity: WorldEntity,
  point: WorldEntityGroundPoint,
) => {
  const radius = getWorldEntityCollisionRadius(entity)
  const candidateIds = new Set<string>()
  for (let x = toCell(point.x - radius); x <= toCell(point.x + radius); x += 1) {
    for (let z = toCell(point.z - radius); z <= toCell(point.z + radius); z += 1) {
      for (const entityId of index.entityIdsByCell.get(cellKey(x, z)) ?? []) candidateIds.add(entityId)
    }
  }
  candidateIds.delete(entity.id)
  return Array.from(candidateIds, (entityId) => index.entitiesById.get(entityId))
    .filter((candidate): candidate is WorldEntity => Boolean(candidate))
}

export const isWorldEntityPositionOccupied = (
  index: WorldEntityOccupancyIndex,
  entity: WorldEntity,
  point: WorldEntityGroundPoint,
  options: { allowSeparatingFromCurrent?: boolean } = {},
) => {
  const radius = getWorldEntityCollisionRadius(entity)
  return queryNearbyEntities(index, entity, point).some((candidate) => {
    const minimumDistance = radius + getWorldEntityCollisionRadius(candidate) - overlapToleranceStuds
    const nextDistance = Math.hypot(point.x - candidate.transform.x, point.z - candidate.transform.z)
    if (nextDistance >= minimumDistance) return false
    if (!options.allowSeparatingFromCurrent) return true
    const currentDistance = Math.hypot(
      entity.transform.x - candidate.transform.x,
      entity.transform.z - candidate.transform.z,
    )
    return nextDistance <= currentDistance + separatingToleranceStuds
  })
}

const placementRingPoints = (center: WorldEntityGroundPoint, radiusSteps: number) => {
  const points: WorldEntityGroundPoint[] = []
  for (let offset = -radiusSteps; offset <= radiusSteps; offset += 1) {
    points.push(
      { x: center.x + offset * placementGridStuds, z: center.z - radiusSteps * placementGridStuds },
      { x: center.x + offset * placementGridStuds, z: center.z + radiusSteps * placementGridStuds },
    )
  }
  for (let offset = -radiusSteps + 1; offset < radiusSteps; offset += 1) {
    points.push(
      { x: center.x - radiusSteps * placementGridStuds, z: center.z + offset * placementGridStuds },
      { x: center.x + radiusSteps * placementGridStuds, z: center.z + offset * placementGridStuds },
    )
  }
  return points.sort((left, right) => (
    Math.hypot(left.x - center.x, left.z - center.z) - Math.hypot(right.x - center.x, right.z - center.z)
  ))
}

const findNearestAvailablePointInIndex = (
  entity: WorldEntity,
  preferredPoint: WorldEntityGroundPoint,
  index: WorldEntityOccupancyIndex,
  isBlocked: (point: WorldEntityGroundPoint) => boolean = () => false,
) => {
  if (!isBlocked(preferredPoint) && !isWorldEntityPositionOccupied(index, entity, preferredPoint)) return preferredPoint

  const maxRadiusSteps = Math.ceil(placementSearchRadiusStuds / placementGridStuds)
  for (let radiusSteps = 1; radiusSteps <= maxRadiusSteps; radiusSteps += 1) {
    const available = placementRingPoints(preferredPoint, radiusSteps)
      .find((point) => !isBlocked(point) && !isWorldEntityPositionOccupied(index, entity, point))
    if (available) return available
  }
  return undefined
}

export const findNearestAvailableWorldEntityPoint = (
  entity: WorldEntity,
  preferredPoint: WorldEntityGroundPoint,
  otherEntities: WorldEntity[],
  options: { isBlocked?: (point: WorldEntityGroundPoint) => boolean } = {},
) => findNearestAvailablePointInIndex(
  entity,
  preferredPoint,
  createWorldEntityOccupancyIndex(otherEntities),
  options.isBlocked,
)

export const resolveOverlappingWorldEntities = (entities: WorldEntity[]) => {
  const resolved: WorldEntity[] = []
  const occupancy = createWorldEntityOccupancyIndex([])
  for (const entity of entities) {
    const availablePoint = findNearestAvailablePointInIndex(entity, entity.transform, occupancy)
    if (!availablePoint || (
      availablePoint.x === entity.transform.x
      && availablePoint.z === entity.transform.z
    )) {
      resolved.push(entity)
      updateWorldEntityOccupancy(occupancy, entity)
      continue
    }
    const previousHome = entity.autonomy.home ?? entity.transform
    const repositioned = {
      ...entity,
      transform: { ...entity.transform, x: availablePoint.x, z: availablePoint.z },
      behaviorState: entity.health > 0 ? 'blocked' : entity.behaviorState,
      navigation: { status: 'blocked', path: [], pathIndex: 0, target: entity.navigation.target },
      autonomy: {
        ...entity.autonomy,
        home: {
          x: previousHome.x + availablePoint.x - entity.transform.x,
          z: previousHome.z + availablePoint.z - entity.transform.z,
        },
      },
    } satisfies WorldEntity
    resolved.push(repositioned)
    updateWorldEntityOccupancy(occupancy, repositioned)
  }
  return resolved
}
