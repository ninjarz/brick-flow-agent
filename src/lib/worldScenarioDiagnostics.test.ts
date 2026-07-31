import { describe, expect, it } from 'vitest'
import { createDefaultWorldScenarios } from '../data/worldScenarios'
import type { WorldScenarioRuntime } from '../types/world'
import { createEmptyWorldState, joinWorldParty } from './worldEntity'
import { startWorldScenario } from './worldScenarioImport'
import {
  analyzeWorldEncounterBalance,
  inspectWorldScenarioRuntime,
  runWorldScenarioScript,
} from './worldScenarioDiagnostics'

const deterministicIds = () => {
  let index = 0
  return (prefix: string) => `${prefix}-diagnostic-${index++}`
}

describe('world scenario diagnostics', () => {
  it('runs the authored Gray Raven main flow without a browser or manual timing', () => {
    const loaded = startWorldScenario(createDefaultWorldScenarios('zh-CN')[0], deterministicIds())!
    const [, rolandId, eileenId, envoyId] = loaded.importedEntityIds
    const result = runWorldScenarioScript(loaded.world, [
      { id: 'investigate', timeSeconds: 1, type: 'interaction', actorId: rolandId, targetId: eileenId },
      { id: 'confront', timeSeconds: 20, type: 'interaction', actorId: rolandId, targetId: envoyId },
      { id: 'victory', timeSeconds: 50, type: 'defeated', actorId: rolandId, targetId: envoyId },
    ])

    expect(result.stalled).toBe(false)
    expect(result.issues).toEqual([])
    expect(result.world.scenarios[0].outcomeId).toBe('completed')
    expect(result.world.scenarios[0].stages.every((stage) => stage.status === 'completed')).toBe(true)
  })

  it('rates the envoy as hard alone and favorable after recruiting Eileen', () => {
    const loaded = startWorldScenario(createDefaultWorldScenarios('zh-CN')[0], deterministicIds())!
    const [, rolandId, eileenId, envoyId] = loaded.importedEntityIds
    const solo = analyzeWorldEncounterBalance(loaded.world, rolandId, envoyId)
    expect(solo?.rating).toBe('hard')

    const partyWorld = joinWorldParty(loaded.world, eileenId, rolandId)
    const party = analyzeWorldEncounterBalance(partyWorld, rolandId, envoyId)
    expect(party?.partyEntityIds).toEqual([rolandId, eileenId])
    expect(party?.rating).toBe('favorable')
    expect(party!.advantageRatio).toBeGreaterThan(solo!.advantageRatio)
  })

  it('reports broken persisted playback references', () => {
    const scenario: WorldScenarioRuntime = {
      id: 'broken',
      assetId: 'authored',
      title: 'Broken',
      description: 'Broken',
      processedEventIds: [],
      activeDialogue: {
        stageId: 'missing-stage',
        eventId: 'event',
        lineIndex: 0,
        lineEndsAtSeconds: 1,
      },
      queuedTransition: {
        stageId: 'stage',
        eventId: 'missing-event',
        queuedAtSeconds: 0,
      },
      stages: [{
        id: 'stage',
        title: 'Stage',
        description: 'Stage',
        status: 'active',
        trigger: { eventType: 'interaction' },
      }],
    }
    const issues = inspectWorldScenarioRuntime({
      ...createEmptyWorldState('diagnostics'),
      scenarios: [scenario],
    })
    expect(issues.map((issue) => issue.code)).toEqual([
      'DIALOGUE_STAGE_MISSING',
      'QUEUED_EVENT_MISSING',
    ])
  })

  it('reports corrupted saves with more than one performance-lane owner', () => {
    const makeScenario = (id: string): WorldScenarioRuntime => ({
      id,
      assetId: 'authored',
      title: id,
      description: id,
      processedEventIds: [],
      pendingAi: { stageId: 'stage', eventId: `${id}-event`, requestedAtSeconds: 0 },
      stages: [{
        id: 'stage',
        title: 'Stage',
        description: 'Stage',
        status: 'active',
        trigger: { eventType: 'interaction' },
        ai: { mode: 'dialogue', instruction: 'Talk' },
      }],
    })
    const issues = inspectWorldScenarioRuntime({
      ...createEmptyWorldState('multiple-owners'),
      scenarios: [makeScenario('first'), makeScenario('second')],
    })

    expect(issues).toContainEqual(expect.objectContaining({
      code: 'MULTIPLE_PERFORMANCE_OWNERS',
    }))
  })

  it('advances the maximum supported flow count against a full event history quickly', () => {
    const scenarios: WorldScenarioRuntime[] = Array.from({ length: 20 }, (_, index) => ({
      id: `flow-${index}`,
      assetId: 'authored',
      title: `Flow ${index}`,
      description: `Flow ${index}`,
      processedEventIds: [],
      stages: [{
        id: 'start',
        title: 'Start',
        description: 'Start',
        status: 'active',
        trigger: { eventType: 'interaction', actorId: 'hero', targetId: `target-${index}` },
      }],
    }))
    const events = Array.from({ length: 500 }, (_, index) => ({
      id: `event-${index}`,
      timeSeconds: index,
      type: 'interaction' as const,
      actorId: 'hero',
      targetId: `target-${index % scenarios.length}`,
    }))
    const startedAt = performance.now()
    const result = runWorldScenarioScript({
      ...createEmptyWorldState('performance'),
      scenarios,
      events: events.slice(0, -20),
    }, events.slice(-20))
    const elapsedMs = performance.now() - startedAt

    expect(result.stalled).toBe(false)
    expect(result.world.scenarios.every((scenario) => scenario.outcomeId === 'completed')).toBe(true)
    expect(result.world.events).toHaveLength(500)
    expect(elapsedMs).toBeLessThan(250)
  })
})
