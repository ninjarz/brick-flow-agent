import { describe, expect, it } from 'vitest'
import type { WorldScenarioRuntime, WorldState } from '../types/world'
import { beginWorldScenarioPlaytest, finishWorldScenarioPlaytest } from './worldScenarioPlaytest'

const scenario: WorldScenarioRuntime = { id: 'flow', assetId: 'test', title: '', description: '', stages: [{ id: 'a', title: 'A', description: '', status: 'completed', trigger: { eventType: 'interaction' } }, { id: 'b', title: 'B', description: '', status: 'locked', trigger: { eventType: 'interaction' } }], processedEventIds: [] }
const world: WorldState = { id: 'world', planId: 'plan', randomSeed: 1, elapsedSeconds: 4, paused: false, entities: [], parties: [], events: [], pendingImpacts: [], hiddenTargets: [], scenarios: [scenario], narrative: { processedEventIds: [], memoriesByEntityId: {}, cluesByEntityId: {}, relationshipsByEntityId: {}, stories: [], directorTurns: [] } }

describe('scenario playtest', () => {
  it('isolates a selected node and restores the complete checkpoint', () => {
    const playtest = beginWorldScenarioPlaytest(world, scenario, 'b')!
    expect(playtest.world.paused).toBe(true)
    expect(playtest.world.scenarios[0].enabled).toBe(true)
    expect(playtest.world.scenarios[0].stages.map((stage) => stage.status)).toEqual(['locked', 'active'])
    const mutated = { ...playtest.world, hiddenTargets: [{ kind: 'brick' as const, id: 'door' }] }
    void mutated
    expect(finishWorldScenarioPlaytest(playtest.session)).toEqual(world)
  })

  it('refuses an unknown node without mutating the input world', () => {
    expect(beginWorldScenarioPlaytest(world, scenario, 'missing')).toBeUndefined()
    expect(world.scenarios[0]).toBe(scenario)
  })
})
