import type {
  WorldEntity,
  WorldEntityCommand,
  WorldEntityControllerKind,
  WorldEntityDefinition,
  WorldEntityTransform,
  WorldState,
  WorldTargetRef,
} from '../types/world'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'

const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ')
const comparableName = (value: string) => normalizeName(value).toLocaleLowerCase()

const makeUniqueName = (baseName: string, existingNames: Iterable<string>) => {
  const normalizedBase = normalizeName(baseName) || '未命名单位'
  const usedNames = new Set([...existingNames].map(comparableName))
  if (!usedNames.has(comparableName(normalizedBase))) return normalizedBase

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${normalizedBase} ${suffix}`
    if (!usedNames.has(comparableName(candidate))) return candidate
  }

  return `${normalizedBase} ${Date.now().toString(36)}`
}

export const generateWorldEntityName = (
  definition: WorldEntityDefinition,
  existingNames: Iterable<string> = [],
  random: () => number = Math.random,
) => {
  const candidates = definition.nameCandidates.map(normalizeName).filter(Boolean)
  const fallbackCandidates = candidates.length > 0 ? candidates : [definition.displayName]
  const randomValue = Math.min(0.999999, Math.max(0, random()))
  const startIndex = Math.floor(randomValue * fallbackCandidates.length)
  const usedNames = new Set([...existingNames].map(comparableName))

  for (let offset = 0; offset < fallbackCandidates.length; offset += 1) {
    const candidate = fallbackCandidates[(startIndex + offset) % fallbackCandidates.length]
    if (!usedNames.has(comparableName(candidate))) return candidate
  }

  return makeUniqueName(fallbackCandidates[startIndex], existingNames)
}

const createWorldEntityId = () => `entity-${Math.random().toString(36).slice(2, 9)}`

const stableEntityNumber = (value: string) => [...value].reduce((hash, character) => (
  Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0
), 2166136261)

export const createWorldEntity = (
  definition: WorldEntityDefinition,
  options: {
    id?: string
    name?: string
    description?: string
    factionId?: string
    controller?: WorldEntity['controller']
    transform?: Partial<WorldEntityTransform>
    existingNames?: Iterable<string>
    random?: () => number
  } = {},
): WorldEntity => {
  const generatedName = options.name
    ? makeUniqueName(options.name, options.existingNames ?? [])
    : generateWorldEntityName(definition, options.existingNames, options.random)

  const id = options.id ?? createWorldEntityId()
  return {
    id,
    definitionId: definition.id,
    kind: definition.kind,
    name: generatedName,
    description: normalizeName(options.description ?? definition.description),
    factionId: normalizeName(options.factionId ?? 'neutral'),
    controller: options.controller ?? 'rule',
    health: definition.combat.maxHealth,
    maxHealth: definition.combat.maxHealth,
    transform: {
      x: options.transform?.x ?? 0,
      y: options.transform?.y ?? 0,
      z: options.transform?.z ?? 0,
      rotationRadians: options.transform?.rotationRadians ?? 0,
    },
    commandQueue: [],
    navigation: {
      status: 'idle',
      path: [],
      pathIndex: 0,
    },
    behaviorState: 'idle',
    combat: { cooldownRemainingSeconds: 0 },
    autonomy: { nextDecisionAtSeconds: 2 + (stableEntityNumber(id) % 5) },
  }
}

export const createEmptyWorldState = (planId: string): WorldState => ({
  id: `world-${Math.random().toString(36).slice(2, 9)}`,
  planId,
  randomSeed: Math.floor(Math.random() * 0x7fffffff),
  elapsedSeconds: 0,
  paused: false,
  entities: [],
  events: [],
  pendingImpacts: [],
  narrative: {
    processedEventIds: [],
    memoriesByEntityId: {},
    relationshipsByEntityId: {},
    stories: [],
  },
})

export const changeWorldEntityController = (
  entity: WorldEntity,
  controller: WorldEntityControllerKind,
): WorldEntity => entity.controller === controller ? entity : {
  ...entity,
  controller,
  commandQueue: [],
  activeCommand: undefined,
  behaviorState: entity.health > 0 ? 'idle' : 'dead',
  navigation: { status: 'idle', path: [], pathIndex: 0 },
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isController = (value: unknown): value is WorldEntityControllerKind =>
  value === 'rule' || value === 'player' || value === 'ai'

const parseTargetRef = (value: unknown): WorldTargetRef | undefined => {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return undefined
  if (!['entity', 'brick', 'structure', 'waypoint'].includes(String(value.kind))) return undefined
  return { kind: value.kind as WorldTargetRef['kind'], id: value.id.trim() } as WorldTargetRef
}

const parseStoredCommand = (value: unknown): WorldEntityCommand | undefined => {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'stop') return { type: 'stop' }
  if (value.type === 'patrol' && Array.isArray(value.waypointIds)) {
    const waypointIds = value.waypointIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map((id) => id.trim()).slice(0, 32)
    return waypointIds.length > 0 ? { type: 'patrol', waypointIds } : undefined
  }
  const target = parseTargetRef(value.target)
  if (!target || !['move', 'attack', 'guard', 'follow', 'interact'].includes(value.type)) return undefined
  if (value.type === 'attack' && !['entity', 'brick', 'structure'].includes(target.kind)) return undefined
  if (value.type === 'follow' && target.kind !== 'entity') return undefined
  return { type: value.type, target } as WorldEntityCommand
}

const parseStoredEntity = (value: unknown): WorldEntity | undefined => {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return undefined
  if (typeof value.definitionId !== 'string' || typeof value.name !== 'string' || !value.name.trim()) return undefined
  const definition = worldEntityDefinitionById.get(value.definitionId)
  if (!definition || !isRecord(value.transform)) return undefined
  if (!isFiniteNumber(value.transform.x) || !isFiniteNumber(value.transform.y) || !isFiniteNumber(value.transform.z)) return undefined
  if (!isFiniteNumber(value.transform.rotationRadians)) return undefined
  const entity = createWorldEntity(definition, {
    id: value.id.trim(),
    name: value.name,
    description: typeof value.description === 'string' ? value.description : definition.description,
    factionId: typeof value.factionId === 'string' ? value.factionId.slice(0, 80) : 'neutral',
    controller: isController(value.controller) ? value.controller : 'rule',
    transform: value.transform,
  })
  const health = isFiniteNumber(value.health) ? Math.max(0, Math.min(definition.combat.maxHealth, value.health)) : definition.combat.maxHealth
  const behaviorStates: WorldEntity['behaviorState'][] = ['idle', 'moving', 'attacking', 'blocked', 'dead']
  const behaviorState = health <= 0
    ? 'dead'
    : behaviorStates.includes(value.behaviorState as WorldEntity['behaviorState']) ? value.behaviorState as WorldEntity['behaviorState'] : 'idle'
  const commandQueue = Array.isArray(value.commandQueue)
    ? value.commandQueue.map(parseStoredCommand).filter((command): command is WorldEntityCommand => Boolean(command)).slice(0, 20)
    : []
  const activeCommand = parseStoredCommand(value.activeCommand)
  return {
    ...entity,
    health,
    commandQueue,
    ...(activeCommand ? { activeCommand } : {}),
    navigation: { status: 'idle', path: [], pathIndex: 0 },
    behaviorState,
    combat: {
      cooldownRemainingSeconds: isRecord(value.combat) && isFiniteNumber(value.combat.cooldownRemainingSeconds)
        ? Math.max(0, value.combat.cooldownRemainingSeconds)
        : 0,
    },
    autonomy: {
      nextDecisionAtSeconds: isRecord(value.autonomy) && isFiniteNumber(value.autonomy.nextDecisionAtSeconds)
        ? Math.max(0, value.autonomy.nextDecisionAtSeconds)
        : 2 + (stableEntityNumber(entity.id) % 5),
    },
  }
}

const eventTypes = new Set<WorldState['events'][number]['type']>([
  'attack', 'damage', 'defeated', 'brick-hit', 'structure-hit', 'interaction', 'command-issued', 'command-complete',
])

const parseStoredEvents = (value: unknown): WorldState['events'] => Array.isArray(value)
  ? value.filter((event): event is WorldState['events'][number] => (
      isRecord(event) && typeof event.id === 'string' && isFiniteNumber(event.timeSeconds) &&
      eventTypes.has(event.type as WorldState['events'][number]['type']) && typeof event.actorId === 'string'
    )).slice(-500)
  : []

const normalizeArrayRecord = <T>(value: unknown, predicate: (item: unknown) => item is T) => {
  if (!isRecord(value)) return {} as Record<string, T[]>
  return Object.fromEntries(Object.entries(value).map(([key, items]) => [
    key,
    Array.isArray(items) ? items.filter(predicate).slice(-80) : [],
  ]))
}

const isStoredMemory = (value: unknown): value is WorldState['narrative']['memoriesByEntityId'][string][number] =>
  isRecord(value) && typeof value.id === 'string' && typeof value.eventId === 'string' &&
  typeof value.entityId === 'string' && isFiniteNumber(value.timeSeconds) && eventTypes.has(value.type as never) &&
  [1, 2, 3].includes(Number(value.importance))

const isStoredStory = (value: unknown): value is WorldState['narrative']['stories'][number] =>
  isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string' && typeof value.body === 'string' &&
  isFiniteNumber(value.createdAtSeconds) && Array.isArray(value.eventIds) && (value.source === 'local' || value.source === 'ai')

const normalizeRelationships = (value: unknown): WorldState['narrative']['relationshipsByEntityId'] => {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([observerId, targets]) => {
    if (!isRecord(targets)) return [observerId, {}]
    const normalizedTargets = Object.fromEntries(Object.entries(targets).flatMap(([targetId, relationship]) => {
      if (!isRecord(relationship) || !isFiniteNumber(relationship.affinity) || !isFiniteNumber(relationship.encounters)) return []
      if (!eventTypes.has(relationship.lastEventType as WorldState['events'][number]['type'])) return []
      return [[targetId, {
        targetEntityId: typeof relationship.targetEntityId === 'string' ? relationship.targetEntityId : targetId,
        affinity: Math.max(-100, Math.min(100, relationship.affinity)),
        encounters: Math.max(0, Math.floor(relationship.encounters)),
        lastEventType: relationship.lastEventType as WorldState['events'][number]['type'],
        updatedAtSeconds: isFiniteNumber(relationship.updatedAtSeconds) ? Math.max(0, relationship.updatedAtSeconds) : 0,
      }]]
    }))
    return [observerId, normalizedTargets]
  }))
}

export const parseStoredWorldState = (value: unknown, planId: string) => {
  if (!isRecord(value) || value.planId !== planId || !Array.isArray(value.entities)) return undefined
  const entities = value.entities.map(parseStoredEntity)
  if (entities.some((entity) => !entity)) return undefined
  const safeEntities = entities as WorldEntity[]
  const entityIds = new Set(safeEntities.map((entity) => entity.id))
  const events = parseStoredEvents(value.events)
  const pendingImpacts = Array.isArray(value.pendingImpacts) ? value.pendingImpacts.filter((impact): impact is WorldState['pendingImpacts'][number] => (
    isRecord(impact) && typeof impact.id === 'string' && typeof impact.actorId === 'string' && entityIds.has(impact.actorId) &&
    Boolean(parseTargetRef(impact.target)) && isRecord(impact.target) && ['entity', 'brick', 'structure'].includes(String(impact.target.kind)) &&
    isFiniteNumber(impact.damage) && impact.damage > 0 &&
    (impact.projectileKind === 'arrow' || impact.projectileKind === 'stone') && isFiniteNumber(impact.impactAtSeconds)
  )).slice(-100) : []
  const narrative = isRecord(value.narrative) ? value.narrative : {}

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `world-${planId}`,
    planId,
    randomSeed: isFiniteNumber(value.randomSeed) ? Math.floor(value.randomSeed) : 1,
    elapsedSeconds: isFiniteNumber(value.elapsedSeconds) ? Math.max(0, value.elapsedSeconds) : 0,
    paused: typeof value.paused === 'boolean' ? value.paused : false,
    entities: safeEntities,
    events,
    pendingImpacts,
    narrative: {
      processedEventIds: Array.isArray(narrative.processedEventIds)
        ? narrative.processedEventIds.filter((id): id is string => typeof id === 'string').slice(-1_000)
        : [],
      memoriesByEntityId: normalizeArrayRecord(narrative.memoriesByEntityId, isStoredMemory),
      relationshipsByEntityId: normalizeRelationships(narrative.relationshipsByEntityId),
      stories: Array.isArray(narrative.stories) ? narrative.stories.filter(isStoredStory).slice(-80) : [],
    },
  } satisfies WorldState
}

const getCommandTargets = (command: WorldEntityCommand): WorldTargetRef[] => {
  if ('target' in command) return [command.target]
  if (command.type === 'patrol') return command.waypointIds.map((id) => ({ kind: 'waypoint', id }))
  return []
}

export type WorldCommandIssue =
  | 'ENTITY_NOT_FOUND'
  | 'EMPTY_TARGET_ID'
  | 'SELF_TARGET'
  | 'TARGET_NOT_FOUND'
  | 'EMPTY_PATROL_ROUTE'

export type WorldCommandResult =
  | { ok: true; world: WorldState }
  | { ok: false; world: WorldState; issue: WorldCommandIssue }

export const issueWorldEntityCommand = (
  world: WorldState,
  entityId: string,
  command: WorldEntityCommand,
  targetExists: (target: WorldTargetRef) => boolean = (target) => (
    target.kind === 'entity' && world.entities.some((entity) => entity.id === target.id)
  ),
  queueMode: 'append' | 'replace' = 'append',
): WorldCommandResult => {
  const entity = world.entities.find((candidate) => candidate.id === entityId)
  if (!entity) return { ok: false, world, issue: 'ENTITY_NOT_FOUND' }
  if (command.type === 'patrol' && command.waypointIds.length === 0) {
    return { ok: false, world, issue: 'EMPTY_PATROL_ROUTE' }
  }

  for (const target of getCommandTargets(command)) {
    if (!normalizeName(target.id)) return { ok: false, world, issue: 'EMPTY_TARGET_ID' }
    if (target.kind === 'entity' && target.id === entityId) {
      return { ok: false, world, issue: 'SELF_TARGET' }
    }
    if (!targetExists(target)) return { ok: false, world, issue: 'TARGET_NOT_FOUND' }
  }

  const target = getCommandTargets(command)[0]
  const targetEntity = target?.kind === 'entity'
    ? world.entities.find((candidate) => candidate.id === target.id)
    : undefined
  const commandEvent = {
    id: `event-command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    timeSeconds: world.elapsedSeconds,
    type: 'command-issued' as const,
    actorId: entity.id,
    actorName: entity.name,
    targetId: target?.id,
    targetName: targetEntity?.name ?? target?.id,
    commandType: command.type,
    commandSource: entity.controller,
  }

  return {
    ok: true,
    world: {
      ...world,
      entities: world.entities.map((candidate) => candidate.id === entityId
        ? queueMode === 'replace'
          ? {
              ...candidate,
              activeCommand: undefined,
              commandQueue: [command],
              behaviorState: candidate.health > 0 ? 'idle' : 'dead',
              navigation: { status: 'idle', path: [], pathIndex: 0 },
            }
          : { ...candidate, commandQueue: [...candidate.commandQueue, command] }
        : candidate),
      events: [...world.events, commandEvent].slice(-500),
    },
  }
}
