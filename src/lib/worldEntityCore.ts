import { clampWorldCoordinate } from './worldCoordinates'
import type { WorldEntity, WorldEntityCommand, WorldEntityControllerKind, WorldEntityDefinition, WorldEntityTransform, WorldState, WorldTargetRef } from '../types/world'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createDefaultWorldCharacterSpark, createWorldEntityGoal, updateWorldEntityGoals, worldEntityCommandGoalSummary } from './worldCharacter'

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

export const stableEntityNumber = (value: string) => [...value].reduce((hash, character) => (
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
      x: clampWorldCoordinate(options.transform?.x ?? 0),
      y: clampWorldCoordinate(options.transform?.y ?? 0),
      z: clampWorldCoordinate(options.transform?.z ?? 0),
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
    autonomy: {
      nextDecisionAtSeconds: 2 + (stableEntityNumber(id) % 5),
      home: {
        x: clampWorldCoordinate(options.transform?.x ?? 0),
        z: clampWorldCoordinate(options.transform?.z ?? 0),
      },
    },
    mind: {
      spark: createDefaultWorldCharacterSpark(definition),
      goals: [],
    },
  }
}

export const createEmptyWorldState = (planId: string): WorldState => ({
  id: `world-${Math.random().toString(36).slice(2, 9)}`,
  planId,
  randomSeed: Math.floor(Math.random() * 0x7fffffff),
  elapsedSeconds: 0,
  paused: false,
  entities: [],
  parties: [],
  events: [],
  appliedObjectEventIds: [],
  pendingImpacts: [],
  scenarios: [],
  hiddenTargets: [],
    narrative: {
      processedEventIds: [],
      memoriesByEntityId: {},
      cluesByEntityId: {},
      relationshipsByEntityId: {},
    stories: [],
    directorTurns: [],
  },
})

export const changeWorldEntityController = (
  entity: WorldEntity,
  controller: WorldEntityControllerKind,
): WorldEntity => entity.controller === controller ? entity : updateWorldEntityGoals({
  ...entity,
  controller,
  commandQueue: [],
  activeCommand: undefined,
  behaviorState: entity.health > 0 ? 'idle' : 'dead',
  navigation: { status: 'idle', path: [], pathIndex: 0 },
  autonomy: {
    ...entity.autonomy,
    home: { x: entity.transform.x, z: entity.transform.z },
  },
}, entity.mind.goals.filter((goal) => !goal.commandType))

export const changeAllWorldEntityControllers = (
  world: WorldState,
  controller: WorldEntityControllerKind,
): WorldState => {
  let changed = false
  const entities = world.entities.map((entity) => {
    const nextEntity = changeWorldEntityController(entity, controller)
    if (nextEntity !== entity) changed = true
    return nextEntity
  })
  return changed ? { ...world, entities } : world
}

const reconcileWorldPartyMembership = (
  world: WorldState,
  parties: WorldState['parties'],
): WorldState => {
  const partyIdByEntityId = new Map(parties.flatMap((party) => (
    party.members.map((member) => [member.entityId, party.id] as const)
  )))
  let entitiesChanged = false
  const entities = world.entities.map((entity) => {
    const partyId = partyIdByEntityId.get(entity.id)
    if (partyId === entity.partyId) return entity
    entitiesChanged = true
    return { ...entity, partyId }
  })
  return parties === world.parties && !entitiesChanged ? world : { ...world, parties, entities }
}

export const joinWorldParty = (
  world: WorldState,
  entityId: string,
  leaderId: string,
  options: { partyName?: string; status?: 'active' | 'reserve' } = {},
): WorldState => {
  const entity = world.entities.find((candidate) => candidate.id === entityId)
  const leader = world.entities.find((candidate) => candidate.id === leaderId)
  if (!entity || !leader) return world
  const status = entityId === leaderId ? 'active' : options.status ?? 'active'
  let parties = world.parties
    .map((party) => ({
      ...party,
      members: party.members.filter((member) => member.entityId !== entityId && (
        entityId !== leaderId || member.entityId !== leaderId
      )),
    }))
    .flatMap((party) => {
      if (party.members.length === 0) return []
      const leaderStillPresent = party.members.some((member) => member.entityId === party.leaderId)
      return [{
        ...party,
        leaderId: leaderStillPresent
          ? party.leaderId
          : party.members.find((member) => member.status === 'active')?.entityId ?? party.members[0].entityId,
      }]
    })
  const leaderParty = parties.find((party) => party.members.some((member) => member.entityId === leaderId))
  if (leaderParty) {
    parties = parties.map((party) => party.id === leaderParty.id
      ? {
          ...party,
          name: options.partyName?.trim() || party.name,
          members: [
            ...party.members,
            { entityId, status, joinedAtSeconds: world.elapsedSeconds },
          ],
        }
      : party)
  } else {
    const id = `party-${leaderId}`
    parties = [
      ...parties,
      {
        id,
        name: options.partyName?.trim() || `${leader.name}的小队`,
        leaderId,
        members: [
          { entityId: leaderId, status: 'active' as const, joinedAtSeconds: world.elapsedSeconds },
          ...(entityId === leaderId
            ? []
            : [{ entityId, status, joinedAtSeconds: world.elapsedSeconds }]),
        ],
      },
    ]
  }
  return reconcileWorldPartyMembership(world, parties)
}

export const leaveWorldParty = (
  world: WorldState,
  entityId: string,
): WorldState => {
  if (!world.entities.some((entity) => entity.id === entityId && entity.partyId)) return world
  const parties = world.parties.flatMap((party) => {
    const members = party.members.filter((member) => member.entityId !== entityId)
    if (members.length === 0) return []
    return [{
      ...party,
      members,
      leaderId: party.leaderId === entityId
        ? members.find((member) => member.status === 'active')?.entityId ?? members[0].entityId
        : party.leaderId,
    }]
  })
  return reconcileWorldPartyMembership(world, parties)
}

export const setWorldPartyMemberStatus = (
  world: WorldState,
  partyId: string,
  entityId: string,
  status: 'active' | 'reserve',
): WorldState => {
  const party = world.parties.find((candidate) => candidate.id === partyId)
  if (!party || party.leaderId === entityId) return world
  let changed = false
  const parties = world.parties.map((candidate) => candidate.id === partyId
    ? {
        ...candidate,
        members: candidate.members.map((member) => {
          if (member.entityId !== entityId || member.status === status) return member
          changed = true
          return { ...member, status }
        }),
      }
    : candidate)
  return changed ? { ...world, parties } : world
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
  | 'TARGET_NOT_DEFEATED'
  | 'UNSUPPORTED_COMMAND'
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
  if (command.type === 'revive' && !worldEntityDefinitionById.get(entity.definitionId)?.support) {
    return { ok: false, world, issue: 'UNSUPPORTED_COMMAND' }
  }
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

  if (command.type === 'revive') {
    const reviveTarget = world.entities.find((candidate) => candidate.id === command.target.id)
    if (!reviveTarget || reviveTarget.health > 0) return { ok: false, world, issue: 'TARGET_NOT_DEFEATED' }
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
  const goal = command.type === 'stop'
    ? undefined
    : createWorldEntityGoal(
        worldEntityCommandGoalSummary(command, targetEntity?.name),
        entity.controller === 'player' ? 'player' : 'seed',
        world.elapsedSeconds,
        target,
        command.type,
      )

  return {
    ok: true,
    world: {
      ...world,
      entities: world.entities.map((candidate) => candidate.id === entityId
        ? queueMode === 'replace'
          ? updateWorldEntityGoals({
              ...candidate,
              activeCommand: undefined,
              commandQueue: [command],
              behaviorState: candidate.health > 0 ? 'idle' : 'dead',
              navigation: { status: 'idle', path: [], pathIndex: 0 },
            }, goal ? [goal] : [])
          : updateWorldEntityGoals({
              ...candidate,
              commandQueue: [...candidate.commandQueue, command],
            }, command.type === 'stop'
              ? []
              : !candidate.activeCommand && candidate.commandQueue.length === 0
                ? [goal, ...candidate.mind.goals]
                : [...candidate.mind.goals, goal])
        : candidate),
      events: [...world.events, commandEvent].slice(-500),
    },
  }
}

export const issueWorldPartyOrder = (
  world: WorldState,
  partyId: string,
  order: 'follow-leader' | 'hold',
): WorldState => {
  const party = world.parties.find((candidate) => candidate.id === partyId)
  if (!party) return world
  let nextWorld = world
  for (const member of party.members) {
    if (member.status !== 'active') continue
    const command: WorldEntityCommand = order === 'hold' || member.entityId === party.leaderId
      ? { type: 'stop' }
      : { type: 'follow', target: { kind: 'entity', id: party.leaderId } }
    const result = issueWorldEntityCommand(nextWorld, member.entityId, command, (target) => (
      target.kind === 'entity' && nextWorld.entities.some((entity) => entity.id === target.id)
    ), 'replace')
    if (result.ok) nextWorld = result.world
  }
  return nextWorld
}
