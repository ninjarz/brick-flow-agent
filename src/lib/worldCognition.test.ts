import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { deriveWorldReflections, rankWorldCognitionCandidates, retrieveWorldClues, retrieveWorldMemories, tokenizeWorldText } from './worldCognition'

const knightDefinition = worldEntityDefinitionById.get('knight')!
const archerDefinition = worldEntityDefinitionById.get('archer')!

describe('world cognition', () => {
  it('tokenizes Chinese phrases into stable local bigrams', () => {
    const tokens = tokenizeWorldText('旧采石场的灰白石粉')
    expect(tokens.has('采石')).toBe(true)
    expect(tokens.has('石粉')).toBe(true)
  })

  it('retrieves an older relevant memory ahead of unrelated recent noise', () => {
    const actor = createWorldEntity(knightDefinition, { id: 'roland', name: '罗兰' })
    actor.mind.goals = [{
      summary: '调查旧采石场',
      source: 'player',
      updatedAtSeconds: 98,
      status: 'active',
    }]
    const world = {
      ...createEmptyWorldState('cognition'),
      elapsedSeconds: 100,
      entities: [actor],
      narrative: {
        ...createEmptyWorldState('cognition').narrative,
        memoriesByEntityId: {
          [actor.id]: [
            {
              id: 'quarry',
              eventId: 'old',
              entityId: actor.id,
              timeSeconds: 20,
              type: 'interaction' as const,
              importance: 2 as const,
              content: '断箭带有旧采石场的灰白石粉',
              tags: ['旧采石场', '石粉'],
            },
            {
              id: 'drink',
              eventId: 'recent',
              entityId: actor.id,
              timeSeconds: 99,
              type: 'interaction' as const,
              importance: 1 as const,
              content: '玛拉收起了空酒杯',
              tags: ['酒杯'],
            },
          ],
        },
      },
    }

    const focused = retrieveWorldMemories(world, actor.id, '采石场在哪里')
    expect(focused[0].memory.id).toBe('quarry')
    expect(focused[0].reasons).toContain('query')
  })

  it('keeps private clues scoped to their holder', () => {
    const roland = createWorldEntity(knightDefinition, { id: 'roland', name: '罗兰' })
    const eileen = createWorldEntity(archerDefinition, { id: 'eileen', name: '艾琳' })
    const world = {
      ...createEmptyWorldState('clue-focus'),
      entities: [roland, eileen],
      narrative: {
        ...createEmptyWorldState('clue-focus').narrative,
        cluesByEntityId: {
          [eileen.id]: [{
            id: 'arrow',
            holderId: eileen.id,
            text: '断箭指向旧采石场',
            kind: 'fact' as const,
            confidence: 0.95,
            tags: ['断箭', '采石场'],
            learnedAtSeconds: 0,
          }],
        },
      },
    }
    expect(retrieveWorldClues(world, eileen.id, '断箭')).toHaveLength(1)
    expect(retrieveWorldClues(world, roland.id, '断箭')).toHaveLength(0)
  })

  it('prioritizes blocked autonomous characters but excludes player-controlled characters', () => {
    const autonomous = createWorldEntity(knightDefinition, { id: 'auto' })
    autonomous.navigation.status = 'blocked'
    autonomous.behaviorState = 'blocked'
    const player = createWorldEntity(knightDefinition, { id: 'player', controller: 'player' })
    const world = { ...createEmptyWorldState('cadence'), entities: [player, autonomous] }
    expect(rankWorldCognitionCandidates(world).map((candidate) => candidate.entityId)).toEqual(['auto'])
  })

  it('derives a lightweight reflection only after a pattern repeats', () => {
    const actor = createWorldEntity(knightDefinition, { id: 'actor' })
    const target = createWorldEntity(archerDefinition, { id: 'target' })
    const base = createEmptyWorldState('reflection')
    const world = {
      ...base,
      entities: [actor, target],
      narrative: {
        ...base.narrative,
        memoriesByEntityId: {
          [actor.id]: [1, 2, 3].map((index) => ({
            id: `memory-${index}`,
            eventId: `event-${index}`,
            entityId: actor.id,
            timeSeconds: index,
            type: 'interaction' as const,
            otherId: target.id,
            importance: 1 as const,
          })),
        },
        relationshipsByEntityId: {
          [actor.id]: {
            [target.id]: {
              targetEntityId: target.id,
              affinity: 35,
              trust: 45,
              hostility: 0,
              fear: 0,
              encounters: 3,
              lastEventType: 'interaction' as const,
              updatedAtSeconds: 3,
            },
          },
        },
      },
    }
    const reflections = deriveWorldReflections(world, actor.id)
    expect(reflections.some((reflection) => reflection.kind === 'relationship-pattern' && reflection.subjectId === target.id)).toBe(true)
    expect(reflections.some((reflection) => reflection.kind === 'recurring-event' && reflection.eventType === 'interaction')).toBe(true)
  })
})
