import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import type { WorldEvent, WorldScenarioRuntime } from '../types/world'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { advanceWorldScenarios } from './worldScenarioRuntime'

const commandEvent = (id: string, actorId: string, targetId: string): WorldEvent => ({
  id,
  timeSeconds: 1,
  type: 'command-issued',
  actorId,
  targetId,
  commandType: 'interact',
  commandSource: 'player',
})

describe('world scenario runtime', () => {
  it('advances one stage once and applies its actions', () => {
    const knight = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'knight', factionId: 'blue' })
    const stranger = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'stranger', factionId: 'neutral' })
    const scenario: WorldScenarioRuntime = {
      id: 'runtime',
      assetId: 'asset',
      title: 'Quest',
      description: 'Quest description',
      processedEventIds: [],
      stages: [{
        id: 'confront',
        title: 'Confront',
        description: 'Talk to the stranger',
        status: 'active',
        trigger: { eventType: 'command-issued', actorId: knight.id, targetId: stranger.id, commandType: 'interact' },
        actions: [
          { type: 'set-faction', entityId: stranger.id, factionId: 'red' },
          { type: 'issue-command', entityId: stranger.id, command: { type: 'attack', target: { kind: 'entity', id: knight.id } } },
          { type: 'add-story', title: 'A fight begins', body: 'The stranger draws a sword.', characterIds: [knight.id, stranger.id] },
        ],
      }],
    }
    const world = {
      ...createEmptyWorldState('plan'),
      entities: [knight, stranger],
      events: [commandEvent('event-1', knight.id, stranger.id)],
      scenarios: [scenario],
    }

    const advanced = advanceWorldScenarios(world)
    expect(advanced.scenarios[0].stages[0].status).toBe('completed')
    expect(advanced.scenarios[0].processedEventIds).toEqual(['event-1'])
    expect(advanced.entities.find((entity) => entity.id === stranger.id)?.factionId).toBe('red')
    expect(advanced.entities.find((entity) => entity.id === stranger.id)?.commandQueue[0]).toEqual({
      type: 'attack', target: { kind: 'entity', id: knight.id },
    })
    expect(advanced.narrative.stories.at(-1)?.title).toBe('A fight begins')
    expect(advanceWorldScenarios(advanced)).toBe(advanced)
  })
})
