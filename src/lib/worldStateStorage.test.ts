import { describe, expect, it } from 'vitest'
import { createEmptyWorldState, createWorldEntity, parseStoredWorldState } from './worldEntity'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { stepWorldSimulation } from './worldSimulation'

describe('stored world event validation', () => {
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
