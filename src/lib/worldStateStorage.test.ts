import { describe, expect, it } from 'vitest'
import { createEmptyWorldState, createWorldEntity, parseStoredWorldState } from './worldEntity'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { stepWorldSimulation } from './worldSimulation'
import { createDefaultWorldScenarios } from '../data/worldScenarios'
import { startWorldScenario } from './worldScenarioImport'
import type { WorldDirectorTurn } from '../types/world'

describe('stored world event validation', () => {
  it.each([
    ['autonomous', 'completed', false],
    ['player', 'failed', false],
    ['player', 'completed', true],
    [undefined, 'completed', true],
  ] as const)('restores interaction from origin %s and status %s: %s', (origin, status, expected) => {
    const world = startWorldScenario(createDefaultWorldScenarios('zh-CN')[0])!.world
    const trigger = world.scenarios[0].stages.find(stage => stage.status === 'active')!.trigger
    const turn: WorldDirectorTurn = {
      id: 'turn', playerText: 'Talk to the scout', origin, status, createdAtSeconds: 1,
      entries: [{ id: 'line', type: 'dialogue', speakerId: trigger.targetId!, listenerId: trigger.actorId, text: 'Hello' }],
    }
    world.events = []
    world.narrative.directorTurns = [turn]
    const restored = parseStoredWorldState(world, world.planId)!
    expect(restored.events.some(event => event.id.startsWith('migrated-director-dialogue-'))).toBe(expected)
    expect(parseStoredWorldState(restored, world.planId)!.events).toEqual(restored.events)
  })

  it('cleans optional text, enums, numbers and vectors before simulation consumes them', () => {
    const entity = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'actor' })
    const restored = parseStoredWorldState({ ...createEmptyWorldState('plan'), entities: [entity], events: [{
      id: 'event', type: 'interaction', timeSeconds: 0, actorId: entity.id,
      actorName: 17, targetName: {}, commandType: { toString: 'bad' }, objectAction: false,
      amount: Infinity, origin: { x: 1e18, y: 0, z: 0 }, projectileKind: 'other',
      dialogueText: 'valid', extra: { unwanted: true },
    }] }, 'plan')!
    expect(restored.events[0]).toEqual({ id: 'event', type: 'interaction', timeSeconds: 0, actorId: 'actor', dialogueText: 'valid' })
    expect(() => stepWorldSimulation(restored, [])).not.toThrow()
  })
})
