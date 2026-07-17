import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import type { BrickStructure, PlacedBrick } from '../types/bricks'
import type { WorldEntity, WorldEntityCommand, WorldEvent, WorldState, WorldTargetRef } from '../types/world'
import { getBrickBounds } from './planUtils'
import { ingestWorldEvents } from './worldNarrative'

export const worldSimulationStepSeconds = 0.1
const navigationGridStuds = 0.5
const navigationMarginStuds = 8
const maxNavigationNodes = 3_000
const maxEventHistory = 500
const arrivalDistanceStuds = 0.35

type Point = { x: number; y: number; z: number }
type GridNode = { x: number; z: number }

const distance2d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)
const gridKey = (node: GridNode) => `${node.x}:${node.z}`
const toGrid = (value: number) => Math.round(value / navigationGridStuds)
const fromGrid = (value: number) => value * navigationGridStuds
const getBodyRadius = (entity: WorldEntity) => {
  const body = worldEntityDefinitionById.get(entity.definitionId)?.body
  return body?.shape === 'capsule'
    ? body.radiusStuds
    : body ? Math.hypot(body.widthStuds, body.depthStuds) * 0.28 : 0.7
}

const createObstacleTest = (bricks: PlacedBrick[], entity: WorldEntity) => {
  const definition = worldEntityDefinitionById.get(entity.definitionId)
  const bodyHeight = definition?.body.heightStuds ?? 5
  const radius = getBodyRadius(entity)
  const bounds = bricks.map(getBrickBounds).filter((item) => Boolean(item))
  return (x: number, z: number) => bounds.some((item) => (
    item!.minY < bodyHeight - 0.01 &&
    item!.maxY > 0.05 &&
    x > item!.minX - radius &&
    x < item!.maxX + radius &&
    z > item!.minZ - radius &&
    z < item!.maxZ + radius
  ))
}

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

export const findWorldPath = (
  start: Point,
  goal: Point,
  isBlocked: (x: number, z: number) => boolean,
) => {
  const startNode = { x: toGrid(start.x), z: toGrid(start.z) }
  let goalNode = { x: toGrid(goal.x), z: toGrid(goal.z) }
  if (isBlocked(fromGrid(goalNode.x), fromGrid(goalNode.z))) {
    const openGoal = [1, 2, 3, 4].flatMap((radius) => [
      { x: goalNode.x + radius, z: goalNode.z },
      { x: goalNode.x - radius, z: goalNode.z },
      { x: goalNode.x, z: goalNode.z + radius },
      { x: goalNode.x, z: goalNode.z - radius },
    ]).find((node) => !isBlocked(fromGrid(node.x), fromGrid(node.z)))
    if (!openGoal) return []
    goalNode = openGoal
  }

  const minX = Math.min(startNode.x, goalNode.x) - Math.ceil(navigationMarginStuds / navigationGridStuds)
  const maxX = Math.max(startNode.x, goalNode.x) + Math.ceil(navigationMarginStuds / navigationGridStuds)
  const minZ = Math.min(startNode.z, goalNode.z) - Math.ceil(navigationMarginStuds / navigationGridStuds)
  const maxZ = Math.max(startNode.z, goalNode.z) + Math.ceil(navigationMarginStuds / navigationGridStuds)
  const startKey = gridKey(startNode)
  const goalKey = gridKey(goalNode)
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
  bricks: PlacedBrick[],
  structures: BrickStructure[],
): Point | undefined => {
  if (target.kind === 'entity') {
    const entity = entities.find((candidate) => candidate.id === target.id && candidate.health > 0)
    return entity ? entity.transform : undefined
  }
  if (target.kind === 'brick') {
    const brick = bricks.find((candidate) => candidate.id === target.id)
    const bounds = brick ? getBrickBounds(brick) : undefined
    return bounds ? {
      x: (bounds.minX + bounds.maxX) / 2,
      y: bounds.minY,
      z: (bounds.minZ + bounds.maxZ) / 2,
    } : undefined
  }
  if (target.kind === 'structure') {
    const structure = structures.find((candidate) => candidate.id === target.id)
    const structureBrickIds = new Set(structure?.brickIds ?? [])
    const bounds = bricks
      .filter((brick) => structureBrickIds.has(brick.id))
      .map(getBrickBounds)
      .filter((item) => Boolean(item))
    return bounds.length > 0 ? {
      x: (Math.min(...bounds.map((item) => item!.minX)) + Math.max(...bounds.map((item) => item!.maxX))) / 2,
      y: Math.min(...bounds.map((item) => item!.minY)),
      z: (Math.min(...bounds.map((item) => item!.minZ)) + Math.max(...bounds.map((item) => item!.maxZ))) / 2,
    } : undefined
  }
  return undefined
}

const findNearestEnemy = (entity: WorldEntity, entities: WorldEntity[]) => {
  if (entity.factionId === 'neutral') return undefined
  return entities
    .filter((candidate) => (
      candidate.id !== entity.id &&
      candidate.health > 0 &&
      candidate.factionId !== 'neutral' &&
      candidate.factionId !== entity.factionId
    ))
    .sort((a, b) => distance2d(entity.transform, a.transform) - distance2d(entity.transform, b.transform))[0]
}

const moveEntityToward = (
  entity: WorldEntity,
  target: WorldTargetRef,
  targetPoint: Point,
  bricks: PlacedBrick[],
  deltaSeconds: number,
) => {
  const definition = worldEntityDefinitionById.get(entity.definitionId)
  if (!definition) return { entity: { ...entity, behaviorState: 'blocked' as const }, arrived: false }
  const targetChanged = entity.navigation.target?.kind !== target.kind || entity.navigation.target?.id !== target.id
  let path = targetChanged ? [] : entity.navigation.path
  let pathIndex = targetChanged ? 0 : entity.navigation.pathIndex
  if (path.length === 0 || pathIndex >= path.length) {
    path = findWorldPath(entity.transform, targetPoint, createObstacleTest(bricks, entity))
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
  return {
    entity: {
      ...entity,
      behaviorState: 'moving' as const,
      transform: {
        ...entity.transform,
        x: entity.transform.x + dx / Math.max(distance, 0.0001) * step,
        z: entity.transform.z + dz / Math.max(distance, 0.0001) * step,
        rotationRadians: Math.atan2(dx, dz),
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

export const stepWorldSimulation = (
  world: WorldState,
  bricks: PlacedBrick[],
  deltaSeconds = worldSimulationStepSeconds,
  structures: BrickStructure[] = [],
): WorldState => {
  if (world.paused || world.entities.length === 0 || deltaSeconds <= 0) return world
  const timeSeconds = world.elapsedSeconds + deltaSeconds
  const entities = world.entities.map((entity) => ({
    ...entity,
    combat: {
      cooldownRemainingSeconds: Math.max(0, entity.combat.cooldownRemainingSeconds - deltaSeconds),
    },
  }))
  const events: WorldEvent[] = []

  for (let index = 0; index < entities.length; index += 1) {
    let entity = entities[index]
    if (entity.health <= 0) {
      entities[index] = { ...entity, behaviorState: 'dead' }
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
      if (enemy) activeCommand = { type: 'attack', target: { kind: 'entity', id: enemy.id } }
    }
    entity = { ...entity, activeCommand, commandQueue }
    if (!activeCommand || activeCommand.type === 'stop') {
      entities[index] = { ...entity, activeCommand: undefined, behaviorState: 'idle' }
      continue
    }

    const target = commandTarget(activeCommand)
    if (!target) {
      entities[index] = entity
      continue
    }
    const targetPoint = getTargetPoint(target, entities, bricks, structures)
    if (!targetPoint) {
      entities[index] = { ...entity, activeCommand: undefined, behaviorState: 'idle' }
      continue
    }
    const definition = worldEntityDefinitionById.get(entity.definitionId)
    const targetDistance = distance2d(entity.transform, targetPoint)
    const isAttack = activeCommand.type === 'attack'
    if (isAttack && definition && targetDistance <= definition.combat.attackRangeStuds) {
      entity = { ...entity, behaviorState: 'attacking' }
      if (entity.combat.cooldownRemainingSeconds <= 0) {
        entity = {
          ...entity,
          combat: { cooldownRemainingSeconds: definition.combat.cooldownSeconds },
        }
        events.push(makeEvent(timeSeconds, 'attack', entity.id, target.id, definition.combat.damage))
        if (target.kind === 'entity') {
          const targetIndex = entities.findIndex((candidate) => candidate.id === target.id)
          if (targetIndex >= 0) {
            const victim = entities[targetIndex]
            const nextHealth = Math.max(0, victim.health - definition.combat.damage)
            entities[targetIndex] = { ...victim, health: nextHealth, behaviorState: nextHealth <= 0 ? 'dead' : victim.behaviorState }
            events.push(makeEvent(timeSeconds, 'damage', entity.id, victim.id, definition.combat.damage))
            if (nextHealth <= 0) {
              events.push(makeEvent(timeSeconds, 'defeated', entity.id, victim.id))
              entity = { ...entity, activeCommand: undefined }
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

    const movement = moveEntityToward(entity, target, targetPoint, bricks, deltaSeconds)
    entity = movement.entity
    if (movement.arrived && !isAttack && activeCommand.type !== 'follow') {
      events.push(makeEvent(timeSeconds, 'command-complete', entity.id, target.id))
      entity = { ...entity, activeCommand: undefined }
    }
    entities[index] = entity
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
    narrative: ingestWorldEvents(world.narrative, [...pendingExistingEvents, ...enrichedEvents], new Set(entities.map((entity) => entity.id))),
  }
}
