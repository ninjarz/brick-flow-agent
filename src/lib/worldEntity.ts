import type {
  WorldEntity,
  WorldEntityCommand,
  WorldEntityControllerKind,
  WorldEntityDefinition,
  WorldEntityTransform,
  WorldState,
  WorldTargetRef,
} from '../types/world'

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

  return {
    id: options.id ?? createWorldEntityId(),
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

export const parseStoredWorldState = (value: unknown, planId: string) => {
  if (!isRecord(value) || value.planId !== planId || !Array.isArray(value.entities)) return undefined
  const storedEntities = value.entities.filter((entity): entity is WorldEntity => (
    isRecord(entity) &&
    typeof entity.id === 'string' &&
    typeof entity.definitionId === 'string' &&
    typeof entity.name === 'string' &&
    entity.name.trim().length > 0 &&
    typeof entity.transform === 'object' &&
    entity.transform !== null &&
    Array.isArray(entity.commandQueue)
  ))
  if (storedEntities.length !== value.entities.length) return undefined
  const entities = storedEntities.map((entity) => ({
    ...entity,
    behaviorState: entity.behaviorState ?? 'idle',
    combat: entity.combat ?? { cooldownRemainingSeconds: 0 },
  }))

  return {
    id: typeof value.id === 'string' ? value.id : `world-${planId}`,
    planId,
    randomSeed: typeof value.randomSeed === 'number' ? value.randomSeed : 1,
    elapsedSeconds: typeof value.elapsedSeconds === 'number' ? value.elapsedSeconds : 0,
    paused: typeof value.paused === 'boolean' ? value.paused : false,
    entities,
    events: Array.isArray(value.events) ? value.events as WorldState['events'] : [],
    pendingImpacts: Array.isArray(value.pendingImpacts) ? value.pendingImpacts as WorldState['pendingImpacts'] : [],
    narrative: isRecord(value.narrative)
      ? {
          processedEventIds: Array.isArray(value.narrative.processedEventIds) ? value.narrative.processedEventIds as string[] : [],
          memoriesByEntityId: isRecord(value.narrative.memoriesByEntityId)
            ? value.narrative.memoriesByEntityId as WorldState['narrative']['memoriesByEntityId']
            : {},
          relationshipsByEntityId: isRecord(value.narrative.relationshipsByEntityId)
            ? value.narrative.relationshipsByEntityId as WorldState['narrative']['relationshipsByEntityId']
            : {},
          stories: Array.isArray(value.narrative.stories) ? value.narrative.stories as WorldState['narrative']['stories'] : [],
        }
      : { processedEventIds: [], memoriesByEntityId: {}, relationshipsByEntityId: {}, stories: [] },
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
