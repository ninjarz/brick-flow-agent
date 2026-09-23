import type { WorldEntity, WorldEntityCommand, WorldEntityControllerKind, WorldEntityGoal, WorldDirectorEntry, WorldDirectorEvent, WorldDirectorCheckpoint, WorldScenarioAction, WorldScenarioStage, WorldState, WorldTargetRef } from '../types/world'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createWorldEntityGoal, normalizeWorldCharacterSpark, normalizeWorldEntityGoals } from './worldCharacter'
import { normalizeWorldClue } from './worldClues'
import { resolveOverlappingWorldEntities } from './worldEntityCollision'

import { createWorldEntity, stableEntityNumber } from './worldEntityCore'
import { upgradeGrayRavenScenarioStages, upgradeGrayRavenCompanionStages, createGrayRavenEileenCompanionScenario } from './worldScenarioMigrations'

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

const parseStoredScenarioConditions = (
  value: unknown,
): NonNullable<WorldScenarioStage['trigger']['conditions']> | undefined => {
  if (!isRecord(value) || (value.mode !== 'all' && value.mode !== 'any') || !Array.isArray(value.conditions)) return undefined
  const conditions = value.conditions.flatMap((condition): NonNullable<WorldScenarioStage['trigger']['conditions']>['conditions'] => {
    if (!isRecord(condition) || typeof condition.type !== 'string') return []
    if (condition.type === 'affinity' && typeof condition.actorId === 'string' && typeof condition.targetId === 'string' &&
      (condition.comparison === 'gte' || condition.comparison === 'lte') && isFiniteNumber(condition.value)) {
      return [{ type: 'affinity', actorId: condition.actorId, targetId: condition.targetId, comparison: condition.comparison, value: Math.max(-100, Math.min(100, condition.value)) }]
    }
    if (condition.type === 'health-ratio' && typeof condition.entityId === 'string' &&
      (condition.comparison === 'gte' || condition.comparison === 'lte') && isFiniteNumber(condition.value)) {
      return [{ type: 'health-ratio', entityId: condition.entityId, comparison: condition.comparison, value: Math.max(0, Math.min(1, condition.value)) }]
    }
    if (condition.type === 'faction' && typeof condition.entityId === 'string' && typeof condition.factionId === 'string') {
      return [{ type: 'faction', entityId: condition.entityId, factionId: condition.factionId.slice(0, 80) }]
    }
    if (condition.type === 'party-member' && typeof condition.entityId === 'string') {
      return [{
        type: 'party-member',
        entityId: condition.entityId,
        ...(typeof condition.leaderId === 'string' ? { leaderId: condition.leaderId } : {}),
        ...(condition.status === 'active' || condition.status === 'reserve' ? { status: condition.status } : {}),
      }]
    }
    if (condition.type === 'clue' && typeof condition.entityId === 'string' && typeof condition.clueId === 'string') {
      return [{
        type: 'clue',
        entityId: condition.entityId,
        clueId: condition.clueId.trim().slice(0, 160),
        ...(isFiniteNumber(condition.minimumConfidence)
          ? { minimumConfidence: Math.max(0, Math.min(1, condition.minimumConfidence)) }
          : {}),
      }]
    }
    if (condition.type === 'scenario-outcome' && typeof condition.scenarioId === 'string') {
      return [{
        type: 'scenario-outcome',
        scenarioId: condition.scenarioId,
        ...(typeof condition.outcomeId === 'string' ? { outcomeId: condition.outcomeId.slice(0, 180) } : {}),
      }]
    }
    if (condition.type === 'visibility' && typeof condition.visible === 'boolean') {
      const target = parseTargetRef(condition.target)
      return target && target.kind !== 'waypoint' ? [{ type: 'visibility', target, visible: condition.visible }] : []
    }
    if (condition.type === 'entity-alive' && typeof condition.entityId === 'string' && typeof condition.alive === 'boolean') {
      return [{ type: 'entity-alive', entityId: condition.entityId, alive: condition.alive }]
    }
    return []
  }).slice(0, 20)
  if (conditions.length === 0) return undefined
  return {
    mode: value.mode,
    ...(value.negate === true ? { negate: true } : {}),
    conditions,
  }
}

const parseStoredScenarioActionTiming = (value: Record<string, unknown>) => (
  isFiniteNumber(value.delaySeconds) && value.delaySeconds > 0
    ? { delaySeconds: Math.min(120, value.delaySeconds) }
    : {}
)

const parseStoredCommand = (value: unknown): WorldEntityCommand | undefined => {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'stop') return { type: 'stop' }
  if (value.type === 'wander') {
    return isFiniteNumber(value.seed) ? { type: 'wander', seed: value.seed } : { type: 'wander' }
  }
  if (value.type === 'patrol' && Array.isArray(value.waypointIds)) {
    const waypointIds = value.waypointIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map((id) => id.trim()).slice(0, 32)
    return waypointIds.length > 0 ? { type: 'patrol', waypointIds } : undefined
  }
  const target = parseTargetRef(value.target)
  if (!target || !['move', 'attack', 'revive', 'guard', 'follow', 'interact'].includes(value.type)) return undefined
  if (value.type === 'attack' && !['entity', 'brick', 'structure'].includes(target.kind)) return undefined
  if (value.type === 'revive' && target.kind !== 'entity') return undefined
  if (value.type === 'follow' && target.kind !== 'entity') return undefined
  if (value.type === 'interact') {
    const speechText = typeof value.speechText === 'string' ? value.speechText.trim().slice(0, 180) : ''
    return { type: value.type, target, ...(speechText ? { speechText } : {}) }
  }
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
    controller: isController(value.controller) && value.controller !== 'ai' ? value.controller : 'rule',
    transform: value.transform,
  })
  const health = isFiniteNumber(value.health) ? Math.max(0, Math.min(definition.combat.maxHealth, value.health)) : definition.combat.maxHealth
  const behaviorStates: WorldEntity['behaviorState'][] = ['idle', 'moving', 'following', 'guarding', 'attacking', 'reviving', 'blocked', 'dead']
  const behaviorState = health <= 0
    ? 'dead'
    : behaviorStates.includes(value.behaviorState as WorldEntity['behaviorState']) ? value.behaviorState as WorldEntity['behaviorState'] : 'idle'
  const commandQueue = Array.isArray(value.commandQueue)
    ? value.commandQueue.map(parseStoredCommand).filter((command): command is WorldEntityCommand => Boolean(command)).slice(0, 20)
    : []
  const activeCommand = parseStoredCommand(value.activeCommand)
  const storedMind = isRecord(value.mind) ? value.mind : undefined
  const storedSpark = storedMind && isRecord(storedMind.spark) ? storedMind.spark : undefined
  const parseStoredGoal = (goal: unknown): WorldEntityGoal | undefined => {
    if (!isRecord(goal)
      || typeof goal.summary !== 'string'
      || !['seed', 'player', 'scenario', 'ai'].includes(String(goal.source))
      || !isFiniteNumber(goal.updatedAtSeconds)) return undefined
    const commandTypes: WorldEntityCommand['type'][] = [
      'stop', 'wander', 'move', 'attack', 'revive', 'guard', 'follow', 'interact', 'patrol',
    ]
    return createWorldEntityGoal(
      goal.summary,
      goal.source as WorldEntityGoal['source'],
      goal.updatedAtSeconds,
      parseTargetRef(goal.target),
      commandTypes.includes(goal.commandType as WorldEntityCommand['type'])
        ? goal.commandType as WorldEntityCommand['type']
        : undefined,
    )
  }
  const storedGoals = normalizeWorldEntityGoals([
    ...(storedMind && Array.isArray(storedMind.goals) ? storedMind.goals.map(parseStoredGoal) : []),
    // Backward compatibility: focus was the single-goal format used before agendas.
    ...(storedMind && isRecord(storedMind.focus) ? [parseStoredGoal(storedMind.focus)] : []),
  ])
  return {
    ...entity,
    ...(typeof value.storylineId === 'string' && value.storylineId.trim() ? { storylineId: value.storylineId.slice(0, 160) } : {}),
    health,
    commandQueue,
    ...(activeCommand ? { activeCommand } : {}),
    navigation: { status: 'idle', path: [], pathIndex: 0 },
    behaviorState,
    combat: {
      cooldownRemainingSeconds: isRecord(value.combat) && isFiniteNumber(value.combat.cooldownRemainingSeconds)
        ? Math.max(0, value.combat.cooldownRemainingSeconds)
        : 0,
      ...(isRecord(value.combat) && typeof value.combat.attackTargetId === 'string'
        ? { attackTargetId: value.combat.attackTargetId }
        : {}),
      ...(isRecord(value.combat) && typeof value.combat.lastAttackerId === 'string'
        ? { lastAttackerId: value.combat.lastAttackerId }
        : {}),
      ...(isRecord(value.combat) && isFiniteNumber(value.combat.lastDamagedAtSeconds)
        ? { lastDamagedAtSeconds: Math.max(0, value.combat.lastDamagedAtSeconds) }
        : {}),
      ...(isRecord(value.combat) && isFiniteNumber(value.combat.lastDamageAmount)
        ? { lastDamageAmount: Math.max(0, value.combat.lastDamageAmount) }
        : {}),
      ...(isRecord(value.combat) && isFiniteNumber(value.combat.damageIndicatorExpiresAtSeconds)
        ? { damageIndicatorExpiresAtSeconds: Math.max(0, value.combat.damageIndicatorExpiresAtSeconds) }
        : {}),
    },
    autonomy: {
      nextDecisionAtSeconds: isRecord(value.autonomy) && isFiniteNumber(value.autonomy.nextDecisionAtSeconds)
        ? Math.max(0, value.autonomy.nextDecisionAtSeconds)
        : 2 + (stableEntityNumber(entity.id) % 5),
      home: isRecord(value.autonomy) && isRecord(value.autonomy.home)
        && isFiniteNumber(value.autonomy.home.x) && isFiniteNumber(value.autonomy.home.z)
        ? { x: value.autonomy.home.x, z: value.autonomy.home.z }
        : { x: entity.transform.x, z: entity.transform.z },
    },
    mind: {
      spark: normalizeWorldCharacterSpark({
        motive: typeof storedSpark?.motive === 'string' ? storedSpark.motive : undefined,
        temperament: typeof storedSpark?.temperament === 'string' ? storedSpark.temperament : undefined,
        voice: typeof storedSpark?.voice === 'string' ? storedSpark.voice : undefined,
        initiative: isFiniteNumber(storedSpark?.initiative) ? storedSpark.initiative : undefined,
      }, definition),
      goals: storedGoals,
    },
  }
}

const eventTypes = new Set<WorldState['events'][number]['type']>([
  'attack', 'damage', 'miss', 'defeated', 'revive', 'brick-hit', 'structure-hit', 'interaction', 'object-interaction', 'command-issued', 'command-complete',
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
  [1, 2, 3].includes(Number(value.importance)) &&
  (value.content === undefined || typeof value.content === 'string') &&
  (value.tags === undefined || (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string')))

const isStoredClue = (value: unknown): value is WorldState['narrative']['cluesByEntityId'][string][number] =>
  isRecord(value)
  && typeof value.id === 'string'
  && typeof value.holderId === 'string'
  && typeof value.text === 'string'
  && ['fact', 'rumor', 'secret'].includes(String(value.kind))
  && isFiniteNumber(value.confidence)
  && Array.isArray(value.tags)
  && value.tags.every((tag) => typeof tag === 'string')
  && isFiniteNumber(value.learnedAtSeconds)

const normalizeStoredClues = (value: unknown): WorldState['narrative']['cluesByEntityId'] => {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([holderId, clues]) => [
    holderId,
    Array.isArray(clues)
      ? clues
          .filter(isStoredClue)
          .map((clue) => normalizeWorldClue({ ...clue, holderId }))
          .slice(-32)
      : [],
  ]))
}

const isStoredStory = (value: unknown): value is WorldState['narrative']['stories'][number] =>
  isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string' && typeof value.body === 'string' &&
  isFiniteNumber(value.createdAtSeconds) && Array.isArray(value.eventIds) && value.eventIds.every((id) => typeof id === 'string') &&
  (value.characterIds === undefined || (Array.isArray(value.characterIds) && value.characterIds.every((id) => typeof id === 'string'))) &&
  (value.blocks === undefined || (Array.isArray(value.blocks) && value.blocks.every((block) => (
    isRecord(block) && (
      (block.type === 'narration' && typeof block.text === 'string') ||
      (block.type === 'dialogue' && typeof block.speakerId === 'string' && typeof block.text === 'string')
    )
  )))) &&
  (value.chapterNumber === undefined || (isFiniteNumber(value.chapterNumber) && value.chapterNumber >= 1)) &&
  (value.source === 'local' || value.source === 'ai')

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
        trust: isFiniteNumber(relationship.trust)
          ? Math.max(0, Math.min(100, relationship.trust))
          : Math.max(0, Math.min(100, relationship.affinity)),
        hostility: isFiniteNumber(relationship.hostility)
          ? Math.max(0, Math.min(100, relationship.hostility))
          : Math.max(0, Math.min(100, -relationship.affinity)),
        fear: isFiniteNumber(relationship.fear)
          ? Math.max(0, Math.min(100, relationship.fear))
          : 0,
        repeatedInteractionCount: isFiniteNumber(relationship.repeatedInteractionCount)
          ? Math.max(0, Math.min(20, Math.floor(relationship.repeatedInteractionCount)))
          : 0,
        encounters: Math.max(0, Math.floor(relationship.encounters)),
        lastEventType: relationship.lastEventType as WorldState['events'][number]['type'],
        updatedAtSeconds: isFiniteNumber(relationship.updatedAtSeconds) ? Math.max(0, relationship.updatedAtSeconds) : 0,
      }]]
    }))
    return [observerId, normalizedTargets]
  }))
}

const cleanStoredText = (value: unknown, maxLength: number) => (
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : ''
)

const parseStoredDirectorEvent = (value: Record<string, unknown>): WorldDirectorEvent | undefined => {
  if (value.type === 'narration') {
    const text = cleanStoredText(value.text, 500)
    return text ? { type: value.type, text } : undefined
  }
  if (value.type === 'dialogue') {
    const speakerId = cleanStoredText(value.speakerId, 160)
    const listenerId = cleanStoredText(value.listenerId, 160)
    const text = cleanStoredText(value.text, 180)
    return speakerId && text
      ? { type: value.type, speakerId, ...(listenerId && listenerId !== speakerId ? { listenerId } : {}), text }
      : undefined
  }
  if (value.type === 'command') {
    const entityId = cleanStoredText(value.entityId, 160)
    const command = parseStoredCommand(value.command)
    const directorCommand = command && command.type !== 'patrol'
      && (!('target' in command) || command.target.kind !== 'waypoint')
      ? command
      : undefined
    return entityId && directorCommand ? { type: value.type, entityId, command: directorCommand } : undefined
  }
  if (value.type === 'relationship') {
    const fromId = cleanStoredText(value.fromId, 160)
    const toId = cleanStoredText(value.toId, 160)
    const delta = isFiniteNumber(value.delta) ? Math.max(-10, Math.min(10, Math.round(value.delta))) : 0
    const reason = cleanStoredText(value.reason, 120)
    return fromId && toId && fromId !== toId && delta !== 0
      ? { type: value.type, fromId, toId, delta, reason }
      : undefined
  }
  if (value.type === 'choice') {
    const label = cleanStoredText(value.label, 48)
    const suggestedInput = cleanStoredText(value.suggestedInput, 240)
    return label && suggestedInput ? { type: value.type, label, suggestedInput } : undefined
  }
  if (value.type === 'end') {
    const summary = cleanStoredText(value.summary, 300)
    return summary ? { type: value.type, summary } : undefined
  }
  return undefined
}

const parseStoredDirectorEntry = (value: unknown): WorldDirectorEntry | undefined => {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined
  const event = parseStoredDirectorEvent(value)
  if (!event) return undefined
  return {
    ...event,
    id: value.id.slice(0, 180),
    ...(['accepted', 'rejected'].includes(String(value.status)) ? { status: value.status as 'accepted' | 'rejected' } : {}),
    ...(typeof value.detail === 'string' ? { detail: value.detail.slice(0, 160) } : {}),
    ...(isFiniteNumber(value.before) ? { before: Math.max(-100, Math.min(100, value.before)) } : {}),
    ...(isFiniteNumber(value.after) ? { after: Math.max(-100, Math.min(100, value.after)) } : {}),
    ...(isRecord(value.execution)
      && ['queued', 'approaching', 'acting', 'speaking', 'confirmed', 'failed', 'skipped'].includes(String(value.execution.phase))
      ? { execution: {
          phase: value.execution.phase as NonNullable<WorldDirectorEntry['execution']>['phase'],
          attempt: isFiniteNumber(value.execution.attempt) ? Math.max(1, Math.floor(value.execution.attempt)) : 1,
          ...(isFiniteNumber(value.execution.startedAtSeconds) ? { startedAtSeconds: Math.max(0, value.execution.startedAtSeconds) } : {}),
          ...(isFiniteNumber(value.execution.finishedAtSeconds) ? { finishedAtSeconds: Math.max(0, value.execution.finishedAtSeconds) } : {}),
          ...(typeof value.execution.retryable === 'boolean' ? { retryable: value.execution.retryable } : {}),
        } }
      : {}),
  } as WorldDirectorEntry
}

const parseStoredDirectorTurns = (value: unknown, planId: string): WorldState['narrative']['directorTurns'] => (
  Array.isArray(value) ? value.flatMap((turn) => {
    if (!isRecord(turn) || typeof turn.id !== 'string' || !isFiniteNumber(turn.createdAtSeconds)) return []
    const playerText = cleanStoredText(turn.playerText, 800)
    if (!playerText || !['completed', 'stopped', 'failed'].includes(String(turn.status))) return []
    const storedContextStats = isRecord(turn.contextStats) ? turn.contextStats : undefined
    const contextStats = storedContextStats
      && isFiniteNumber(storedContextStats.messageCount)
      && isFiniteNumber(storedContextStats.estimatedInputTokens)
      && isFiniteNumber(storedContextStats.rawTurnCount)
      && isFiniteNumber(storedContextStats.memoryTurnCount)
      ? {
          messageCount: Math.max(0, Math.floor(storedContextStats.messageCount)),
          estimatedInputTokens: Math.max(0, Math.floor(storedContextStats.estimatedInputTokens)),
          rawTurnCount: Math.max(0, Math.floor(storedContextStats.rawTurnCount)),
          memoryTurnCount: Math.max(0, Math.floor(storedContextStats.memoryTurnCount)),
          ...(typeof storedContextStats.compactionTriggered === 'boolean'
            ? { compactionTriggered: storedContextStats.compactionTriggered }
            : {}),
          ...(isFiniteNumber(storedContextStats.inputTokens) ? { inputTokens: Math.max(0, Math.floor(storedContextStats.inputTokens)) } : {}),
          ...(isFiniteNumber(storedContextStats.outputTokens) ? { outputTokens: Math.max(0, Math.floor(storedContextStats.outputTokens)) } : {}),
          ...(isFiniteNumber(storedContextStats.cachedTokens) ? { cachedTokens: Math.max(0, Math.floor(storedContextStats.cachedTokens)) } : {}),
          ...(isFiniteNumber(storedContextStats.totalTokens) ? { totalTokens: Math.max(0, Math.floor(storedContextStats.totalTokens)) } : {}),
        }
      : undefined
    const checkpoint = parseStoredDirectorCheckpoint(turn.checkpoint, planId)
    return [{
      id: turn.id.slice(0, 180),
      playerText,
      ...(turn.origin === 'autonomous' ? { origin: 'autonomous' as const } : {}),
      entries: Array.isArray(turn.entries)
        ? turn.entries.flatMap((entry) => {
            const parsed = parseStoredDirectorEntry(entry)
            return parsed ? [parsed] : []
          }).slice(-20)
        : [],
      createdAtSeconds: Math.max(0, turn.createdAtSeconds),
      status: turn.status as 'completed' | 'stopped' | 'failed',
      ...(typeof turn.reasoning === 'string' ? { reasoning: turn.reasoning.slice(0, 20_000) } : {}),
      ...(typeof turn.requestMessage === 'string' ? { requestMessage: turn.requestMessage.slice(0, 60_000) } : {}),
      ...(typeof turn.responseMessage === 'string' ? { responseMessage: turn.responseMessage.slice(0, 30_000) } : {}),
      ...(Array.isArray(turn.validationIssues) ? {
        validationIssues: turn.validationIssues.flatMap((issue) => (
          isRecord(issue)
          && isFiniteNumber(issue.lineNumber)
          && typeof issue.code === 'string'
          && typeof issue.raw === 'string'
            ? [{
                lineNumber: Math.max(0, Math.floor(issue.lineNumber)),
                code: issue.code.slice(0, 80),
                raw: issue.raw.slice(0, 500),
              }]
            : []
        )).slice(-20),
      } : {}),
      ...(contextStats ? { contextStats } : {}),
      ...(typeof turn.error === 'string' ? { error: turn.error.slice(0, 300) } : {}),
      ...(checkpoint ? { checkpoint } : {}),
    }]
  }).slice(-100) : []
)

export const parseStoredWorldState = (value: unknown, planId: string) => {
  if (!isRecord(value) || value.planId !== planId || !Array.isArray(value.entities)) return undefined
  const entities = value.entities.map(parseStoredEntity)
  if (entities.some((entity) => !entity)) return undefined
  const safeEntities = resolveOverlappingWorldEntities(entities as WorldEntity[])
  const entityIds = new Set(safeEntities.map((entity) => entity.id))
  const claimedPartyMemberIds = new Set<string>()
  const parties: WorldState['parties'] = Array.isArray(value.parties)
    ? value.parties.flatMap((party) => {
        if (!isRecord(party) || typeof party.id !== 'string' || typeof party.name !== 'string' ||
          typeof party.leaderId !== 'string' || !entityIds.has(party.leaderId) || !Array.isArray(party.members)) return []
        const members = party.members.flatMap((member) => {
          if (!isRecord(member) || typeof member.entityId !== 'string' || !entityIds.has(member.entityId) ||
            claimedPartyMemberIds.has(member.entityId)) return []
          claimedPartyMemberIds.add(member.entityId)
          return [{
            entityId: member.entityId,
            status: member.entityId === party.leaderId || member.status !== 'reserve'
              ? 'active' as const
              : 'reserve' as const,
            joinedAtSeconds: isFiniteNumber(member.joinedAtSeconds)
              ? Math.max(0, member.joinedAtSeconds)
              : 0,
          }]
        }).slice(0, 24)
        if (!members.some((member) => member.entityId === party.leaderId)) return []
        return [{
          id: party.id.trim().slice(0, 160),
          name: party.name.trim().slice(0, 120) || '未命名队伍',
          leaderId: party.leaderId,
          members,
        }]
      }).slice(0, 20)
    : []
  const events = parseStoredEvents(value.events)
  const pendingImpacts = Array.isArray(value.pendingImpacts) ? value.pendingImpacts.filter((impact): impact is WorldState['pendingImpacts'][number] => (
    isRecord(impact) && typeof impact.id === 'string' && typeof impact.actorId === 'string' && entityIds.has(impact.actorId) &&
    Boolean(parseTargetRef(impact.target)) && isRecord(impact.target) && ['entity', 'brick', 'structure'].includes(String(impact.target.kind)) &&
    isFiniteNumber(impact.damage) && impact.damage > 0 &&
    (impact.projectileKind === 'arrow' || impact.projectileKind === 'stone') && isFiniteNumber(impact.impactAtSeconds) &&
    isRecord(impact.impactPoint) && isFiniteNumber(impact.impactPoint.x) &&
    isFiniteNumber(impact.impactPoint.y) && isFiniteNumber(impact.impactPoint.z)
  )).slice(-100) : []
  const narrative = isRecord(value.narrative) ? value.narrative : {}

  let scenarios: WorldState['scenarios'] = Array.isArray(value.scenarios)
    ? value.scenarios.flatMap((scenario) => {
        if (!isRecord(scenario) || typeof scenario.id !== 'string' || typeof scenario.assetId !== 'string' ||
          typeof scenario.title !== 'string' || typeof scenario.description !== 'string' || !Array.isArray(scenario.stages)) return []
        const stages = scenario.stages.flatMap((stage) => {
          if (!isRecord(stage) || typeof stage.id !== 'string' || typeof stage.title !== 'string' ||
            typeof stage.description !== 'string' || !['locked', 'active', 'completed'].includes(String(stage.status)) ||
            !isRecord(stage.trigger) || !eventTypes.has(stage.trigger.eventType as WorldState['events'][number]['type'])) return []
          const actions = Array.isArray(stage.actions) ? stage.actions.flatMap((action): WorldScenarioAction[] => {
            if (!isRecord(action) || typeof action.type !== 'string') return []
            if (action.type === 'set-faction' && typeof action.entityId === 'string' && typeof action.factionId === 'string') {
              return [{ type: 'set-faction' as const, entityId: action.entityId, factionId: action.factionId, ...parseStoredScenarioActionTiming(action) }]
            }
            if (action.type === 'join-party' && typeof action.entityId === 'string' && typeof action.leaderId === 'string') {
              return [{
                type: 'join-party' as const,
                entityId: action.entityId,
                leaderId: action.leaderId,
                ...(typeof action.partyName === 'string' && action.partyName.trim()
                  ? { partyName: action.partyName.trim().slice(0, 120) }
                  : {}),
                ...(action.status === 'reserve' ? { status: 'reserve' as const } : {}),
                ...parseStoredScenarioActionTiming(action),
              }]
            }
            if (action.type === 'leave-party' && typeof action.entityId === 'string') {
              return [{ type: 'leave-party' as const, entityId: action.entityId, ...parseStoredScenarioActionTiming(action) }]
            }
            if (action.type === 'grant-clue' && typeof action.entityId === 'string' && isRecord(action.clue)
              && typeof action.clue.id === 'string' && typeof action.clue.text === 'string'
              && ['fact', 'rumor', 'secret'].includes(String(action.clue.kind))
              && isFiniteNumber(action.clue.confidence) && Array.isArray(action.clue.tags)) {
              return [{
                type: 'grant-clue' as const,
                entityId: action.entityId,
                clue: {
                  id: action.clue.id.trim().slice(0, 160),
                  text: action.clue.text.trim().slice(0, 500),
                  kind: action.clue.kind as 'fact' | 'rumor' | 'secret',
                  confidence: Math.max(0.05, Math.min(1, action.clue.confidence)),
                  tags: action.clue.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 12),
                },
                ...parseStoredScenarioActionTiming(action),
              }]
            }
            if (action.type === 'issue-command' && typeof action.entityId === 'string') {
              const command = parseStoredCommand(action.command)
              return command ? [{ type: 'issue-command' as const, entityId: action.entityId, command, ...parseStoredScenarioActionTiming(action) }] : []
            }
            if (action.type === 'set-visibility' && typeof action.visible === 'boolean') {
              const target = parseTargetRef(action.target)
              return target && target.kind !== 'waypoint' ? [{ type: 'set-visibility' as const, target, visible: action.visible, ...parseStoredScenarioActionTiming(action) }] : []
            }
            if (action.type === 'world-object' && typeof action.brickId === 'string' && ['open', 'close', 'toggle', 'power-on', 'power-off', 'inspect'].includes(String(action.action))) {
              return [{ type: 'world-object' as const, brickId: action.brickId, action: action.action as 'open' | 'close' | 'toggle' | 'power-on' | 'power-off' | 'inspect', ...(typeof action.actorId === 'string' ? { actorId: action.actorId } : {}), ...parseStoredScenarioActionTiming(action) }]
            }
            if (action.type === 'add-story' && typeof action.title === 'string' && typeof action.body === 'string') {
              return [{
                type: 'add-story' as const,
                title: action.title,
                body: action.body,
                characterIds: Array.isArray(action.characterIds)
                  ? action.characterIds.filter((id): id is string => typeof id === 'string')
                  : undefined,
                ...parseStoredScenarioActionTiming(action),
              }]
            }
            return []
          }) : undefined
          const dialogue = Array.isArray(stage.dialogue) ? stage.dialogue.flatMap((line) => {
            if (!isRecord(line) || typeof line.id !== 'string' || typeof line.speakerId !== 'string' ||
              typeof line.text !== 'string' || !line.text.trim() || !isFiniteNumber(line.durationSeconds)) return []
            return [{
              id: line.id,
              speakerId: line.speakerId,
              text: line.text.slice(0, 500),
              durationSeconds: Math.max(0.5, Math.min(30, line.durationSeconds)),
            }]
          }) : undefined
          const branches = Array.isArray(stage.branches) ? stage.branches.flatMap((branch) => {
            if (!isRecord(branch) || typeof branch.id !== 'string' || typeof branch.title !== 'string' ||
              !isRecord(branch.trigger) || !eventTypes.has(branch.trigger.eventType as WorldState['events'][number]['type'])) return []
            const branchActions = Array.isArray(branch.actions) ? branch.actions.flatMap((action): WorldScenarioAction[] => {
              if (!isRecord(action) || typeof action.type !== 'string') return []
              if (action.type === 'set-faction' && typeof action.entityId === 'string' && typeof action.factionId === 'string') return [{ type: 'set-faction', entityId: action.entityId, factionId: action.factionId, ...parseStoredScenarioActionTiming(action) }]
              if (action.type === 'join-party' && typeof action.entityId === 'string' && typeof action.leaderId === 'string') return [{
                type: 'join-party',
                entityId: action.entityId,
                leaderId: action.leaderId,
                ...(typeof action.partyName === 'string' && action.partyName.trim()
                  ? { partyName: action.partyName.trim().slice(0, 120) }
                  : {}),
                ...(action.status === 'reserve' ? { status: 'reserve' as const } : {}),
                ...parseStoredScenarioActionTiming(action),
              }]
              if (action.type === 'leave-party' && typeof action.entityId === 'string') return [{
                type: 'leave-party',
                entityId: action.entityId,
                ...parseStoredScenarioActionTiming(action),
              }]
              if (action.type === 'grant-clue' && typeof action.entityId === 'string' && isRecord(action.clue)
                && typeof action.clue.id === 'string' && typeof action.clue.text === 'string'
                && ['fact', 'rumor', 'secret'].includes(String(action.clue.kind))
                && isFiniteNumber(action.clue.confidence) && Array.isArray(action.clue.tags)) return [{
                  type: 'grant-clue',
                  entityId: action.entityId,
                  clue: {
                    id: action.clue.id.trim().slice(0, 160),
                    text: action.clue.text.trim().slice(0, 500),
                    kind: action.clue.kind as 'fact' | 'rumor' | 'secret',
                    confidence: Math.max(0.05, Math.min(1, action.clue.confidence)),
                    tags: action.clue.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 12),
                  },
                  ...parseStoredScenarioActionTiming(action),
                }]
              if (action.type === 'issue-command' && typeof action.entityId === 'string') {
                const command = parseStoredCommand(action.command)
                return command ? [{ type: 'issue-command', entityId: action.entityId, command, ...parseStoredScenarioActionTiming(action) }] : []
              }
              if (action.type === 'set-visibility' && typeof action.visible === 'boolean') {
                const target = parseTargetRef(action.target)
                return target && target.kind !== 'waypoint' ? [{ type: 'set-visibility', target, visible: action.visible, ...parseStoredScenarioActionTiming(action) }] : []
              }
              if (action.type === 'world-object' && typeof action.brickId === 'string' && ['open', 'close', 'toggle', 'power-on', 'power-off', 'inspect'].includes(String(action.action))) {
                return [{ type: 'world-object' as const, brickId: action.brickId, action: action.action as 'open' | 'close' | 'toggle' | 'power-on' | 'power-off' | 'inspect', ...(typeof action.actorId === 'string' ? { actorId: action.actorId } : {}), ...parseStoredScenarioActionTiming(action) }]
              }
              if (action.type === 'add-story' && typeof action.title === 'string' && typeof action.body === 'string') return [{
                type: 'add-story', title: action.title, body: action.body,
                characterIds: Array.isArray(action.characterIds) ? action.characterIds.filter((id): id is string => typeof id === 'string') : undefined,
                ...parseStoredScenarioActionTiming(action),
              }]
              return []
            }) : undefined
            const branchDialogue = Array.isArray(branch.dialogue) ? branch.dialogue.flatMap((line) => {
              if (!isRecord(line) || typeof line.id !== 'string' || typeof line.speakerId !== 'string' ||
                typeof line.text !== 'string' || !line.text.trim() || !isFiniteNumber(line.durationSeconds)) return []
              return [{ id: line.id, speakerId: line.speakerId, text: line.text.slice(0, 500), durationSeconds: Math.max(0.5, Math.min(30, line.durationSeconds)) }]
            }) : undefined
            return [{
              id: branch.id,
              title: branch.title,
              ...(typeof branch.aiGuidance === 'string' && branch.aiGuidance.trim()
                ? { aiGuidance: branch.aiGuidance.trim().slice(0, 1_000) }
                : {}),
              trigger: {
                eventType: branch.trigger.eventType as WorldState['events'][number]['type'],
                ...(typeof branch.trigger.actorId === 'string' ? { actorId: branch.trigger.actorId } : {}),
                ...(typeof branch.trigger.targetId === 'string' ? { targetId: branch.trigger.targetId } : {}),
                ...(typeof branch.trigger.commandType === 'string' ? { commandType: branch.trigger.commandType as WorldEntityCommand['type'] } : {}),
                ...(isFiniteNumber(branch.trigger.minimumAffinity)
                  ? { minimumAffinity: Math.max(-100, Math.min(100, branch.trigger.minimumAffinity)) }
                  : {}),
                ...(parseStoredScenarioConditions(branch.trigger.conditions)
                  ? { conditions: parseStoredScenarioConditions(branch.trigger.conditions) }
                  : {}),
              },
              ...(typeof branch.nextStageId === 'string' ? { nextStageId: branch.nextStageId } : {}),
              ...(branchDialogue?.length ? { dialogue: branchDialogue } : {}),
              ...(branchActions ? { actions: branchActions } : {}),
            }]
          }) : undefined
          const ai = isRecord(stage.ai)
            && (stage.ai.mode === 'dialogue' || stage.ai.mode === 'choice')
            && typeof stage.ai.instruction === 'string'
            ? {
                mode: stage.ai.mode as 'dialogue' | 'choice',
                instruction: stage.ai.instruction.trim().slice(0, 2_000),
                ...(Array.isArray(stage.ai.speakerIds)
                  ? {
                      speakerIds: stage.ai.speakerIds
                        .filter((id): id is string => typeof id === 'string' && entityIds.has(id))
                        .slice(0, 20),
                    }
                  : {}),
                ...(isFiniteNumber(stage.ai.maxDialogueLines)
                  ? { maxDialogueLines: Math.max(1, Math.min(6, Math.floor(stage.ai.maxDialogueLines))) }
                  : {}),
                ...(typeof stage.ai.fallbackBranchId === 'string'
                  ? { fallbackBranchId: stage.ai.fallbackBranchId.slice(0, 180) }
                  : {}),
              }
            : undefined
          return [{
            id: stage.id,
            title: stage.title,
            description: stage.description,
            status: stage.status as 'locked' | 'active' | 'completed',
            trigger: {
              eventType: stage.trigger.eventType as WorldState['events'][number]['type'],
              ...(typeof stage.trigger.actorId === 'string' ? { actorId: stage.trigger.actorId } : {}),
              ...(typeof stage.trigger.targetId === 'string' ? { targetId: stage.trigger.targetId } : {}),
              ...(typeof stage.trigger.commandType === 'string' ? { commandType: stage.trigger.commandType as WorldEntityCommand['type'] } : {}),
              ...(isFiniteNumber(stage.trigger.minimumAffinity)
                ? { minimumAffinity: Math.max(-100, Math.min(100, stage.trigger.minimumAffinity)) }
                : {}),
              ...(parseStoredScenarioConditions(stage.trigger.conditions)
                ? { conditions: parseStoredScenarioConditions(stage.trigger.conditions) }
                : {}),
            },
            ...(ai ? { ai } : {}),
            ...(dialogue?.length ? { dialogue } : {}),
            ...(actions ? { actions } : {}),
            ...(stage.nextStageId === null
              ? { nextStageId: null }
              : typeof stage.nextStageId === 'string' ? { nextStageId: stage.nextStageId } : {}),
            ...(branches?.length ? { branches } : {}),
            ...(isFiniteNumber(stage.completedAtSeconds) ? { completedAtSeconds: Math.max(0, stage.completedAtSeconds) } : {}),
          }]
        })
        if (stages.length === 0) return []
        const authoringVersion = isFiniteNumber(scenario.authoringVersion) ? Math.max(0, Math.floor(scenario.authoringVersion)) : 0
        const upgradedStages = scenario.assetId === 'scenario-border-tavern'
          ? upgradeGrayRavenScenarioStages(stages, scenario.title, authoringVersion)
          : scenario.assetId === 'scenario-border-tavern-eileen-companion'
            ? upgradeGrayRavenCompanionStages(stages, String(scenario.title), authoringVersion)
            : stages
        const activeDialogue = isRecord(scenario.activeDialogue) &&
          typeof scenario.activeDialogue.stageId === 'string' &&
          typeof scenario.activeDialogue.eventId === 'string' &&
          isFiniteNumber(scenario.activeDialogue.lineIndex) &&
          isFiniteNumber(scenario.activeDialogue.lineEndsAtSeconds)
          ? {
              stageId: scenario.activeDialogue.stageId,
              eventId: scenario.activeDialogue.eventId,
              ...(typeof scenario.activeDialogue.branchId === 'string' ? { branchId: scenario.activeDialogue.branchId } : {}),
              ...(Array.isArray(scenario.activeDialogue.generatedDialogue)
                ? {
                    generatedDialogue: scenario.activeDialogue.generatedDialogue.flatMap((line) => {
                      if (!isRecord(line) || typeof line.id !== 'string' || typeof line.speakerId !== 'string' ||
                        typeof line.text !== 'string' || !line.text.trim() || !isFiniteNumber(line.durationSeconds)) return []
                      return [{
                        id: line.id.slice(0, 180),
                        speakerId: line.speakerId.slice(0, 180),
                        text: line.text.trim().slice(0, 500),
                        durationSeconds: Math.max(0.5, Math.min(30, line.durationSeconds)),
                      }]
                    }).slice(0, 6),
                  }
                : {}),
              ...(scenario.activeDialogue.source === 'ai' || scenario.activeDialogue.source === 'authored'
                ? { source: scenario.activeDialogue.source as 'ai' | 'authored' }
                : {}),
              lineIndex: Math.max(0, Math.floor(scenario.activeDialogue.lineIndex)),
              lineEndsAtSeconds: Math.max(0, scenario.activeDialogue.lineEndsAtSeconds),
            }
          : undefined
        const pendingAi = isRecord(scenario.pendingAi)
          && typeof scenario.pendingAi.stageId === 'string'
          && typeof scenario.pendingAi.eventId === 'string'
          && isFiniteNumber(scenario.pendingAi.requestedAtSeconds)
          ? {
              stageId: scenario.pendingAi.stageId.slice(0, 180),
              eventId: scenario.pendingAi.eventId.slice(0, 180),
              ...(typeof scenario.pendingAi.branchId === 'string'
                ? { branchId: scenario.pendingAi.branchId.slice(0, 180) }
                : {}),
              requestedAtSeconds: Math.max(0, scenario.pendingAi.requestedAtSeconds),
            }
          : undefined
        const activeTimeline = isRecord(scenario.activeTimeline)
          && typeof scenario.activeTimeline.stageId === 'string'
          && typeof scenario.activeTimeline.eventId === 'string'
          && isFiniteNumber(scenario.activeTimeline.actionIndex)
          && isFiniteNumber(scenario.activeTimeline.nextActionAtSeconds)
          ? {
              stageId: scenario.activeTimeline.stageId.slice(0, 180),
              eventId: scenario.activeTimeline.eventId.slice(0, 180),
              ...(typeof scenario.activeTimeline.branchId === 'string'
                ? { branchId: scenario.activeTimeline.branchId.slice(0, 180) }
                : {}),
              ...(Array.isArray(scenario.activeTimeline.generatedDialogue)
                ? {
                    generatedDialogue: scenario.activeTimeline.generatedDialogue.flatMap((line) => {
                      if (!isRecord(line) || typeof line.id !== 'string' || typeof line.speakerId !== 'string' ||
                        typeof line.text !== 'string' || !line.text.trim() || !isFiniteNumber(line.durationSeconds)) return []
                      return [{
                        id: line.id.slice(0, 180),
                        speakerId: line.speakerId.slice(0, 180),
                        text: line.text.trim().slice(0, 500),
                        durationSeconds: Math.max(0.5, Math.min(30, line.durationSeconds)),
                      }]
                    }).slice(0, 6),
                  }
                : {}),
              ...(scenario.activeTimeline.source === 'ai' || scenario.activeTimeline.source === 'authored'
                ? { source: scenario.activeTimeline.source as 'ai' | 'authored' }
                : {}),
              actionIndex: Math.max(0, Math.floor(scenario.activeTimeline.actionIndex)),
              nextActionAtSeconds: Math.max(0, scenario.activeTimeline.nextActionAtSeconds),
            }
          : undefined
        const queuedTransition = isRecord(scenario.queuedTransition)
          && typeof scenario.queuedTransition.stageId === 'string'
          && typeof scenario.queuedTransition.eventId === 'string'
          && isFiniteNumber(scenario.queuedTransition.queuedAtSeconds)
          ? {
              stageId: scenario.queuedTransition.stageId.slice(0, 180),
              eventId: scenario.queuedTransition.eventId.slice(0, 180),
              ...(typeof scenario.queuedTransition.branchId === 'string'
                ? { branchId: scenario.queuedTransition.branchId.slice(0, 180) }
                : {}),
              queuedAtSeconds: Math.max(0, scenario.queuedTransition.queuedAtSeconds),
            }
          : undefined
        const inferredCastEntityIds = Array.from(new Set(upgradedStages.flatMap((stage) => [
          stage.trigger.actorId,
          stage.trigger.targetId,
          ...(stage.dialogue ?? []).map((line) => line.speakerId),
          ...(stage.actions ?? []).flatMap((action) => action.type === 'add-story'
            ? action.characterIds ?? []
            : action.type === 'world-object'
              ? action.actorId ? [action.actorId] : []
            : action.type === 'set-visibility'
              ? action.target.kind === 'entity' ? [action.target.id] : []
              : action.type === 'join-party' ? [action.entityId, action.leaderId] : [action.entityId]),
          ...(stage.branches ?? []).flatMap((branch) => [
            branch.trigger.actorId,
            branch.trigger.targetId,
            ...(branch.dialogue ?? []).map((line) => line.speakerId),
            ...(branch.actions ?? []).flatMap((action) => action.type === 'add-story'
              ? action.characterIds ?? []
              : action.type === 'world-object'
                ? action.actorId ? [action.actorId] : []
              : action.type === 'set-visibility'
                ? action.target.kind === 'entity' ? [action.target.id] : []
                : action.type === 'join-party' ? [action.entityId, action.leaderId] : [action.entityId]),
          ]),
        ].filter((id): id is string => Boolean(id) && entityIds.has(id)))))
        const castEntityIds = Array.isArray(scenario.castEntityIds)
          ? scenario.castEntityIds.filter((id): id is string => typeof id === 'string' && entityIds.has(id))
          : inferredCastEntityIds
        return [{
          id: scenario.id,
          assetId: scenario.assetId,
          title: scenario.title,
          description: scenario.description,
          ...(typeof scenario.enabled === 'boolean' ? { enabled: scenario.enabled } : {}),
          ...(isFiniteNumber(scenario.priority) ? { priority: Math.max(-100, Math.min(100, Math.floor(scenario.priority))) } : {}),
          ...(typeof scenario.mutexGroup === 'string' && scenario.mutexGroup.trim()
            ? { mutexGroup: scenario.mutexGroup.trim().slice(0, 120) }
            : {}),
          ...(castEntityIds.length ? { castEntityIds } : {}),
          stages: upgradedStages,
          processedEventIds: Array.isArray(scenario.processedEventIds)
            ? scenario.processedEventIds.filter((id): id is string => typeof id === 'string').slice(-500)
            : [],
          ...(Array.isArray(scenario.claimedEventIds) ? {
            claimedEventIds: scenario.claimedEventIds
              .filter((id): id is string => typeof id === 'string')
              .slice(-500),
          } : {}),
          ...(pendingAi ? { pendingAi } : {}),
          ...(activeDialogue ? { activeDialogue } : {}),
          ...(activeTimeline ? { activeTimeline } : {}),
          ...(queuedTransition ? { queuedTransition } : {}),
          ...(typeof scenario.outcomeId === 'string' ? { outcomeId: scenario.outcomeId } : {}),
          ...(scenario.assetId === 'scenario-border-tavern'
            ? { authoringVersion: Math.max(4, authoringVersion) }
            : scenario.assetId === 'scenario-border-tavern-eileen-companion'
              ? { authoringVersion: Math.max(3, authoringVersion) }
              : authoringVersion ? { authoringVersion } : {}),
        }]
      }).slice(-20)
    : []

  let migratedGrayRavenEileenId: string | undefined
  const legacyGrayRaven = scenarios.find((scenario) => (
    scenario.assetId === 'scenario-border-tavern'
    && (scenario.authoringVersion ?? 0) < 5
  ))
  if (legacyGrayRaven && !scenarios.some((scenario) => scenario.assetId === 'scenario-border-tavern-eileen-companion')) {
    const investigate = legacyGrayRaven.stages.find((stage) => stage.id.endsWith('investigate'))
    const rolandId = investigate?.trigger.actorId
    const eileenId = investigate?.trigger.targetId
    if (rolandId && eileenId) {
      migratedGrayRavenEileenId = eileenId
      scenarios.push(createGrayRavenEileenCompanionScenario(
        legacyGrayRaven.id,
        new Set(scenarios.map((scenario) => scenario.id)),
        rolandId,
        eileenId,
        /[\u3400-\u9fff]/.test(legacyGrayRaven.title),
      ))
    }
  }
  scenarios = scenarios.map((scenario) => scenario.assetId === 'scenario-border-tavern'
    ? { ...scenario, authoringVersion: 6 }
    : scenario)

  const completedJoinActions = scenarios.flatMap((scenario) => scenario.stages.flatMap((stage) => (
    stage.status === 'completed'
      ? (stage.actions ?? []).filter((action): action is Extract<WorldScenarioAction, { type: 'join-party' }> => action.type === 'join-party')
      : []
  )))
  for (const action of completedJoinActions) {
    if (parties.some((party) => party.members.some((member) => member.entityId === action.entityId))) continue
    const leader = safeEntities.find((entity) => entity.id === action.leaderId)
    if (!leader) continue
    const party = parties.find((candidate) => candidate.members.some((member) => member.entityId === action.leaderId))
    if (party) {
      party.members.push({
        entityId: action.entityId,
        status: action.status ?? 'active',
        joinedAtSeconds: value.elapsedSeconds && isFiniteNumber(value.elapsedSeconds) ? value.elapsedSeconds : 0,
      })
    } else {
      parties.push({
        id: `party-${action.leaderId}`,
        name: action.partyName?.trim() || `${leader.name}的小队`,
        leaderId: action.leaderId,
        members: [
          { entityId: action.leaderId, status: 'active', joinedAtSeconds: 0 },
          {
            entityId: action.entityId,
            status: action.status ?? 'active',
            joinedAtSeconds: value.elapsedSeconds && isFiniteNumber(value.elapsedSeconds) ? value.elapsedSeconds : 0,
          },
        ],
      })
    }
  }

  const storedHiddenTargets = Array.isArray(value.hiddenTargets) ? value.hiddenTargets.flatMap((target) => {
    const parsed = parseTargetRef(target)
    return parsed && parsed.kind !== 'waypoint' ? [parsed] : []
  }).slice(-500) : []
  const terminalHiddenTargets = scenarios.flatMap((scenario) => {
    if (!scenario.outcomeId) return []
    const branch = scenario.stages
      .flatMap((stage) => stage.branches ?? [])
      .find((candidate) => candidate.id === scenario.outcomeId)
    return (branch?.actions ?? []).flatMap((action) => (
      action.type === 'set-visibility' && !action.visible ? [action.target] : []
    ))
  })
  const hiddenTargets = [...storedHiddenTargets]
  for (const target of terminalHiddenTargets) {
    if (!hiddenTargets.some((candidate) => candidate.kind === target.kind && candidate.id === target.id)) {
      hiddenTargets.push(target)
    }
  }
  const hiddenEntityIds = new Set(hiddenTargets.flatMap((target) => target.kind === 'entity' ? [target.id] : []))
  const storylineMemberships = new Map<string, string[]>()
  for (const scenario of scenarios) {
    for (const entityId of scenario.castEntityIds ?? []) {
      storylineMemberships.set(entityId, [...(storylineMemberships.get(entityId) ?? []), scenario.id])
    }
  }
  const restoredEntities = safeEntities.map((entity) => {
    const memberships = storylineMemberships.get(entity.id) ?? []
    const restoredWithStoryline = entity.storylineId || memberships.length !== 1
      ? entity
      : { ...entity, storylineId: memberships[0] }
    const restoredFaction = entity.id === migratedGrayRavenEileenId
      ? { ...restoredWithStoryline, factionId: 'neutral' }
      : restoredWithStoryline
    const partyId = parties.find((party) => party.members.some((member) => member.entityId === entity.id))?.id
    const restored = partyId === restoredFaction.partyId
      ? restoredFaction
      : { ...restoredFaction, partyId }
    if (!hiddenEntityIds.has(entity.id)) return restored
    return {
      ...restored,
      activeCommand: undefined,
      commandQueue: [],
      speech: undefined,
      behaviorState: 'idle' as const,
      navigation: { status: 'idle' as const, path: [], pathIndex: 0 },
    }
  })
  const directorTurns = parseStoredDirectorTurns(narrative.directorTurns, planId)
  const storedDirectorMemory = isRecord(narrative.directorMemory) ? narrative.directorMemory : undefined
  const directorMemory = storedDirectorMemory
    && typeof storedDirectorMemory.summary === 'string'
    && typeof storedDirectorMemory.throughTurnId === 'string'
    && isFiniteNumber(storedDirectorMemory.sourceTurnCount)
    && isFiniteNumber(storedDirectorMemory.updatedAtSeconds)
    ? {
        summary: storedDirectorMemory.summary.slice(0, 4_000),
        ...(Array.isArray(storedDirectorMemory.lockedFacts)
          ? {
              lockedFacts: storedDirectorMemory.lockedFacts
                .filter((fact): fact is string => typeof fact === 'string' && Boolean(fact.trim()))
                .map((fact) => fact.trim().slice(0, 300))
                .slice(0, 30),
            }
          : {}),
        throughTurnId: storedDirectorMemory.throughTurnId.slice(0, 180),
        sourceTurnCount: Math.max(0, Math.floor(storedDirectorMemory.sourceTurnCount)),
        updatedAtSeconds: Math.max(0, storedDirectorMemory.updatedAtSeconds),
      }
    : undefined
  const migratedEvents = [...events]
  const entityById = new Map(restoredEntities.map((entity) => [entity.id, entity]))
  for (const scenario of scenarios) {
    if (scenario.activeDialogue) continue
    const activeStage = scenario.stages.find((stage) => (
      stage.status === 'active'
      && stage.trigger.eventType === 'interaction'
      && stage.trigger.actorId
      && stage.trigger.targetId
    ))
    if (!activeStage?.trigger.actorId || !activeStage.trigger.targetId) continue
    const { actorId, targetId } = activeStage.trigger
    if (migratedEvents.some((event) => event.type === 'interaction' && event.actorId === actorId && event.targetId === targetId)) continue
    const stageOpenedAtSeconds = Math.max(0, ...scenario.stages
      .filter((stage) => stage.status === 'completed')
      .map((stage) => stage.completedAtSeconds ?? 0))
    const matchingTurn = [...directorTurns].reverse().find((turn) => (
      turn.createdAtSeconds >= stageOpenedAtSeconds
      && [...turn.entries].reverse().some((entry) => (
        entry.type === 'dialogue'
        && (
          (entry.speakerId === targetId && (!entry.listenerId || entry.listenerId === actorId))
          || (entry.speakerId === actorId && entry.listenerId === targetId)
        )
      ))
    ))
    if (!matchingTurn) continue
    migratedEvents.push({
      id: `migrated-director-dialogue-${scenario.id}-${activeStage.id}`,
      timeSeconds: matchingTurn.createdAtSeconds,
      type: 'interaction',
      actorId,
      actorName: entityById.get(actorId)?.name,
      targetId,
      targetName: entityById.get(targetId)?.name,
      commandType: 'interact',
      commandSource: 'player',
    })
  }

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `world-${planId}`,
    planId,
    randomSeed: isFiniteNumber(value.randomSeed) ? Math.floor(value.randomSeed) : 1,
    elapsedSeconds: isFiniteNumber(value.elapsedSeconds) ? Math.max(0, value.elapsedSeconds) : 0,
    paused: typeof value.paused === 'boolean' ? value.paused : false,
    entities: restoredEntities,
    parties,
    events: migratedEvents,
    pendingImpacts,
    scenarios,
    hiddenTargets,
    narrative: {
      processedEventIds: Array.isArray(narrative.processedEventIds)
        ? narrative.processedEventIds.filter((id): id is string => typeof id === 'string').slice(-1_000)
        : [],
      memoriesByEntityId: normalizeArrayRecord(narrative.memoriesByEntityId, isStoredMemory),
      cluesByEntityId: normalizeStoredClues(narrative.cluesByEntityId),
      relationshipsByEntityId: normalizeRelationships(narrative.relationshipsByEntityId),
      stories: Array.isArray(narrative.stories) ? narrative.stories.filter(isStoredStory).slice(-80) : [],
      directorTurns,
      ...(directorMemory ? { directorMemory } : {}),
    },
  } satisfies WorldState
}

const parseStoredDirectorCheckpoint = (
  value: unknown,
  planId: string,
): WorldDirectorCheckpoint | undefined => {
  if (!isRecord(value) || !isRecord(value.narrative) || !Array.isArray(value.directorTurnIds)) return undefined
  const parsedWorld = parseStoredWorldState({
    ...value,
    narrative: {
      ...value.narrative,
      directorTurns: [],
    },
  }, planId)
  if (!parsedWorld) return undefined
  const { directorTurns: _directorTurns, ...narrative } = parsedWorld.narrative
  void _directorTurns
  return {
    ...parsedWorld,
    narrative,
    directorTurnIds: value.directorTurnIds
      .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
      .map((id) => id.slice(0, 180))
      .slice(-100),
  }
}
