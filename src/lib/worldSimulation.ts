import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
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

type Point = { x: number; y: number; z: number }
type GridNode = { x: number; z: number }
type BrickBounds = WorldObstacleBounds
type WorldTargetLookup = {
  entityIndexById: Map<string, number>
  brickById: Map<string, PlacedBrick>
  structureById: Map<string, BrickStructure>
  structurePointById: Map<string, Point | undefined>
}
const obstacleIndexCache = new WeakMap<PlacedBrick[], WorldObstacleIndex>()

const getCachedObstacleIndex = (bricks: PlacedBrick[]) => {
  const cached = obstacleIndexCache.get(bricks)
  if (cached) return cached
  const index = createWorldObstacleIndex(bricks)
  obstacleIndexCache.set(bricks, index)
  return index
}

const distance2d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)
const gridKey = (node: GridNode) => `${node.x}:${node.z}`
const toGrid = (value: number) => Math.round(value / navigationGridStuds)
const fromGrid = (value: number) => value * navigationGridStuds

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
) => {
  const resultCache = new Map<string, boolean>()
  return (x: number, z: number) => {
    const key = `${x}:${z}`
    const cached = resultCache.get(key)
    if (cached !== undefined) return cached
    const blockedByBrick = isWorldEntityGroundPointBlockedByBricks(entity, { x, z }, bricks)
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

const findNearestEnemy = (entity: WorldEntity, entities: WorldEntity[]) => {
  if (entity.factionId === 'neutral') return undefined
  const detectionRange = worldEntityDefinitionById.get(entity.definitionId)?.perception.detectionRangeStuds ?? 0
  return findNearestEntity(entity, entities, (candidate) => (
      candidate.id !== entity.id &&
      candidate.health > 0 &&
      candidate.factionId !== 'neutral' &&
      candidate.factionId !== entity.factionId &&
      distance2d(entity.transform, candidate.transform) <= detectionRange
  ))
}

const findNearestGuardEnemy = (entity: WorldEntity, entities: WorldEntity[], guardPoint: Point) => {
  if (entity.factionId === 'neutral') return undefined
  return findNearestEntity(entity, entities, (candidate) => (
    candidate.id !== entity.id
    && candidate.health > 0
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
    (entity.factionId === 'neutral' || candidate.factionId === 'neutral' || candidate.factionId === entity.factionId)
  ),
)

const nextSocialDecisionDelay = (entityId: string, elapsedSeconds: number) => {
  const key = `${entityId}:${Math.floor(elapsedSeconds)}`
  const hash = [...key].reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261)
  return 7 + (hash % 6)
}

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
) => {
  const definition = worldEntityDefinitionById.get(entity.definitionId)
  if (!definition) return { entity: { ...entity, behaviorState: 'blocked' as const }, arrived: false }
  const targetChanged = entity.navigation.target?.kind !== target.kind || entity.navigation.target?.id !== target.id
  let path = targetChanged ? [] : entity.navigation.path
  let pathIndex = targetChanged ? 0 : entity.navigation.pathIndex
  if (path.length === 0 || pathIndex >= path.length) {
    path = findWorldPath(entity.transform, targetPoint, createObstacleTest(bricks, entity, entityOccupancy))
    pathIndex = 0
  }
  const destination = path[pathIndex] ?? targetPoint
  const dx = destination.x - entity.transform.x
  const dz = destination.z - entity.transform.z
  const distance = Math.hypot(dx, dz)
  if (distance <= arrivalDistanceStuds && pathIndex >= path.length - 1) {
    return {
      entity: {
        ...entity,
        behaviorState: 'idle' as const,
        navigation: { status: 'idle' as const, target, path, pathIndex },
      },
      arrived: true,
    }
  }
  if (path.length === 0 && distance > arrivalDistanceStuds) {
    return {
      entity: {
        ...entity,
        behaviorState: 'blocked' as const,
        navigation: { status: 'blocked' as const, target, path: [], pathIndex: 0 },
      },
      arrived: false,
    }
  }

  const step = Math.min(distance, definition.movement.speedStudsPerSecond * deltaSeconds)
  const nextPathIndex = distance <= step + 0.001 ? Math.min(path.length, pathIndex + 1) : pathIndex
  const nextPoint = {
    x: entity.transform.x + dx / Math.max(distance, 0.0001) * step,
    z: entity.transform.z + dz / Math.max(distance, 0.0001) * step,
  }
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
        navigation: { status: 'blocked' as const, target, path: [], pathIndex: 0 },
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
        rotationRadians: turnEntityToward(
          entity,
          destination,
          definition.movement.turningRadiansPerSecond,
          deltaSeconds,
        ),
      },
      navigation: { status: 'moving' as const, target, path, pathIndex: nextPathIndex },
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
): WorldEvent => ({
  id: `event-${Math.round(timeSeconds * 1000)}-${actorId}-${type}`,
  timeSeconds,
  type,
  actorId,
  targetId,
  amount,
})

const commandTarget = (command: WorldEntityCommand) => 'target' in command ? command.target : undefined

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
  impactAtSeconds: timeSeconds + getWorldProjectileFlightSeconds(
    projectileKind,
    distance2d(actor.transform, targetPoint),
  ),
})

export const stepWorldSimulation = (
  world: WorldState,
  bricks: PlacedBrick[],
  deltaSeconds = worldSimulationStepSeconds,
  structures: BrickStructure[] = [],
): WorldState => {
  if (world.paused || world.entities.length === 0 || deltaSeconds <= 0) return world
  const timeSeconds = world.elapsedSeconds + deltaSeconds
  const entities = resolveOverlappingWorldEntities(world.entities).map((entity) => ({
    ...entity,
    combat: {
      cooldownRemainingSeconds: Math.max(0, entity.combat.cooldownRemainingSeconds - deltaSeconds),
    },
  }))
  const targetLookup: WorldTargetLookup = {
    entityIndexById: new Map(entities.map((entity, index) => [entity.id, index])),
    brickById: new Map(bricks.map((brick) => [brick.id, brick])),
    structureById: new Map(structures.map((structure) => [structure.id, structure])),
    structurePointById: new Map(),
  }
  const hasLineOfSight = createWorldLineOfSightTest(bricks)
  const entityOccupancy = createWorldEntityOccupancyIndex(entities)
  const events: WorldEvent[] = []
  const pendingImpacts = world.pendingImpacts.filter((impact) => impact.impactAtSeconds > timeSeconds)
  const dueImpacts = world.pendingImpacts.filter((impact) => impact.impactAtSeconds <= timeSeconds)

  for (const impact of dueImpacts) {
    const actorIndex = targetLookup.entityIndexById.get(impact.actorId)
    if (actorIndex === undefined) continue
    if (impact.target.kind === 'entity') {
      const targetIndex = targetLookup.entityIndexById.get(impact.target.id)
      if (targetIndex === undefined || entities[targetIndex].health <= 0) continue
      const victim = entities[targetIndex]
      const nextHealth = Math.max(0, victim.health - impact.damage)
      entities[targetIndex] = nextHealth <= 0
        ? {
            ...victim,
            health: 0,
            activeCommand: undefined,
            commandQueue: [],
            behaviorState: 'dead',
            navigation: { status: 'idle', path: [], pathIndex: 0 },
          }
        : { ...victim, health: nextHealth }
      events.push(makeEvent(timeSeconds, 'damage', impact.actorId, victim.id, impact.damage))
      if (nextHealth <= 0) {
        events.push(makeEvent(timeSeconds, 'defeated', impact.actorId, victim.id))
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
        behaviorState: 'dead',
        navigation: { status: 'idle', path: [], pathIndex: 0 },
      }
      continue
    }
    let activeCommand = entity.activeCommand
    let commandQueue = entity.commandQueue
    if (!activeCommand && commandQueue.length > 0) {
      activeCommand = commandQueue[0]
      commandQueue = commandQueue.slice(1)
    }
    if (!activeCommand && entity.controller === 'rule') {
      const enemy = findNearestEnemy(entity, entities)
      if (enemy) {
        activeCommand = { type: 'attack', target: { kind: 'entity', id: enemy.id } }
      } else if (timeSeconds >= entity.autonomy.nextDecisionAtSeconds) {
        const socialTarget = findNearestSocialTarget(entity, entities)
        entity = {
          ...entity,
          autonomy: { nextDecisionAtSeconds: timeSeconds + nextSocialDecisionDelay(entity.id, timeSeconds) },
        }
        if (socialTarget) activeCommand = { type: 'interact', target: { kind: 'entity', id: socialTarget.id } }
      }
    }
    entity = { ...entity, activeCommand, commandQueue }
    if (!activeCommand || activeCommand.type === 'stop') {
      entities[index] = { ...entity, activeCommand: undefined, behaviorState: 'idle' }
      continue
    }

    const assignedTarget = commandTarget(activeCommand)
    if (!assignedTarget) {
      entities[index] = entity
      continue
    }
    const assignedTargetPoint = getTargetPoint(assignedTarget, entities, targetLookup)
    if (!assignedTargetPoint) {
      entities[index] = { ...entity, activeCommand: undefined, behaviorState: 'idle' }
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
    const targetDistance = distance2d(entity.transform, targetPoint)
    const isAttack = activeCommand.type === 'attack' || Boolean(guardEnemy)
    const targetEntityIndex = target.kind === 'entity' ? targetLookup.entityIndexById.get(target.id) : undefined
    const targetEntity = targetEntityIndex === undefined ? undefined : entities[targetEntityIndex]
    const isInteractionInReach = activeCommand.type === 'interact'
      && targetEntity
      && targetDistance <= (
        getWorldEntityCollisionRadius(entity)
        + getWorldEntityCollisionRadius(targetEntity)
        + arrivalDistanceStuds
      )
    if (isInteractionInReach) {
      events.push(makeEvent(timeSeconds, 'interaction', entity.id, target.id))
      entities[index] = { ...entity, activeCommand: undefined, behaviorState: 'idle' }
      continue
    }
    const minimumRangeStuds = definition?.combat.minimumRangeStuds ?? 0
    if (isAttack && targetEntity && minimumRangeStuds > 0 && targetDistance < minimumRangeStuds) {
      const retreatTarget: WorldTargetRef = { kind: 'waypoint', id: `retreat:${target.id}` }
      const retreat = moveEntityToward(
        entity,
        retreatTarget,
        getRetreatPoint(entity, targetPoint, minimumRangeStuds),
        bricks,
        entityOccupancy,
        deltaSeconds,
      )
      if (retreat.entity.behaviorState !== 'blocked') {
        entities[index] = retreat.entity
        updateWorldEntityOccupancy(entityOccupancy, retreat.entity)
        continue
      }
    }
    const hasAttackLineOfSight = definition?.combat.projectileKind !== 'arrow' || !targetEntity || hasLineOfSight(entity, targetEntity)
    if (isAttack && definition && targetDistance <= definition.combat.attackRangeStuds && hasAttackLineOfSight) {
      entity = {
        ...entity,
        behaviorState: 'attacking',
        transform: {
          ...entity.transform,
          rotationRadians: turnEntityToward(
            entity,
            targetPoint,
            definition.movement.turningRadiansPerSecond,
            deltaSeconds,
          ),
        },
      }
      if (entity.combat.cooldownRemainingSeconds <= 0) {
        entity = {
          ...entity,
          combat: { cooldownRemainingSeconds: definition.combat.cooldownSeconds },
        }
        events.push(makeEvent(timeSeconds, 'attack', entity.id, target.id, definition.combat.damage))
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
            const victim = entities[targetIndex]
            const nextHealth = Math.max(0, victim.health - definition.combat.damage)
            entities[targetIndex] = nextHealth <= 0
              ? {
                  ...victim,
                  health: 0,
                  activeCommand: undefined,
                  commandQueue: [],
                  behaviorState: 'dead',
                  navigation: { status: 'idle', path: [], pathIndex: 0 },
                }
              : { ...victim, health: nextHealth }
            events.push(makeEvent(timeSeconds, 'damage', entity.id, victim.id, definition.combat.damage))
            if (nextHealth <= 0) {
              events.push(makeEvent(timeSeconds, 'defeated', entity.id, victim.id))
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

    const movement = moveEntityToward(entity, target, targetPoint, bricks, entityOccupancy, deltaSeconds)
    entity = movement.entity
    if (movement.arrived && !isAttack) {
      if (activeCommand.type === 'follow') {
        entity = { ...entity, behaviorState: 'following' }
      } else if (activeCommand.type === 'guard') {
        entity = { ...entity, behaviorState: 'guarding' }
      } else {
        events.push(makeEvent(
          timeSeconds,
          activeCommand.type === 'interact' && target.kind === 'entity' ? 'interaction' : 'command-complete',
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
  return {
    ...world,
    elapsedSeconds: timeSeconds,
    entities,
    events: [...world.events, ...enrichedEvents].slice(-maxEventHistory),
    pendingImpacts,
    narrative: ingestWorldEvents(world.narrative, [...pendingExistingEvents, ...enrichedEvents], new Set(entities.map((entity) => entity.id))),
  }
}
