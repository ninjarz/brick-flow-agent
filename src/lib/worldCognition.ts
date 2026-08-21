import type { WorldClue, WorldEntity, WorldMemory, WorldState } from '../types/world'

const cjkPattern = /[\u3400-\u9fff]+/g
const wordPattern = /[a-z0-9][a-z0-9_-]*/gi

export const tokenizeWorldText = (text: string) => {
  const normalized = text.toLocaleLowerCase().trim()
  const tokens = new Set(normalized.match(wordPattern) ?? [])
  for (const run of normalized.match(cjkPattern) ?? []) {
    if (run.length <= 2) tokens.add(run)
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.add(run.slice(index, index + 2))
    }
  }
  return tokens
}

const tokenOverlap = (left: Set<string>, right: Set<string>) => {
  if (left.size === 0 || right.size === 0) return 0
  let count = 0
  left.forEach((token) => {
    if (right.has(token)) count += 1
  })
  return count / Math.max(1, Math.min(left.size, right.size))
}

const memorySearchText = (memory: WorldMemory) => [
  memory.type,
  memory.otherName,
  memory.content,
  ...(memory.tags ?? []),
].filter(Boolean).join(' ')

export type WorldMemoryFocus = {
  memory: WorldMemory
  score: number
  reasons: Array<'importance' | 'recent' | 'query' | 'relationship' | 'focus'>
}

export const retrieveWorldMemories = (
  world: WorldState,
  entityId: string,
  query = '',
  limit = 6,
): WorldMemoryFocus[] => {
  const entity = world.entities.find((candidate) => candidate.id === entityId)
  if (!entity) return []
  const activeGoal = entity.mind.goals[0]
  const focusTokens = tokenizeWorldText([query, activeGoal?.summary, entity.mind.spark.motive].filter(Boolean).join(' '))
  const relationships = world.narrative.relationshipsByEntityId[entityId] ?? {}
  return (world.narrative.memoriesByEntityId[entityId] ?? [])
    .map((memory): WorldMemoryFocus => {
      const reasons: WorldMemoryFocus['reasons'] = ['importance']
      const age = Math.max(0, world.elapsedSeconds - memory.timeSeconds)
      const recency = 1 / (1 + age / 75)
      if (recency >= 0.45) reasons.push('recent')
      const overlap = tokenOverlap(focusTokens, tokenizeWorldText(memorySearchText(memory)))
      if (overlap > 0) reasons.push('query')
      const relationship = memory.otherId ? relationships[memory.otherId] : undefined
      const relationshipWeight = relationship
        ? Math.max(
            Math.abs(relationship.affinity),
            relationship.trust ?? 0,
            relationship.hostility ?? 0,
            relationship.fear ?? 0,
          ) / 100
        : 0
      if (relationshipWeight >= 0.25) reasons.push('relationship')
      const matchesFocusTarget = Boolean(
        memory.otherId
        && activeGoal?.target?.kind === 'entity'
        && activeGoal.target.id === memory.otherId,
      )
      if (matchesFocusTarget) reasons.push('focus')
      const score = (
        memory.importance * 1.35
        + recency * 1.2
        + overlap * 3
        + relationshipWeight * 1.1
        + (matchesFocusTarget ? 1.4 : 0)
      )
      return { memory, score: Number(score.toFixed(3)), reasons }
    })
    .sort((left, right) => (
      right.score - left.score
      || right.memory.timeSeconds - left.memory.timeSeconds
      || left.memory.id.localeCompare(right.memory.id)
    ))
    .slice(0, Math.max(0, Math.min(12, Math.floor(limit))))
}

export type WorldClueFocus = {
  clue: WorldClue
  score: number
}

export const retrieveWorldClues = (
  world: WorldState,
  entityId: string,
  query = '',
  limit = 5,
): WorldClueFocus[] => {
  const entity = world.entities.find((candidate) => candidate.id === entityId)
  if (!entity) return []
  const queryTokens = tokenizeWorldText([query, entity.mind.goals[0]?.summary, entity.mind.spark.motive].filter(Boolean).join(' '))
  return (world.narrative.cluesByEntityId[entityId] ?? [])
    .map((clue) => {
      const age = Math.max(0, world.elapsedSeconds - clue.learnedAtSeconds)
      const recency = 1 / (1 + age / 180)
      const overlap = tokenOverlap(queryTokens, tokenizeWorldText([clue.text, ...clue.tags].join(' ')))
      const kindWeight = clue.kind === 'fact' ? 0.8 : clue.kind === 'secret' ? 0.55 : 0.35
      return {
        clue,
        score: Number((clue.confidence * 2 + overlap * 3 + recency + kindWeight).toFixed(3)),
      }
    })
    .sort((left, right) => (
      right.score - left.score
      || right.clue.learnedAtSeconds - left.clue.learnedAtSeconds
      || left.clue.id.localeCompare(right.clue.id)
    ))
    .slice(0, Math.max(0, Math.min(10, Math.floor(limit))))
}

export type WorldCognitionCandidate = {
  entityId: string
  score: number
  reasons: Array<'idle' | 'blocked' | 'threatened' | 'recent-event' | 'high-initiative' | 'active-focus'>
}

export type WorldReflection = {
  kind: 'relationship-pattern' | 'recurring-event'
  subjectId?: string
  eventType?: WorldMemory['type']
  count: number
  salience: number
  basisMemoryIds: string[]
  relationship?: {
    affinity: number
    trust: number
    hostility: number
    fear: number
  }
}

export const deriveWorldReflections = (
  world: WorldState,
  entityId: string,
  limit = 3,
): WorldReflection[] => {
  const memories = world.narrative.memoriesByEntityId[entityId] ?? []
  const reflections: WorldReflection[] = []
  for (const relationship of Object.values(world.narrative.relationshipsByEntityId[entityId] ?? {})) {
    const basisMemoryIds = memories
      .filter((memory) => memory.otherId === relationship.targetEntityId)
      .slice(-8)
      .map((memory) => memory.id)
    if (relationship.encounters < 2 || basisMemoryIds.length < 2) continue
    const trust = relationship.trust ?? Math.max(0, relationship.affinity)
    const hostility = relationship.hostility ?? Math.max(0, -relationship.affinity)
    const fear = relationship.fear ?? 0
    reflections.push({
      kind: 'relationship-pattern',
      subjectId: relationship.targetEntityId,
      count: relationship.encounters,
      salience: Number((
        Math.max(Math.abs(relationship.affinity), trust, hostility, fear) / 100
        + Math.min(1, relationship.encounters / 8)
      ).toFixed(3)),
      basisMemoryIds,
      relationship: {
        affinity: relationship.affinity,
        trust,
        hostility,
        fear,
      },
    })
  }
  const memoriesByType = new Map<WorldMemory['type'], WorldMemory[]>()
  for (const memory of memories) {
    memoriesByType.set(memory.type, [...(memoriesByType.get(memory.type) ?? []), memory])
  }
  for (const [eventType, grouped] of memoriesByType) {
    if (grouped.length < 3) continue
    reflections.push({
      kind: 'recurring-event',
      eventType,
      count: grouped.length,
      salience: Number((
        Math.min(1.5, grouped.length / 5)
        + grouped.reduce((sum, memory) => sum + memory.importance, 0) / grouped.length / 3
      ).toFixed(3)),
      basisMemoryIds: grouped.slice(-8).map((memory) => memory.id),
    })
  }
  return reflections
    .sort((left, right) => right.salience - left.salience || left.kind.localeCompare(right.kind))
    .slice(0, Math.max(0, Math.min(6, Math.floor(limit))))
}

export const rankWorldCognitionCandidates = (
  world: WorldState,
  limit = 4,
): WorldCognitionCandidate[] => {
  const hidden = new Set(world.hiddenTargets.flatMap((target) => target.kind === 'entity' ? [target.id] : []))
  const recentCutoff = world.elapsedSeconds - 8
  const recentEntityIds = new Set<string>()
  for (const event of world.events) {
    if (event.timeSeconds < recentCutoff) continue
    recentEntityIds.add(event.actorId)
    if (event.targetId) recentEntityIds.add(event.targetId)
  }
  return world.entities
    .filter((entity) => entity.health > 0 && !hidden.has(entity.id) && entity.controller !== 'player')
    .map((entity): WorldCognitionCandidate => {
      const reasons: WorldCognitionCandidate['reasons'] = []
      let score = entity.mind.spark.initiative * 1.5
      if (entity.mind.spark.initiative >= 0.65) reasons.push('high-initiative')
      if (!entity.activeCommand && entity.commandQueue.length === 0) {
        score += 1.2
        reasons.push('idle')
      }
      if (entity.behaviorState === 'blocked' || entity.navigation.status === 'blocked') {
        score += 2
        reasons.push('blocked')
      }
      if (entity.health / Math.max(1, entity.maxHealth) <= 0.4 || entity.combat.lastAttackerId) {
        score += 1.5
        reasons.push('threatened')
      }
      if (recentEntityIds.has(entity.id)) {
        score += 1.25
        reasons.push('recent-event')
      }
      if (entity.mind.goals[0]) {
        score += 0.75
        reasons.push('active-focus')
      }
      return { entityId: entity.id, score: Number(score.toFixed(3)), reasons }
    })
    .sort((left, right) => right.score - left.score || left.entityId.localeCompare(right.entityId))
    .slice(0, Math.max(0, Math.floor(limit)))
}

export const rankWorldSpeakers = (
  world: WorldState,
  listener: WorldEntity,
  text: string,
  limit = 3,
) => {
  const query = tokenizeWorldText(text)
  return world.entities
    .filter((entity) => entity.health > 0 && entity.id !== listener.id)
    .map((entity) => {
      const distance = Math.hypot(
        entity.transform.x - listener.transform.x,
        entity.transform.z - listener.transform.z,
      )
      const mentioned = query.has(entity.name.toLocaleLowerCase()) ? 2.5 : 0
      const relationship = world.narrative.relationshipsByEntityId[listener.id]?.[entity.id]
      const relationshipWeight = relationship
        ? Math.max(Math.abs(relationship.affinity), relationship.trust ?? 0, relationship.hostility ?? 0) / 100
        : 0
      const occupiedPenalty = entity.speech && entity.speech.expiresAtSeconds > world.elapsedSeconds ? 2 : 0
      return {
        entityId: entity.id,
        score: Number((
          mentioned
          + entity.mind.spark.initiative
          + relationshipWeight
          + 1 / (1 + distance / 8)
          - occupiedPenalty
        ).toFixed(3)),
      }
    })
    .sort((left, right) => right.score - left.score || left.entityId.localeCompare(right.entityId))
    .slice(0, Math.max(0, Math.floor(limit)))
}
