import type { WorldEntity } from '../types/world'

export type WorldEntityProximityIndex = {
  cellSizeStuds: number
  entitiesById: Map<string, WorldEntity>
  entityIdsByCell: Map<string, string[]>
  sourceOrderById: Map<string, number>
}

const defaultCellSizeStuds = 8
const toCell = (value: number, cellSizeStuds: number) => Math.floor(value / cellSizeStuds)
const cellKey = (x: number, z: number) => `${x}:${z}`

export const createWorldEntityProximityIndex = (
  entities: WorldEntity[],
  cellSizeStuds = defaultCellSizeStuds,
): WorldEntityProximityIndex => {
  const normalizedCellSize = Math.max(1, cellSizeStuds)
  const index: WorldEntityProximityIndex = {
    cellSizeStuds: normalizedCellSize,
    entitiesById: new Map(),
    entityIdsByCell: new Map(),
    sourceOrderById: new Map(),
  }
  entities.forEach((entity, sourceIndex) => {
    index.entitiesById.set(entity.id, entity)
    index.sourceOrderById.set(entity.id, sourceIndex)
    if (entity.health <= 0) return
    const key = cellKey(
      toCell(entity.transform.x, normalizedCellSize),
      toCell(entity.transform.z, normalizedCellSize),
    )
    const ids = index.entityIdsByCell.get(key)
    if (ids) ids.push(entity.id)
    else index.entityIdsByCell.set(key, [entity.id])
  })
  return index
}

export const queryNearbyWorldEntities = (
  index: WorldEntityProximityIndex,
  entity: WorldEntity,
  radiusStuds: number,
) => {
  if (radiusStuds <= 0) return []
  const { cellSizeStuds } = index
  const radiusSquared = radiusStuds * radiusStuds
  const candidateIds = new Set<string>()
  const minX = toCell(entity.transform.x - radiusStuds, cellSizeStuds)
  const maxX = toCell(entity.transform.x + radiusStuds, cellSizeStuds)
  const minZ = toCell(entity.transform.z - radiusStuds, cellSizeStuds)
  const maxZ = toCell(entity.transform.z + radiusStuds, cellSizeStuds)
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      for (const entityId of index.entityIdsByCell.get(cellKey(x, z)) ?? []) {
        if (entityId !== entity.id) candidateIds.add(entityId)
      }
    }
  }
  return Array.from(candidateIds)
    .map((entityId) => index.entitiesById.get(entityId))
    .filter((candidate): candidate is WorldEntity => Boolean(candidate))
    .filter((candidate) => {
      const deltaX = candidate.transform.x - entity.transform.x
      const deltaZ = candidate.transform.z - entity.transform.z
      return deltaX * deltaX + deltaZ * deltaZ <= radiusSquared
    })
    .sort((left, right) => (
      (index.sourceOrderById.get(left.id) ?? 0) - (index.sourceOrderById.get(right.id) ?? 0)
    ))
}
