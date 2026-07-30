import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { brickById } from '../data/basicBricks'
import type { BrickStructure, PlacedBrick } from '../types/bricks'
import type { WorldEntity, WorldEntityCommand, WorldEvent, WorldPendingImpact, WorldState, WorldTargetRef } from '../types/world'
import { getBrickBounds } from './planUtils'
import { ingestWorldEvents } from './worldNarrative'
import { getWorldProjectileFlightSeconds } from './worldProjectiles'
import { createWorldObstacleIndex, queryWorldObstacleBounds, type WorldObstacleBounds, type WorldObstacleIndex } from './worldObstacleIndex'
import {
  createWorldEntityOccupancyIndex,
  getWorldEntityCollisionRadius,
  isWorldEntityPositionOccupied,
  resolveOverlappingWorldEntities,
  updateWorldEntityOccupancy,
  type WorldEntityOccupancyIndex,
} from './worldEntityCollision'

export const worldSimulationStepSeconds = 0.1
const navigationGridStuds = 0.5
const navigationMarginStuds = 8
const minimumNavigationGoalSearchRadiusStuds = 16
const maximumNavigationGoalSearchRadiusStuds = 64
const maxNavigationNodes = 3_000
const maxEventHistory = 500
const arrivalDistanceStuds = 0.35
const guardDetectionRadiusStuds = 8
const commandSpeechDurationSeconds = 3
const conversationSpeechDurationSeconds = 4
const minimumWanderRadiusStuds = 3
const wanderRadiusStepStuds = 0.75
const wanderDestinationAttempts = 16
const defaultWorldGridExtentStuds = 15
const worldGridPaddingStuds = 4

type Point = { x: number; y: number; z: number }
type GridNode = { x: number; z: number }
type BrickBounds = WorldObstacleBounds
export type WorldGroundBounds = { minX: number; maxX: number; minZ: number; maxZ: number }
type WorldTargetLookup = {
  entityIndexById: Map<string, number>
  entityById: Map<string, WorldEntity>
  brickById: Map<string, PlacedBrick>
  structureById: Map<string, BrickStructure>
  structurePointById: Map<string, Point | undefined>
}
const obstacleIndexCache = new WeakMap<PlacedBrick[], WorldObstacleIndex>()
const groundBoundsCache = new WeakMap<PlacedBrick[], WorldGroundBounds>()
const brickLookupCache = new WeakMap<PlacedBrick[], Map<string, PlacedBrick>>()

const getCachedObstacleIndex = (bricks: PlacedBrick[]) => {
  const cached = obstacleIndexCache.get(bricks)
  if (cached) return cached
  const index = createWorldObstacleIndex(bricks)
  obstacleIndexCache.set(bricks, index)
  return index
}

const distance2d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)
const sharesAutonomousStoryline = (left: WorldEntity, right: WorldEntity) => (
  left.storylineId === right.storylineId
  && (Boolean(left.storylineId) || (!left.storylineId && !right.storylineId))
)
const gridKey = (node: GridNode) => `${node.x}:${node.z}`
const toGrid = (value: number) => Math.round(value / navigationGridStuds)
const fromGrid = (value: number) => value * navigationGridStuds

export const getWorldGroundBounds = (bricks: PlacedBrick[]): WorldGroundBounds => {
  const cached = groundBoundsCache.get(bricks)
  if (cached) return cached
  const brickBounds = bricks.map(getBrickBounds).filter((bounds): bounds is NonNullable<typeof bounds> => Boolean(bounds))
  const modelMinX = Math.min(0, ...brickBounds.map((bounds) => bounds.minX))
  const modelMaxX = Math.max(0, ...brickBounds.map((bounds) => bounds.maxX))
  const modelMinZ = Math.min(0, ...brickBounds.map((bounds) => bounds.minZ))
  const modelMaxZ = Math.max(0, ...brickBounds.map((bounds) => bounds.maxZ))
  const rawMinX = Math.min(-defaultWorldGridExtentStuds, modelMinX - worldGridPaddingStuds)
  const rawMaxX = Math.max(defaultWorldGridExtentStuds, modelMaxX + worldGridPaddingStuds)
  const rawMinZ = Math.min(-defaultWorldGridExtentStuds, modelMinZ - worldGridPaddingStuds)
  const rawMaxZ = Math.max(defaultWorldGridExtentStuds, modelMaxZ + worldGridPaddingStuds)
  const size = Math.ceil(Math.max(rawMaxX - rawMinX, rawMaxZ - rawMinZ))
  const centerX = (rawMinX + rawMaxX) / 2
  const centerZ = (rawMinZ + rawMaxZ) / 2
  const bounds = { minX: centerX - size / 2, maxX: centerX + size / 2, minZ: centerZ - size / 2, maxZ: centerZ + size / 2 }
  groundBoundsCache.set(bricks, bounds)
  return bounds
}

const getCachedBrickLookup = (bricks: PlacedBrick[]) => {
  const cached = brickLookupCache.get(bricks)
  if (cached) return cached
  const lookup = new Map(bricks.map((brick) => [brick.id, brick]))
  brickLookupCache.set(bricks, lookup)
  return lookup
}

const clampEntityPointToGround = (entity: WorldEntity, point: { x: number; z: number }, bounds: WorldGroundBounds) => {
  const radius = getWorldEntityCollisionRadius(entity)
  return {
    x: Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, point.x)),
    z: Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, point.z)),
  }
}

const isEntityPointInsideGround = (entity: WorldEntity, point: { x: number; z: number }, bounds: WorldGroundBounds) => {
  const clamped = clampEntityPointToGround(entity, point, bounds)
  return Math.abs(clamped.x - point.x) < 1e-6 && Math.abs(clamped.z - point.z) < 1e-6
}

export const isWorldEntityGroundPointBlockedByBricks = (
  entity: WorldEntity,
  point: { x: number; z: number },
  bricks: PlacedBrick[],
) => {
  const definition = worldEntityDefinitionById.get(entity.definitionId)
  const bodyHeight = definition?.body.heightStuds ?? 5
  const body = definition?.body
  const radius = body?.shape === 'capsule'
    ? body.radiusStuds
    : body ? Math.hypot(body.widthStuds, body.depthStuds) / 2 : 0.7
  const obstacleIndex = getCachedObstacleIndex(bricks)
  return queryWorldObstacleBounds(obstacleIndex, {
    minX: point.x - radius,
    maxX: point.x + radius,
    minZ: point.z - radius,
    maxZ: point.z + radius,
  }).some((item) => (
    item!.minY < bodyHeight - 0.01
    && item!.maxY > 0.05
    && point.x > item!.minX - radius
    && point.x < item!.maxX + radius
    && point.z > item!.minZ - radius
    && point.z < item!.maxZ + radius
  ))
}

const createObstacleTest = (
  bricks: PlacedBrick[],
  entity: WorldEntity,
  entityOccupancy: WorldEntityOccupancyIndex,
  groundBounds: WorldGroundBounds,
) => {
  const resultCache = new Map<string, boolean>()
  return (x: number, z: number) => {
    const key = `${x}:${z}`
    const cached = resultCache.get(key)
    if (cached !== undefined) return cached
    const blockedByBrick = !isEntityPointInsideGround(entity, { x, z }, groundBounds)
      || isWorldEntityGroundPointBlockedByBricks(entity, { x, z }, bricks)
    const blocked = blockedByBrick || isWorldEntityPositionOccupied(
      entityOccupancy,
      entity,
      { x, z },
      { allowSeparatingFromCurrent: true },
    )
    resultCache.set(key, blocked)
    return blocked
  }
}

const segmentIntersectsBounds = (start: Point, end: Point, bounds: BrickBounds) => {
  const direction = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z }
  let near = 0
  let far = 1
  for (const axis of ['x', 'y', 'z'] as const) {
    const min = bounds[`min${axis.toUpperCase()}` as 'minX' | 'minY' | 'minZ']
    const max = bounds[`max${axis.toUpperCase()}` as 'maxX' | 'maxY' | 'maxZ']
    if (Math.abs(direction[axis]) < 1e-8) {
      if (start[axis] < min || start[axis] > max) return false
      continue
    }
    const first = (min - start[axis]) / direction[axis]
    const second = (max - start[axis]) / direction[axis]
    near = Math.max(near, Math.min(first, second))
    far = Math.min(far, Math.max(first, second))
    if (near > far) return false
  }
  return far > 0.015 && near < 0.985
}

const createWorldLineOfSightTest = (bricks: PlacedBrick[]) => {
  const obstacleIndex = getCachedObstacleIndex(bricks)
  return (actor: WorldEntity, target: WorldEntity) => {
    const actorBody = worldEntityDefinitionById.get(actor.definitionId)?.body
    const targetBody = worldEntityDefinitionById.get(target.definitionId)?.body
    const start = {
      x: actor.transform.x,
      y: actor.transform.y + (actorBody?.attackOriginHeightStuds ?? 2),
      z: actor.transform.z,
    }
    const end = {
      x: target.transform.x,
      y: target.transform.y + (targetBody?.heightStuds ?? 4) * 0.55,
      z: target.transform.z,
    }
    const candidates = queryWorldObstacleBounds(obstacleIndex, {
      minX: Math.min(start.x, end.x),
      maxX: Math.max(start.x, end.x),
      minZ: Math.min(start.z, end.z),
      maxZ: Math.max(start.z, end.z),
    })
    return !candidates.some((item) => segmentIntersectsBounds(start, end, item))
  }
}

export const hasWorldLineOfSight = (actor: WorldEntity, target: WorldEntity, bricks: PlacedBrick[]) =>
  createWorldLineOfSightTest(bricks)(actor, target)

const reconstructPath = (cameFrom: Map<string, string>, nodes: Map<string, GridNode>, endKey: string) => {
  const path: Point[] = []
  let currentKey: string | undefined = endKey
  while (currentKey) {
    const node = nodes.get(currentKey)
    if (node) path.push({ x: fromGrid(node.x), y: 0, z: fromGrid(node.z) })
    currentKey = cameFrom.get(currentKey)
  }
  path.reverse()
  return path.slice(1)
}

const navigationRingNodes = (center: GridNode, radius: number) => {
  const nodes: GridNode[] = []
  for (let offset = -radius; offset <= radius; offset += 1) {
    nodes.push(
      { x: center.x + offset, z: center.z - radius },
      { x: center.x + offset, z: center.z + radius },
    )
  }
  for (let offset = -radius + 1; offset < radius; offset += 1) {
    nodes.push(
      { x: center.x - radius, z: center.z + offset },
      { x: center.x + radius, z: center.z + offset },
    )
  }
  return nodes
}

const findNearestOpenGoalNode = (
  start: GridNode,
  blockedGoal: GridNode,
  isBlocked: (x: number, z: number) => boolean,
) => {
  const distanceFromGoal = Math.hypot(start.x - blockedGoal.x, start.z - blockedGoal.z) * navigationGridStuds
  const searchRadiusStuds = Math.min(
    maximumNavigationGoalSearchRadiusStuds,
    Math.max(minimumNavigationGoalSearchRadiusStuds, distanceFromGoal + navigationMarginStuds),
  )
  const maxRadius = Math.ceil(searchRadiusStuds / navigationGridStuds)
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    const candidates = navigationRingNodes(blockedGoal, radius)
      .filter((node) => !isBlocked(fromGrid(node.x), fromGrid(node.z)))
      .sort((left, right) => (
        Math.hypot(left.x - start.x, left.z - start.z)
        - Math.hypot(right.x - start.x, right.z - start.z)
      ))
    if (candidates.length > 0) return candidates[0]
  }
  return undefined
}

export const findWorldPath = (
  start: Point,
  goal: Point,
  isBlocked: (x: number, z: number) => boolean,
) => {
  const startNode = { x: toGrid(start.x), z: toGrid(start.z) }
  let goalNode = { x: toGrid(goal.x), z: toGrid(goal.z) }
  if (isBlocked(fromGrid(goalNode.x), fromGrid(goalNode.z))) {
    const openGoal = findNearestOpenGoalNode(startNode, goalNode, isBlocked)
    if (!openGoal) return []
    goalNode = openGoal
  }

  const minX = Math.min(startNode.x, goalNode.x) - Math.ceil(navigationMarginStuds / navigationGridStuds)
  const maxX = Math.max(startNode.x, goalNode.x) + Math.ceil(navigationMarginStuds / navigationGridStuds)
  const minZ = Math.min(startNode.z, goalNode.z) - Math.ceil(navigationMarginStuds / navigationGridStuds)
  const maxZ = Math.max(startNode.z, goalNode.z) + Math.ceil(navigationMarginStuds / navigationGridStuds)
  const startKey = gridKey(startNode)
  const goalKey = gridKey(goalNode)
  if (startKey === goalKey) {
    return [{ x: fromGrid(goalNode.x), y: 0, z: fromGrid(goalNode.z) }]
  }
  const open = new Map<string, { node: GridNode; score: number }>([[startKey, { node: startNode, score: 0 }]])
  const nodes = new Map<string, GridNode>([[startKey, startNode]])
  const cameFrom = new Map<string, string>()
  const cost = new Map<string, number>([[startKey, 0]])
  const directions = [
    { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
    { x: 1, z: 1 }, { x: 1, z: -1 }, { x: -1, z: 1 }, { x: -1, z: -1 },
  ]

  for (let visited = 0; open.size > 0 && visited < maxNavigationNodes; visited += 1) {
    let currentKey = ''
    let currentScore = Infinity
    for (const [key, value] of open) {
      if (value.score < currentScore) {
        currentKey = key
        currentScore = value.score
      }
    }
    const current = open.get(currentKey)!.node
    open.delete(currentKey)
    if (currentKey === goalKey) return reconstructPath(cameFrom, nodes, currentKey)

    for (const direction of directions) {
      const next = { x: current.x + direction.x, z: current.z + direction.z }
      if (next.x < minX || next.x > maxX || next.z < minZ || next.z > maxZ) continue
      const worldX = fromGrid(next.x)
      const worldZ = fromGrid(next.z)
      if (isBlocked(worldX, worldZ)) continue
      if (direction.x !== 0 && direction.z !== 0 && (
        isBlocked(fromGrid(current.x + direction.x), fromGrid(current.z)) ||
        isBlocked(fromGrid(current.x), fromGrid(current.z + direction.z))
      )) continue

      const nextKey = gridKey(next)
      const nextCost = (cost.get(currentKey) ?? 0) + (direction.x !== 0 && direction.z !== 0 ? Math.SQRT2 : 1)
      if (nextCost >= (cost.get(nextKey) ?? Infinity)) continue
      cost.set(nextKey, nextCost)
      cameFrom.set(nextKey, currentKey)
      nodes.set(nextKey, next)
      const heuristic = Math.hypot(goalNode.x - next.x, goalNode.z - next.z)
      open.set(nextKey, { node: next, score: nextCost + heuristic })
    }
  }

  return []
}

const getTargetPoint = (
  target: WorldTargetRef,
  entities: WorldEntity[],
  lookup: WorldTargetLookup,
): Point | undefined => {
  if (target.kind === 'entity') {
    const index = lookup.entityIndexById.get(target.id)
    const entity = index === undefined ? undefined : entities[index]
    return entity && entity.health > 0 ? entity.transform : undefined
  }
  if (target.kind === 'brick') {
    const brick = lookup.brickById.get(target.id)
    const bounds = brick ? getBrickBounds(brick) : undefined
    return bounds ? {
      x: (bounds.minX + bounds.maxX) / 2,
      y: bounds.minY,
      z: (bounds.minZ + bounds.maxZ) / 2,
    } : undefined
  }
  if (target.kind === 'structure') {
    if (lookup.structurePointById.has(target.id)) return lookup.structurePointById.get(target.id)
    const structure = lookup.structureById.get(target.id)
    const bounds = (structure?.brickIds ?? [])
      .map((brickId) => lookup.brickById.get(brickId))
      .filter((brick): brick is PlacedBrick => Boolean(brick))
      .map(getBrickBounds)
      .filter((item) => Boolean(item))
    const point = bounds.length > 0 ? {
      x: (Math.min(...bounds.map((item) => item!.minX)) + Math.max(...bounds.map((item) => item!.maxX))) / 2,
      y: Math.min(...bounds.map((item) => item!.minY)),
      z: (Math.min(...bounds.map((item) => item!.minZ)) + Math.max(...bounds.map((item) => item!.maxZ))) / 2,
    } : undefined
    lookup.structurePointById.set(target.id, point)
    return point
  }
  return undefined
}

const findNearestEntity = (
  entity: WorldEntity,
  entities: WorldEntity[],
  predicate: (candidate: WorldEntity) => boolean,
) => {
  let nearest: WorldEntity | undefined
  let nearestDistance = Infinity
  for (const candidate of entities) {
    if (!predicate(candidate)) continue
    const distance = distance2d(entity.transform, candidate.transform)
    if (distance >= nearestDistance) continue
    nearest = candidate
    nearestDistance = distance
  }
  return nearest
}

const findBestEnemy = (
  entity: WorldEntity,
  entities: WorldEntity[],
  entityById: ReadonlyMap<string, WorldEntity>,
  timeSeconds: number,
) => {
  const detectionRange = worldEntityDefinitionById.get(entity.definitionId)?.perception.detectionRangeStuds ?? 0
  const recentAttacker = entity.combat.lastAttackerId
    && (entity.combat.lastDamagedAtSeconds ?? -Infinity) + 8 >= timeSeconds
    ? entities.find((candidate) => (
        candidate.id === entity.combat.lastAttackerId
        && candidate.health > 0
        && distance2d(entity.transform, candidate.transform) <= detectionRange * 1.5
      ))
    : undefined
  if (recentAttacker) return recentAttacker
  if (entity.factionId === 'neutral') return undefined
  let best: WorldEntity | undefined
  let bestScore = Infinity
  for (const candidate of entities) {
    if (
      candidate.id === entity.id
      || candidate.health <= 0
      || !sharesAutonomousStoryline(entity, candidate)
      || candidate.factionId === 'neutral'
      || candidate.factionId === entity.factionId
    ) continue
    const distance = distance2d(entity.transform, candidate.transform)
    if (distance > detectionRange) continue
    const candidateTarget = candidate.activeCommand && 'target' in candidate.activeCommand
      ? candidate.activeCommand.target
      : undefined
    const threateningSelf = candidate.activeCommand?.type === 'attack'
      && candidateTarget?.kind === 'entity'
      && candidateTarget.id === entity.id
    const threateningTarget = candidateTarget?.kind === 'entity'
      ? entityById.get(candidateTarget.id)
      : undefined
    const threateningAlly = candidate.activeCommand?.type === 'attack'
      && threateningTarget?.factionId === entity.factionId
    const healthRatio = candidate.health / Math.max(1, candidate.maxHealth)
    const score = distance
      + healthRatio * 1.5
      - (threateningSelf ? detectionRange * 2 : 0)
      - (threateningAlly ? detectionRange : 0)
    if (score > bestScore || (score === bestScore && best && candidate.id.localeCompare(best.id) >= 0)) continue
    best = candidate
    bestScore = score
  }
  return best
}

const findNearestGuardEnemy = (entity: WorldEntity, entities: WorldEntity[], guardPoint: Point) => {
  if (entity.factionId === 'neutral') return undefined
  return findNearestEntity(entity, entities, (candidate) => (
    candidate.id !== entity.id
    && candidate.health > 0
    && sharesAutonomousStoryline(entity, candidate)
    && candidate.factionId !== 'neutral'
    && candidate.factionId !== entity.factionId
    && distance2d(candidate.transform, guardPoint) <= guardDetectionRadiusStuds
  ))
}

const findNearestSocialTarget = (entity: WorldEntity, entities: WorldEntity[]) => findNearestEntity(
  entity,
  entities,
  (candidate) => (
    candidate.id !== entity.id &&
    candidate.health > 0 &&
    sharesAutonomousStoryline(entity, candidate) &&
    (entity.factionId === 'neutral' || candidate.factionId === 'neutral' || candidate.factionId === entity.factionId)
  ),
)

const findNearestReviveTarget = (entity: WorldEntity, entities: WorldEntity[]) => {
  const detectionRange = worldEntityDefinitionById.get(entity.definitionId)?.perception.detectionRangeStuds ?? 0
  return findNearestEntity(entity, entities, (candidate) => (
    candidate.id !== entity.id
    && candidate.health <= 0
    && sharesAutonomousStoryline(entity, candidate)
    && (entity.factionId === 'neutral' || candidate.factionId === 'neutral' || candidate.factionId === entity.factionId)
    && distance2d(entity.transform, candidate.transform) <= detectionRange
  ))
}

const nextSocialDecisionDelay = (entityId: string, elapsedSeconds: number) => {
  const key = `${entityId}:${Math.floor(elapsedSeconds)}`
  const hash = [...key].reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261)
  return 7 + (hash % 6)
}

const deterministicChoice = <T,>(values: readonly T[], key: string) => {
  const hash = [...key].reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261)
  return values[hash % values.length]
}

const createConversationSpeech = (
  speaker: WorldEntity,
  listener: WorldEntity,
  timeSeconds: number,
  reply = false,
): WorldEntity['speech'] => ({
  message: deterministicChoice(
    reply ? ['chat-reply', 'chat-agree'] as const : ['chat-greeting', 'chat-question', 'chat-support'] as const,
    `${speaker.id}:${listener.id}:${Math.floor(timeSeconds / 5)}`,
  ),
  targetName: listener.name,
  expiresAtSeconds: timeSeconds + conversationSpeechDurationSeconds,
})

const normalizeAngleRadians = (value: number) => Math.atan2(Math.sin(value), Math.cos(value))

const turnEntityToward = (
  entity: WorldEntity,
  targetPoint: Point,
  turningRadiansPerSecond: number,
  deltaSeconds: number,
) => {
  const desiredRotation = Math.atan2(
    targetPoint.x - entity.transform.x,
    targetPoint.z - entity.transform.z,
  )
  const rotationDelta = normalizeAngleRadians(desiredRotation - entity.transform.rotationRadians)
  const maximumTurn = Math.max(0, turningRadiansPerSecond * deltaSeconds)
  const appliedTurn = Math.max(-maximumTurn, Math.min(maximumTurn, rotationDelta))
  return normalizeAngleRadians(entity.transform.rotationRadians + appliedTurn)
}

const stableDirectionRadians = (entityId: string) => {
  const hash = [...entityId].reduce((value, character) => (
    Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0
  ), 2166136261)
  return hash / 0xffffffff * Math.PI * 2
}

const getContactAttackApproachPoint = (
  entity: WorldEntity,
  targetEntity: WorldEntity,
  entities: WorldEntity[],
  attackRangeStuds: number,
): Point => {
  const contactAttackers = entities
    .filter((candidate) => {
      const definition = worldEntityDefinitionById.get(candidate.definitionId)
      return candidate.health > 0
        && !definition?.combat.projectileKind
        && (
          candidate.id === entity.id
          || (
            candidate.activeCommand?.type === 'attack'
            && candidate.activeCommand.target.kind === 'entity'
            && candidate.activeCommand.target.id === targetEntity.id
          )
        )
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  const actorIndex = Math.max(0, contactAttackers.findIndex((candidate) => candidate.id === entity.id))
  const averageApproachPoint = contactAttackers.reduce(
    (point, candidate) => ({
      x: point.x + candidate.transform.x / contactAttackers.length,
      z: point.z + candidate.transform.z / contactAttackers.length,
    }),
    { x: 0, z: 0 },
  )
  const approachDx = averageApproachPoint.x - targetEntity.transform.x
  const approachDz = averageApproachPoint.z - targetEntity.transform.z
  const baseAngle = Math.hypot(approachDx, approachDz) > 0.001
    ? Math.atan2(approachDx, approachDz)
    : stableDirectionRadians(targetEntity.id)
  const angleSpacing = contactAttackers.length > 1
    ? Math.min(Math.PI / 3, Math.PI * 2 / contactAttackers.length)
    : 0
  const angle = baseAngle + (actorIndex - (contactAttackers.length - 1) / 2) * angleSpacing
  const approachRadius = getWorldEntityCollisionRadius(entity)
    + getWorldEntityCollisionRadius(targetEntity)
    + Math.max(arrivalDistanceStuds, attackRangeStuds * 0.65)
  return {
    x: targetEntity.transform.x + Math.sin(angle) * approachRadius,
    y: targetEntity.transform.y,
    z: targetEntity.transform.z + Math.cos(angle) * approachRadius,
  }
}

const getRangedAttackApproachPoint = (
  entity: WorldEntity,
  targetEntity: WorldEntity,
  entities: WorldEntity[],
  minimumRangeStuds: number,
  maximumRangeStuds: number,
  bricks: PlacedBrick[],
  entityOccupancy: WorldEntityOccupancyIndex,
  groundBounds: WorldGroundBounds,
  requiresLineOfSight: boolean,
  hasLineOfSight: (actor: WorldEntity, target: WorldEntity) => boolean,
): Point => {
  const rangedAttackers = entities
    .filter((candidate) => {
      const definition = worldEntityDefinitionById.get(candidate.definitionId)
      return candidate.health > 0
        && Boolean(definition?.combat.projectileKind)
        && (
          candidate.id === entity.id
          || (
            candidate.activeCommand?.type === 'attack'
            && candidate.activeCommand.target.kind === 'entity'
            && candidate.activeCommand.target.id === targetEntity.id
          )
        )
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  const actorIndex = Math.max(0, rangedAttackers.findIndex((candidate) => candidate.id === entity.id))
  const averageApproachPoint = rangedAttackers.reduce(
    (point, candidate) => ({
      x: point.x + candidate.transform.x / rangedAttackers.length,
      z: point.z + candidate.transform.z / rangedAttackers.length,
    }),
    { x: 0, z: 0 },
  )
  const approachDx = averageApproachPoint.x - targetEntity.transform.x
  const approachDz = averageApproachPoint.z - targetEntity.transform.z
  const baseAngle = Math.hypot(approachDx, approachDz) > 0.001
    ? Math.atan2(approachDx, approachDz)
    : stableDirectionRadians(targetEntity.id)
  const angleSpacing = rangedAttackers.length > 1
    ? Math.min(Math.PI / 8, Math.PI * 2 / rangedAttackers.length)
    : 0
  const assignedAngle = baseAngle + (actorIndex - (rangedAttackers.length - 1) / 2) * angleSpacing
  const preferredRange = minimumRangeStuds + (maximumRangeStuds - minimumRangeStuds) * 0.68
  const candidateAngles = [assignedAngle]
  for (let offset = 1; offset <= 8; offset += 1) {
    candidateAngles.push(assignedAngle + offset * Math.PI / 8, assignedAngle - offset * Math.PI / 8)
  }
  for (const angle of candidateAngles) {
    const point = {
      x: targetEntity.transform.x + Math.sin(angle) * preferredRange,
      y: targetEntity.transform.y,
      z: targetEntity.transform.z + Math.cos(angle) * preferredRange,
    }
    if (!isEntityPointInsideGround(entity, point, groundBounds)) continue
    if (isWorldEntityGroundPointBlockedByBricks(entity, point, bricks)) continue
    if (isWorldEntityPositionOccupied(entityOccupancy, entity, point)) continue
    if (requiresLineOfSight) {
      const positionedEntity = {
        ...entity,
        transform: { ...entity.transform, x: point.x, z: point.z },
      }
      if (!hasLineOfSight(positionedEntity, targetEntity)) continue
    }
    return point
  }
  return getRetreatPoint(entity, targetEntity.transform, preferredRange)
}

const getWanderDestination = (
  entity: WorldEntity,
  seed: number,
  bricks: PlacedBrick[],
  entityOccupancy: WorldEntityOccupancyIndex,
  groundBounds: WorldGroundBounds,
): Point | undefined => {
  const center = entity.controller === 'player'
    ? entity.transform
    : { ...entity.transform, ...(entity.autonomy.home ?? entity.transform) }
  const startingDirection = stableDirectionRadians(`${entity.id}:${seed}`)
  for (let attempt = 0; attempt < wanderDestinationAttempts; attempt += 1) {
    const direction = startingDirection + attempt * Math.PI * (3 - Math.sqrt(5))
    const radius = minimumWanderRadiusStuds
      + ((Math.abs(seed) + attempt * 7) % 6) * wanderRadiusStepStuds
    const point = {
      x: center.x + Math.sin(direction) * radius,
      y: entity.transform.y,
      z: center.z + Math.cos(direction) * radius,
    }
    if (!isEntityPointInsideGround(entity, point, groundBounds)) continue
    if (Math.hypot(point.x - entity.transform.x, point.z - entity.transform.z) < minimumWanderRadiusStuds * 0.5) continue
    if (isWorldEntityGroundPointBlockedByBricks(entity, point, bricks)) continue
    if (isWorldEntityPositionOccupied(entityOccupancy, entity, point)) continue
    return point
  }
  return undefined
}

const getRetreatPoint = (entity: WorldEntity, targetPoint: Point, minimumRangeStuds: number): Point => {
  let dx = entity.transform.x - targetPoint.x
  let dz = entity.transform.z - targetPoint.z
  let distance = Math.hypot(dx, dz)
  if (distance < 0.001) {
    const direction = stableDirectionRadians(entity.id)
    dx = Math.sin(direction)
    dz = Math.cos(direction)
    distance = 1
  }
  const retreatDistance = Math.max(navigationGridStuds, minimumRangeStuds - distance + navigationGridStuds)
  return {
    x: entity.transform.x + dx / distance * retreatDistance,
    y: entity.transform.y,
    z: entity.transform.z + dz / distance * retreatDistance,
  }
}

const moveEntityToward = (
  entity: WorldEntity,
  target: WorldTargetRef,
  targetPoint: Point,
  bricks: PlacedBrick[],
  entityOccupancy: WorldEntityOccupancyIndex,
  deltaSeconds: number,
  groundBounds: WorldGroundBounds,
) => {
  const definition = worldEntityDefinitionById.get(entity.definitionId)
  if (!definition) return { entity: { ...entity, behaviorState: 'blocked' as const }, arrived: false }
  const boundedTargetPoint = { ...targetPoint, ...clampEntityPointToGround(entity, targetPoint, groundBounds) }
  const targetChanged = entity.navigation.target?.kind !== target.kind || entity.navigation.target?.id !== target.id
  const plannedTargetPoint = entity.navigation.plannedTargetPoint
  const movingTargetChangedPosition = target.kind === 'entity' && (
    !plannedTargetPoint
    || Math.hypot(boundedTargetPoint.x - plannedTargetPoint.x, boundedTargetPoint.z - plannedTargetPoint.z) >= navigationGridStuds
  )
  const shouldReplan = targetChanged || movingTargetChangedPosition
  let path = shouldReplan ? [] : entity.navigation.path
  let pathIndex = shouldReplan ? 0 : entity.navigation.pathIndex
  let nextPlannedTargetPoint = shouldReplan ? undefined : plannedTargetPoint
  if (path.length === 0 || pathIndex >= path.length) {
    path = findWorldPath(entity.transform, boundedTargetPoint, createObstacleTest(bricks, entity, entityOccupancy, groundBounds))
    pathIndex = 0
    nextPlannedTargetPoint = { x: boundedTargetPoint.x, z: boundedTargetPoint.z }
  }
  const destination = path[pathIndex] ?? boundedTargetPoint
  const dx = destination.x - entity.transform.x
  const dz = destination.z - entity.transform.z
  const distance = Math.hypot(dx, dz)
  if (distance <= arrivalDistanceStuds && pathIndex >= path.length - 1) {
    return {
      entity: {
        ...entity,
        behaviorState: 'idle' as const,
        navigation: { status: 'idle' as const, target, plannedTargetPoint: nextPlannedTargetPoint, path, pathIndex },
      },
      arrived: true,
    }
  }
  if (path.length === 0 && distance > arrivalDistanceStuds) {
    return {
      entity: {
        ...entity,
        behaviorState: 'blocked' as const,
        navigation: { status: 'blocked' as const, target, plannedTargetPoint: nextPlannedTargetPoint, path: [], pathIndex: 0 },
      },
      arrived: false,
    }
  }

  const nextRotation = turnEntityToward(
    entity,
    destination,
    definition.movement.turningRadiansPerSecond,
    deltaSeconds,
  )
  const desiredRotation = Math.atan2(dx, dz)
  const remainingTurn = Math.abs(normalizeAngleRadians(desiredRotation - nextRotation))
  const movementAlignment = Math.max(0, Math.cos(remainingTurn))
  const step = Math.min(
    distance,
    definition.movement.speedStudsPerSecond * deltaSeconds * movementAlignment,
  )
  const nextPathIndex = distance <= step + 0.001 ? Math.min(path.length, pathIndex + 1) : pathIndex
  const unboundedNextPoint = {
    x: entity.transform.x + dx / Math.max(distance, 0.0001) * step,
    z: entity.transform.z + dz / Math.max(distance, 0.0001) * step,
  }
  const nextPoint = clampEntityPointToGround(entity, unboundedNextPoint, groundBounds)
  if (isWorldEntityPositionOccupied(
    entityOccupancy,
    entity,
    nextPoint,
    { allowSeparatingFromCurrent: true },
  )) {
    return {
      entity: {
        ...entity,
        behaviorState: 'blocked' as const,
        navigation: { status: 'blocked' as const, target, plannedTargetPoint: nextPlannedTargetPoint, path: [], pathIndex: 0 },
      },
      arrived: false,
    }
  }
  return {
    entity: {
      ...entity,
      behaviorState: 'moving' as const,
      transform: {
        ...entity.transform,
        x: nextPoint.x,
        z: nextPoint.z,
        rotationRadians: nextRotation,
      },
      navigation: {
        status: 'moving' as const,
        target,
        plannedTargetPoint: nextPlannedTargetPoint,
        path,
        pathIndex: nextPathIndex,
      },
    },
    arrived: false,
  }
}

const makeEvent = (
  timeSeconds: number,
  type: WorldEvent['type'],
  actorId: string,
  targetId?: string,
  amount?: number,
  details: Pick<WorldEvent, 'projectileKind' | 'origin' | 'impactPoint'> = {},
): WorldEvent => ({
  id: `event-${Math.round(timeSeconds * 1000)}-${actorId}-${type}`,
  timeSeconds,
  type,
  actorId,
  targetId,
  amount,
  ...details,
})

const makeScenarioAwareInteractionEvent = (
  world: WorldState,
  timeSeconds: number,
  actorId: string,
  targetId: string,
) => {
  const activeTriggers = world.scenarios.flatMap((scenario) => {
    if (scenario.enabled === false || scenario.activeDialogue || scenario.pendingAi) return []
    const stage = scenario.stages.find((candidate) => candidate.status === 'active')
    if (!stage) return []
    return [stage.trigger, ...(stage.branches ?? []).map((branch) => branch.trigger)]
  }).filter((trigger) => (
    trigger.eventType === 'interaction'
    && trigger.actorId
    && trigger.targetId
  ))
  const trigger = activeTriggers.find((candidate) => (
    candidate.actorId === actorId && candidate.targetId === targetId
  )) ?? activeTriggers.find((candidate) => (
    candidate.actorId === targetId && candidate.targetId === actorId
  ))
  return makeEvent(
    timeSeconds,
    'interaction',
    trigger?.actorId ?? actorId,
    trigger?.targetId ?? targetId,
  )
}

const commandTarget = (command: WorldEntityCommand) => 'target' in command ? command.target : undefined

const getCommandTargetName = (
  command: WorldEntityCommand,
  entities: WorldEntity[],
  lookup: WorldTargetLookup,
) => {
  const target = commandTarget(command)
  if (!target) return undefined
  if (target.kind === 'entity') {
    const index = lookup.entityIndexById.get(target.id)
    return index === undefined ? target.id : entities[index]?.name ?? target.id
  }
  if (target.kind === 'structure') return lookup.structureById.get(target.id)?.name ?? target.id
  if (target.kind === 'brick') {
    const brick = lookup.brickById.get(target.id)
    return brick ? brickById.get(brick.brickId)?.name ?? target.id : target.id
  }
  return target.id
}

const createPendingImpact = (
  timeSeconds: number,
  actor: WorldEntity,
  target: Extract<WorldTargetRef, { kind: 'entity' | 'brick' | 'structure' }>,
  damage: number,
  projectileKind: 'arrow' | 'stone',
  targetPoint: Point,
): WorldPendingImpact => ({
  id: `impact-${Math.random().toString(36).slice(2, 9)}`,
  actorId: actor.id,
  target,
  damage,
  projectileKind,
  impactPoint: { ...targetPoint },
  impactAtSeconds: timeSeconds + getWorldProjectileFlightSeconds(
    projectileKind,
    distance2d(actor.transform, targetPoint),
  ),
})

export const stepWorldSimulation = (
  world: WorldState,
  allBricks: PlacedBrick[],
  deltaSeconds = worldSimulationStepSeconds,
  allStructures: BrickStructure[] = [],
  options: { suspendAutomaticControllers?: boolean } = {},
): WorldState => {
  if (world.entities.length === 0 || deltaSeconds <= 0) return world
  const hiddenTargetKeys = new Set(world.hiddenTargets.map((target) => `${target.kind}:${target.id}`))
  const hiddenStructureIds = new Set(world.hiddenTargets.filter((target) => target.kind === 'structure').map((target) => target.id))
  const hiddenBrickIds = new Set([
    ...world.hiddenTargets.filter((target) => target.kind === 'brick').map((target) => target.id),
    ...allStructures.filter((structure) => hiddenStructureIds.has(structure.id)).flatMap((structure) => structure.brickIds),
  ])
  const hiddenEntityIds = new Set(world.hiddenTargets.filter((target) => target.kind === 'entity').map((target) => target.id))
  // Preserve stable collection identities in the common case. The obstacle,
  // ground-bounds and brick lookup caches are keyed by these immutable arrays.
  const bricks = hiddenBrickIds.size === 0
    ? allBricks
    : allBricks.filter((brick) => !hiddenBrickIds.has(brick.id))
  const structures = hiddenStructureIds.size === 0
    ? allStructures
    : allStructures.filter((structure) => !hiddenStructureIds.has(structure.id))
  const groundBounds = getWorldGroundBounds(bricks)
  let correctedBoundary = false
  const visibleSourceEntities = hiddenEntityIds.size === 0
    ? world.entities
    : world.entities.filter((entity) => !hiddenTargetKeys.has(`entity:${entity.id}`))
  const boundedEntities = visibleSourceEntities.map((entity) => {
    const point = clampEntityPointToGround(entity, entity.transform, groundBounds)
    if (point.x === entity.transform.x && point.z === entity.transform.z) return entity
    correctedBoundary = true
    return { ...entity, transform: { ...entity.transform, ...point }, autonomy: { ...entity.autonomy, home: clampEntityPointToGround(entity, entity.autonomy.home, groundBounds) } }
  })
  if (world.paused) {
    if (!correctedBoundary) return world
    const correctedById = new Map(boundedEntities.map((entity) => [entity.id, entity]))
    return { ...world, entities: world.entities.map((entity) => correctedById.get(entity.id) ?? entity) }
  }
  const timeSeconds = world.elapsedSeconds + deltaSeconds
  const entities: WorldEntity[] = resolveOverlappingWorldEntities(boundedEntities).map((entity): WorldEntity => ({
    ...entity,
    transform: { ...entity.transform, ...clampEntityPointToGround(entity, entity.transform, groundBounds) },
    speech: entity.speech && entity.speech.expiresAtSeconds > timeSeconds ? entity.speech : undefined,
    combat: {
      ...entity.combat,
      cooldownRemainingSeconds: Math.max(0, entity.combat.cooldownRemainingSeconds - deltaSeconds),
    },
  }))
  const narrativeLockedEntityIds = new Set(world.scenarios.flatMap((scenario) => {
    if (!scenario.activeDialogue) return []
    const activeStage = scenario.stages.find((stage) => stage.id === scenario.activeDialogue?.stageId)
    const activeBranch = scenario.activeDialogue.branchId
      ? activeStage?.branches?.find((branch) => branch.id === scenario.activeDialogue?.branchId)
      : undefined
    const dialogue = activeBranch?.dialogue ?? activeStage?.dialogue ?? []
    return [...(scenario.castEntityIds ?? []), ...dialogue.map((line) => line.speakerId)]
  }))
  const reservePartyMemberIds = new Set(world.parties.flatMap((party) => (
    party.members.flatMap((member) => member.status === 'reserve' ? [member.entityId] : [])
  )))
  const targetLookup: WorldTargetLookup = {
    entityIndexById: new Map(entities.map((entity, index) => [entity.id, index])),
    entityById: new Map(entities.map((entity) => [entity.id, entity])),
    brickById: getCachedBrickLookup(bricks),
    structureById: new Map(structures.map((structure) => [structure.id, structure])),
    structurePointById: new Map(),
  }
  const hasLineOfSight = createWorldLineOfSightTest(bricks)
  const entityOccupancy = createWorldEntityOccupancyIndex(entities)
  const events: WorldEvent[] = []
  const impactIsVisible = (impact: WorldPendingImpact) => !hiddenEntityIds.has(impact.actorId)
    && !(impact.target.kind === 'entity' && hiddenEntityIds.has(impact.target.id))
    && !(impact.target.kind === 'brick' && hiddenBrickIds.has(impact.target.id))
    && !(impact.target.kind === 'structure' && hiddenStructureIds.has(impact.target.id))
  const impactInterruptsDialogue = (impact: WorldPendingImpact) => narrativeLockedEntityIds.has(impact.actorId)
    || (impact.target.kind === 'entity' && narrativeLockedEntityIds.has(impact.target.id))
  const pendingImpacts = world.pendingImpacts.filter((impact) => (
    impactIsVisible(impact) && !impactInterruptsDialogue(impact) && impact.impactAtSeconds > timeSeconds
  ))
  const dueImpacts = world.pendingImpacts.filter((impact) => (
    impactIsVisible(impact) && !impactInterruptsDialogue(impact) && impact.impactAtSeconds <= timeSeconds
  ))

  const applyEntityDamage = (actorIndex: number, targetIndex: number, damage: number) => {
    const actor = entities[actorIndex]
    const victim = entities[targetIndex]
    if (!actor || !victim || victim.health <= 0) return false
    const nextHealth = Math.max(0, victim.health - damage)
    const defeated = nextHealth <= 0
    entities[targetIndex] = defeated
      ? {
          ...victim,
          health: 0,
          activeCommand: undefined,
          commandQueue: [],
          speech: undefined,
          behaviorState: 'dead',
          navigation: { status: 'idle', path: [], pathIndex: 0 },
          combat: {
            ...victim.combat,
            lastAttackerId: actor.id,
            lastDamagedAtSeconds: timeSeconds,
            lastDamageAmount: damage,
            damageIndicatorExpiresAtSeconds: timeSeconds + 1.1,
          },
        }
      : {
          ...victim,
          health: nextHealth,
          speech: {
            message: 'combat-hurt',
            targetName: actor.name,
            expiresAtSeconds: timeSeconds + 2.4,
          },
          combat: {
            ...victim.combat,
            lastAttackerId: actor.id,
            lastDamagedAtSeconds: timeSeconds,
            lastDamageAmount: damage,
            damageIndicatorExpiresAtSeconds: timeSeconds + 1.1,
          },
        }
    events.push(makeEvent(timeSeconds, 'damage', actor.id, victim.id, damage))
    if (defeated) {
      events.push(makeEvent(timeSeconds, 'defeated', actor.id, victim.id))
      entities[actorIndex] = {
        ...entities[actorIndex],
        speech: {
          message: 'combat-victory',
          targetName: victim.name,
          expiresAtSeconds: timeSeconds + 3,
        },
      }
    }
    return defeated
  }

  for (const impact of dueImpacts) {
    const actorIndex = targetLookup.entityIndexById.get(impact.actorId)
    if (actorIndex === undefined) continue
    if (impact.target.kind === 'entity') {
      const targetIndex = targetLookup.entityIndexById.get(impact.target.id)
      if (targetIndex === undefined || entities[targetIndex].health <= 0) continue
      const victim = entities[targetIndex]
      const hitRadius = getWorldEntityCollisionRadius(victim) + (impact.projectileKind === 'stone' ? 1.25 : 0.3)
      const missed = distance2d(victim.transform, impact.impactPoint) > hitRadius
      if (missed) {
        events.push(makeEvent(timeSeconds, 'miss', impact.actorId, victim.id))
      } else if (applyEntityDamage(actorIndex, targetIndex, impact.damage)) {
        if (entities[actorIndex].activeCommand?.type === 'attack') {
          entities[actorIndex] = { ...entities[actorIndex], activeCommand: undefined }
        }
      }
    } else if (impact.target.kind === 'brick') {
      if (targetLookup.brickById.has(impact.target.id)) {
        events.push(makeEvent(timeSeconds, 'brick-hit', impact.actorId, impact.target.id))
      }
    } else if (targetLookup.structureById.has(impact.target.id)) {
      events.push(makeEvent(timeSeconds, 'structure-hit', impact.actorId, impact.target.id))
    }
  }

  for (let index = 0; index < entities.length; index += 1) {
    let entity = entities[index]
    if (entity.health <= 0) {
      entities[index] = {
        ...entity,
        activeCommand: undefined,
        commandQueue: [],
        speech: undefined,
        behaviorState: 'dead',
        navigation: { status: 'idle', path: [], pathIndex: 0 },
      }
      continue
    }
    if (narrativeLockedEntityIds.has(entity.id)) {
      entities[index] = {
        ...entity,
        activeCommand: undefined,
        commandQueue: [],
        behaviorState: 'idle',
        navigation: { status: 'idle', path: [], pathIndex: 0 },
        combat: { ...entity.combat, attackTargetId: undefined },
      }
      continue
    }
    if (reservePartyMemberIds.has(entity.id)) {
      entities[index] = {
        ...entity,
        activeCommand: undefined,
        commandQueue: [],
        behaviorState: 'idle',
        navigation: { status: 'idle', path: [], pathIndex: 0 },
        combat: { ...entity.combat, attackTargetId: undefined },
      }
      continue
    }
    let activeCommand = entity.activeCommand
    let commandQueue = entity.commandQueue
    let commandStarted = false
    if (!activeCommand && commandQueue.length > 0) {
      activeCommand = commandQueue[0]
      commandQueue = commandQueue.slice(1)
      commandStarted = true
    }
    if (!activeCommand && entity.controller !== 'player' && !options.suspendAutomaticControllers) {
      const definition = worldEntityDefinitionById.get(entity.definitionId)
      const reviveTarget = definition?.support ? findNearestReviveTarget(entity, entities) : undefined
      const enemy = reviveTarget ? undefined : findBestEnemy(entity, entities, targetLookup.entityById, timeSeconds)
      if (reviveTarget) {
        activeCommand = { type: 'revive', target: { kind: 'entity', id: reviveTarget.id } }
        commandStarted = true
      } else if (enemy) {
        activeCommand = { type: 'attack', target: { kind: 'entity', id: enemy.id } }
        commandStarted = true
      } else if (timeSeconds >= entity.autonomy.nextDecisionAtSeconds) {
        const socialTarget = findNearestSocialTarget(entity, entities)
        const decisionSeed = Math.floor(timeSeconds * 10)
        const socialTargetIsClose = socialTarget && distance2d(entity.transform, socialTarget.transform)
          <= getWorldEntityCollisionRadius(entity) + getWorldEntityCollisionRadius(socialTarget) + arrivalDistanceStuds
        const shouldSocialize = socialTarget
          && (socialTargetIsClose || Math.floor(stableDirectionRadians(`${entity.id}:${decisionSeed}`) * 1_000) % 3 === 0)
        entity = {
          ...entity,
          autonomy: {
            ...entity.autonomy,
            nextDecisionAtSeconds: timeSeconds + nextSocialDecisionDelay(entity.id, timeSeconds),
          },
        }
        if (socialTarget && shouldSocialize) {
          activeCommand = { type: 'interact', target: { kind: 'entity', id: socialTarget.id } }
          commandStarted = true
        } else {
          activeCommand = { type: 'wander', seed: decisionSeed }
          commandStarted = true
        }
      }
    }
    const activeTarget = activeCommand && 'target' in activeCommand ? activeCommand.target : undefined
    if (activeTarget?.kind === 'entity' && narrativeLockedEntityIds.has(activeTarget.id)) {
      entities[index] = {
        ...entity,
        activeCommand: undefined,
        behaviorState: 'idle',
        navigation: { status: 'idle', path: [], pathIndex: 0 },
        combat: { ...entity.combat, attackTargetId: undefined },
      }
      continue
    }
    entity = { ...entity, activeCommand, commandQueue }
    if (commandStarted && activeCommand) {
      const isScriptedDialogue = activeCommand.type === 'interact'
        && Boolean(activeCommand.speechText?.trim())
      entity = {
        ...entity,
        speech: entity.speech?.message === 'combat-hurt' || entity.speech?.message === 'combat-victory'
          ? entity.speech
          : isScriptedDialogue
            ? undefined
            : {
              message: activeCommand.type,
              targetName: getCommandTargetName(activeCommand, entities, targetLookup),
              expiresAtSeconds: timeSeconds + commandSpeechDurationSeconds,
            },
      }
    }
    if (!activeCommand || activeCommand.type === 'stop') {
      entities[index] = {
        ...entity,
        activeCommand: undefined,
        behaviorState: 'idle',
        combat: { ...entity.combat, attackTargetId: undefined },
      }
      continue
    }

    if (activeCommand.type === 'wander') {
      const wanderCommand = activeCommand.seed === undefined
        ? { ...activeCommand, seed: Math.floor(timeSeconds * 10) }
        : activeCommand
      const wanderTarget: WorldTargetRef = {
        kind: 'waypoint',
        id: `wander:${entity.id}:${wanderCommand.seed}`,
      }
      const continuingWander = entity.navigation.target?.kind === wanderTarget.kind
        && entity.navigation.target.id === wanderTarget.id
      const wanderPoint = continuingWander && entity.navigation.plannedTargetPoint
        ? {
            ...entity.transform,
            x: entity.navigation.plannedTargetPoint.x,
            z: entity.navigation.plannedTargetPoint.z,
          }
        : getWanderDestination(entity, wanderCommand.seed, bricks, entityOccupancy, groundBounds)
      if (!wanderPoint) {
        entities[index] = {
          ...entity,
          activeCommand: undefined,
          behaviorState: 'idle',
          navigation: { status: 'idle', path: [], pathIndex: 0 },
          autonomy: {
            ...entity.autonomy,
            nextDecisionAtSeconds: Math.max(entity.autonomy.nextDecisionAtSeconds, timeSeconds + 2),
          },
        }
        updateWorldEntityOccupancy(entityOccupancy, entities[index])
        continue
      }
      const movement = moveEntityToward(
        { ...entity, activeCommand: wanderCommand },
        wanderTarget,
        wanderPoint,
        bricks,
        entityOccupancy,
        deltaSeconds,
        groundBounds,
      )
      const finished = movement.arrived || movement.entity.behaviorState === 'blocked'
      entities[index] = finished ? {
        ...movement.entity,
        activeCommand: undefined,
        behaviorState: 'idle',
        navigation: { status: 'idle', path: [], pathIndex: 0 },
        autonomy: {
          ...movement.entity.autonomy,
          nextDecisionAtSeconds: Math.max(movement.entity.autonomy.nextDecisionAtSeconds, timeSeconds + 2),
        },
      } : movement.entity
      updateWorldEntityOccupancy(entityOccupancy, entities[index])
      continue
    }

    if (activeCommand.type === 'revive') {
      const support = worldEntityDefinitionById.get(entity.definitionId)?.support
      const targetIndex = targetLookup.entityIndexById.get(activeCommand.target.id)
      const reviveTarget = targetIndex === undefined ? undefined : entities[targetIndex]
      if (!support || !reviveTarget || reviveTarget.id === entity.id || reviveTarget.health > 0) {
        entities[index] = {
          ...entity,
          activeCommand: undefined,
          behaviorState: 'idle',
          navigation: { status: 'idle', path: [], pathIndex: 0 },
          combat: { ...entity.combat, attackTargetId: undefined },
        }
        updateWorldEntityOccupancy(entityOccupancy, entities[index])
        continue
      }

      const combinedBodyRadius = getWorldEntityCollisionRadius(entity) + getWorldEntityCollisionRadius(reviveTarget)
      const reviveDistance = Math.max(0, distance2d(entity.transform, reviveTarget.transform) - combinedBodyRadius)
      if (reviveDistance <= support.reviveRangeStuds) {
        const targetChanged = entity.combat.attackTargetId !== reviveTarget.id
        const definition = worldEntityDefinitionById.get(entity.definitionId)!
        const nextRotation = turnEntityToward(
          entity,
          reviveTarget.transform,
          definition.movement.turningRadiansPerSecond,
          deltaSeconds,
        )
        const desiredRotation = Math.atan2(
          reviveTarget.transform.x - entity.transform.x,
          reviveTarget.transform.z - entity.transform.z,
        )
        const aimError = Math.abs(normalizeAngleRadians(desiredRotation - nextRotation))
        entity = {
          ...entity,
          behaviorState: 'reviving',
          transform: { ...entity.transform, rotationRadians: nextRotation },
          combat: {
            ...entity.combat,
            attackTargetId: reviveTarget.id,
            cooldownRemainingSeconds: targetChanged
              ? Math.max(entity.combat.cooldownRemainingSeconds, support.reviveWindupSeconds)
              : entity.combat.cooldownRemainingSeconds,
          },
        }
        if (entity.combat.cooldownRemainingSeconds <= 0 && aimError <= 0.22) {
          const restoredHealth = Math.max(1, Math.round(reviveTarget.maxHealth * support.reviveHealthRatio))
          entities[targetIndex!] = {
            ...reviveTarget,
            health: restoredHealth,
            activeCommand: undefined,
            commandQueue: [],
            behaviorState: 'idle',
            navigation: { status: 'idle', path: [], pathIndex: 0 },
            speech: {
              message: 'revived',
              targetName: entity.name,
              expiresAtSeconds: timeSeconds + 3,
            },
            combat: {
              ...reviveTarget.combat,
              cooldownRemainingSeconds: 0,
              attackTargetId: undefined,
            },
            autonomy: {
              ...reviveTarget.autonomy,
              nextDecisionAtSeconds: Math.max(reviveTarget.autonomy.nextDecisionAtSeconds, timeSeconds + 2),
            },
          }
          events.push(makeEvent(timeSeconds, 'revive', entity.id, reviveTarget.id, restoredHealth))
          entity = {
            ...entity,
            activeCommand: undefined,
            behaviorState: 'idle',
            navigation: { status: 'idle', path: [], pathIndex: 0 },
            speech: {
              message: 'revive-success',
              targetName: reviveTarget.name,
              expiresAtSeconds: timeSeconds + 3,
            },
            combat: {
              ...entity.combat,
              cooldownRemainingSeconds: support.reviveCooldownSeconds,
              attackTargetId: undefined,
            },
          }
        }
        entities[index] = entity
        updateWorldEntityOccupancy(entityOccupancy, entity)
        continue
      }

      const movement = moveEntityToward(
        entity,
        activeCommand.target,
        reviveTarget.transform,
        bricks,
        entityOccupancy,
        deltaSeconds,
        groundBounds,
      )
      entities[index] = movement.entity
      updateWorldEntityOccupancy(entityOccupancy, movement.entity)
      continue
    }

    const assignedTarget = commandTarget(activeCommand)
    if (!assignedTarget) {
      entities[index] = entity
      continue
    }
    const assignedTargetPoint = getTargetPoint(assignedTarget, entities, targetLookup)
    if (!assignedTargetPoint) {
      entities[index] = {
        ...entity,
        activeCommand: undefined,
        behaviorState: 'idle',
        combat: { ...entity.combat, attackTargetId: undefined },
      }
      continue
    }
    const guardEnemy = activeCommand.type === 'guard'
      ? findNearestGuardEnemy(entity, entities, assignedTargetPoint)
      : undefined
    const target: WorldTargetRef = guardEnemy
      ? { kind: 'entity', id: guardEnemy.id }
      : assignedTarget
    const targetPoint = guardEnemy?.transform ?? assignedTargetPoint
    const definition = worldEntityDefinitionById.get(entity.definitionId)
    const isAttack = activeCommand.type === 'attack' || Boolean(guardEnemy)
    const targetEntityIndex = target.kind === 'entity' ? targetLookup.entityIndexById.get(target.id) : undefined
    const targetEntity = targetEntityIndex === undefined ? undefined : entities[targetEntityIndex]
    const centerDistance = distance2d(entity.transform, targetPoint)
    const combinedBodyRadius = targetEntity
      ? getWorldEntityCollisionRadius(entity) + getWorldEntityCollisionRadius(targetEntity)
      : 0
    // Every direct-contact attack must measure the gap between body edges.
    // Restricting this to the "melee" role made utility units such as priests
    // try to reach the target's center, which collision avoidance correctly
    // prevented whenever another ally was already engaging that target.
    const targetDistance = targetEntity && !definition?.combat.projectileKind
      ? Math.max(0, centerDistance - combinedBodyRadius)
      : centerDistance
    if (!isAttack && entity.combat.attackTargetId) {
      entity = { ...entity, combat: { ...entity.combat, attackTargetId: undefined } }
    }
    const isInteractionInReach = activeCommand.type === 'interact'
      && targetEntity
      && centerDistance <= combinedBodyRadius + arrivalDistanceStuds
    if (isInteractionInReach) {
      events.push(makeScenarioAwareInteractionEvent(world, timeSeconds, entity.id, target.id))
      const listenerIndex = targetLookup.entityIndexById.get(target.id)
      const listener = listenerIndex === undefined ? undefined : entities[listenerIndex]
      const scriptedSpeech = activeCommand.type === 'interact' ? activeCommand.speechText?.trim() : undefined
      const speechDurationSeconds = scriptedSpeech
        ? Math.min(14, Math.max(5, scriptedSpeech.length / 5))
        : conversationSpeechDurationSeconds
      entities[index] = {
        ...entity,
        activeCommand: scriptedSpeech ? undefined : { type: 'wander', seed: Math.floor(timeSeconds * 10) + 1 },
        behaviorState: 'idle',
        speech: scriptedSpeech
          ? {
              message: 'scenario-dialogue',
              text: scriptedSpeech,
              expiresAtSeconds: timeSeconds + speechDurationSeconds,
            }
          : listener ? createConversationSpeech(entity, listener, timeSeconds) : entity.speech,
        navigation: { status: 'idle', path: [], pathIndex: 0 },
      }
      if (!scriptedSpeech && listener && listener.health > 0) {
        entities[listenerIndex!] = {
          ...listener,
          speech: createConversationSpeech(listener, entity, timeSeconds, true),
          autonomy: {
            ...listener.autonomy,
            nextDecisionAtSeconds: Math.max(listener.autonomy.nextDecisionAtSeconds, timeSeconds + 4),
          },
        }
      }
      continue
    }
    const minimumRangeStuds = definition?.combat.minimumRangeStuds ?? 0
    const rangedAttackPoint = isAttack && targetEntity && definition?.combat.projectileKind
      ? getRangedAttackApproachPoint(
          entity,
          targetEntity,
          entities,
          minimumRangeStuds,
          definition.combat.attackRangeStuds,
          bricks,
          entityOccupancy,
          groundBounds,
          definition.combat.projectileKind === 'arrow',
          hasLineOfSight,
        )
      : undefined
    if (isAttack && targetEntity && minimumRangeStuds > 0 && targetDistance < minimumRangeStuds) {
      const retreat = moveEntityToward(
        entity,
        target,
        rangedAttackPoint ?? getRetreatPoint(entity, targetPoint, minimumRangeStuds + combinedBodyRadius),
        bricks,
        entityOccupancy,
        deltaSeconds,
        groundBounds,
      )
      entities[index] = retreat.entity
      updateWorldEntityOccupancy(entityOccupancy, retreat.entity)
      continue
    }
    const hasAttackLineOfSight = definition?.combat.projectileKind !== 'arrow' || !targetEntity || hasLineOfSight(entity, targetEntity)
    if (isAttack && definition && targetDistance <= definition.combat.attackRangeStuds && hasAttackLineOfSight) {
      const attackTargetChanged = entity.combat.attackTargetId !== target.id
      const nextRotation = turnEntityToward(
        entity,
        targetPoint,
        definition.movement.turningRadiansPerSecond,
        deltaSeconds,
      )
      const desiredRotation = Math.atan2(targetPoint.x - entity.transform.x, targetPoint.z - entity.transform.z)
      const aimError = Math.abs(normalizeAngleRadians(desiredRotation - nextRotation))
      entity = {
        ...entity,
        behaviorState: 'attacking',
        combat: {
          ...entity.combat,
          attackTargetId: target.id,
          cooldownRemainingSeconds: attackTargetChanged
            ? Math.max(entity.combat.cooldownRemainingSeconds, definition.combat.windupSeconds)
            : entity.combat.cooldownRemainingSeconds,
        },
        transform: {
          ...entity.transform,
          rotationRadians: nextRotation,
        },
      }
      if (entity.combat.cooldownRemainingSeconds <= 0 && aimError <= 0.22) {
        entity = {
          ...entity,
          speech: entity.speech ?? {
            message: 'combat-attack',
            targetName: getCommandTargetName({ type: 'attack', target: target as Extract<WorldTargetRef, { kind: 'entity' | 'brick' | 'structure' }> }, entities, targetLookup),
            expiresAtSeconds: timeSeconds + 2.4,
          },
          combat: { ...entity.combat, cooldownRemainingSeconds: definition.combat.cooldownSeconds },
        }
        events.push(makeEvent(timeSeconds, 'attack', entity.id, target.id, definition.combat.damage, definition.combat.projectileKind ? {
          projectileKind: definition.combat.projectileKind,
          origin: {
            x: entity.transform.x,
            y: entity.transform.y + definition.body.attackOriginHeightStuds,
            z: entity.transform.z,
          },
          impactPoint: targetEntity ? {
            x: targetPoint.x,
            y: targetPoint.y + (worldEntityDefinitionById.get(targetEntity.definitionId)?.body.heightStuds ?? 2) * 0.55,
            z: targetPoint.z,
          } : { ...targetPoint },
        } : {}))
        if (definition.combat.projectileKind) {
          pendingImpacts.push(createPendingImpact(
            timeSeconds,
            entity,
            target as Extract<WorldTargetRef, { kind: 'entity' | 'brick' | 'structure' }>,
            definition.combat.damage,
            definition.combat.projectileKind,
            targetPoint,
          ))
        } else if (target.kind === 'entity') {
          const targetIndex = targetLookup.entityIndexById.get(target.id)
          if (targetIndex !== undefined) {
            entities[index] = entity
            const defeated = applyEntityDamage(index, targetIndex, definition.combat.damage)
            entity = entities[index]
            if (defeated) {
              if (activeCommand.type === 'attack') entity = { ...entity, activeCommand: undefined }
            }
          }
        } else if (target.kind === 'brick') {
          events.push(makeEvent(timeSeconds, 'brick-hit', entity.id, target.id))
        } else if (target.kind === 'structure') {
          events.push(makeEvent(timeSeconds, 'structure-hit', entity.id, target.id))
        }
      }
      entities[index] = entity
      continue
    }

    const movementTargetPoint = isAttack && targetEntity && definition && !definition.combat.projectileKind
      ? getContactAttackApproachPoint(entity, targetEntity, entities, definition.combat.attackRangeStuds)
      : rangedAttackPoint ?? targetPoint
    const movement = moveEntityToward(entity, target, movementTargetPoint, bricks, entityOccupancy, deltaSeconds, groundBounds)
    entity = movement.entity
    if (movement.arrived && !isAttack) {
      if (activeCommand.type === 'follow') {
        entity = { ...entity, behaviorState: 'following' }
      } else if (activeCommand.type === 'guard') {
        entity = { ...entity, behaviorState: 'guarding' }
      } else if (activeCommand.type === 'interact' && target.kind === 'entity') {
        events.push(makeScenarioAwareInteractionEvent(world, timeSeconds, entity.id, target.id))
        const listenerIndex = targetLookup.entityIndexById.get(target.id)
        const listener = listenerIndex === undefined ? undefined : entities[listenerIndex]
        const scriptedSpeech = activeCommand.speechText?.trim()
        const speechDurationSeconds = scriptedSpeech
          ? Math.min(14, Math.max(5, scriptedSpeech.length / 5))
          : conversationSpeechDurationSeconds
        entity = {
          ...entity,
          activeCommand: scriptedSpeech ? undefined : { type: 'wander', seed: Math.floor(timeSeconds * 10) + 1 },
          behaviorState: 'idle',
          speech: scriptedSpeech
            ? {
                message: 'scenario-dialogue',
                text: scriptedSpeech,
                expiresAtSeconds: timeSeconds + speechDurationSeconds,
              }
            : listener ? createConversationSpeech(entity, listener, timeSeconds) : entity.speech,
          navigation: { status: 'idle', path: [], pathIndex: 0 },
        }
        if (!scriptedSpeech && listener && listener.health > 0) {
          entities[listenerIndex!] = {
            ...listener,
            speech: createConversationSpeech(listener, entity, timeSeconds, true),
            autonomy: {
              ...listener.autonomy,
              nextDecisionAtSeconds: Math.max(listener.autonomy.nextDecisionAtSeconds, timeSeconds + 4),
            },
          }
        }
      } else {
        events.push(makeEvent(
          timeSeconds,
          'command-complete',
          entity.id,
          target.id,
        ))
        entity = { ...entity, activeCommand: undefined }
      }
    }
    entities[index] = entity
    updateWorldEntityOccupancy(entityOccupancy, entity)
  }

  const entityNameById = new Map(entities.map((entity) => [entity.id, entity.name]))
  const structureNameById = new Map(structures.map((structure) => [structure.id, structure.name]))
  const enrichedEvents = events.map((event) => ({
    ...event,
    actorName: entityNameById.get(event.actorId) ?? event.actorName,
    targetName: event.targetId
      ? entityNameById.get(event.targetId) ?? structureNameById.get(event.targetId) ?? event.targetName
      : event.targetName,
  }))
  const processedEventIds = new Set(world.narrative.processedEventIds)
  const pendingExistingEvents = world.events.filter((event) => !processedEventIds.has(event.id))
  const simulatedEntityById = new Map(entities.map((entity) => [entity.id, entity]))
  const mergedEntities = world.entities.map((entity) => simulatedEntityById.get(entity.id) ?? entity)
  return {
    ...world,
    elapsedSeconds: timeSeconds,
    entities: mergedEntities,
    events: [...world.events, ...enrichedEvents].slice(-maxEventHistory),
    pendingImpacts,
    narrative: ingestWorldEvents(world.narrative, [...pendingExistingEvents, ...enrichedEvents], new Set(mergedEntities.map((entity) => entity.id))),
  }
}
