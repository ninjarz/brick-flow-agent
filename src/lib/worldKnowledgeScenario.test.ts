import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { grantWorldClue } from './worldClues'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { advanceWorldScenarios, evaluateWorldScenarioConditions } from './worldScenarioRuntime'

const definition = worldEntityDefinitionById.get('knight')!

describe('knowledge-driven scenarios', () => {
  it('checks clue ownership and confidence without leaking between characters', () => {
    const roland = createWorldEntity(definition, { id: 'roland' })
    const eileen = createWorldEntity(definition, { id: 'eileen' })
    let world = { ...createEmptyWorldState('knowledge'), entities: [roland, eileen] }
    world = {
      ...world,
      narrative: grantWorldClue(world.narrative, {
        id: 'arrow',
        holderId: eileen.id,
        text: '断箭来自旧采石场',
        kind: 'fact',
        confidence: 0.9,
        tags: ['断箭'],
        learnedAtSeconds: 0,
      }),
    }
    const condition = {
      mode: 'all' as const,
      conditions: [{ type: 'clue' as const, entityId: eileen.id, clueId: 'arrow', minimumConfidence: 0.8 }],
    }
    expect(evaluateWorldScenarioConditions(world, condition)).toBe(true)
    expect(evaluateWorldScenarioConditions(world, {
      ...condition,
      conditions: [{ ...condition.conditions[0], entityId: roland.id }],
    })).toBe(false)
  })

  it('grants authored knowledge only after its trigger is consumed', () => {
    const roland = createWorldEntity(definition, { id: 'roland' })
    const eileen = createWorldEntity(definition, { id: 'eileen' })
    const event = {
      id: 'talk',
      timeSeconds: 1,
      type: 'interaction' as const,
      actorId: roland.id,
      targetId: eileen.id,
    }
    const world = {
      ...createEmptyWorldState('grant'),
      entities: [roland, eileen],
      events: [event],
      scenarios: [{
        id: 'flow',
        assetId: 'flow',
        title: 'Flow',
        description: 'Flow',
        processedEventIds: [],
        stages: [{
          id: 'learn',
          title: 'Learn',
          description: 'Learn',
          status: 'active' as const,
          trigger: { eventType: 'interaction' as const, actorId: roland.id, targetId: eileen.id },
          actions: [{
            type: 'grant-clue' as const,
            entityId: roland.id,
            clue: {
              id: 'arrow',
              text: '断箭来自旧采石场',
              kind: 'fact' as const,
              confidence: 0.95,
              tags: ['断箭'],
            },
          }],
        }],
      }],
    }
    const advanced = advanceWorldScenarios(world, { enableAi: false })
    expect(advanced.narrative.cluesByEntityId[roland.id][0]).toMatchObject({
      id: 'arrow',
      holderId: roland.id,
      sourceEventId: event.id,
    })
  })
})
