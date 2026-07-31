import { describe, expect, it } from 'vitest'
import type { WorldScenarioRuntime } from '../types/world'
import { getWorldScenarioPlaybackLane, getWorldScenarioRuntimeStatus, orderWorldScenariosForEvaluation } from './worldScenarioScheduler'

const scenario = (id: string, priority = 0): WorldScenarioRuntime => ({
  id,
  assetId: 'test',
  title: id,
  description: id,
  priority,
  processedEventIds: [],
  stages: [{
    id: 'stage',
    title: 'Stage',
    description: 'Stage',
    status: 'active',
    trigger: { eventType: 'interaction' },
  }],
})

describe('world scenario scheduler', () => {
  it('reports a single performance owner and a fair queued order', () => {
    const owner = {
      ...scenario('owner', 20),
      pendingAi: { stageId: 'stage', eventId: 'owner-event', requestedAtSeconds: 4 },
    }
    const older = {
      ...scenario('older', 1),
      queuedTransition: { stageId: 'stage', eventId: 'older-event', queuedAtSeconds: 5 },
    }
    const newer = {
      ...scenario('newer', 100),
      queuedTransition: { stageId: 'stage', eventId: 'newer-event', queuedAtSeconds: 8 },
    }
    const lane = getWorldScenarioPlaybackLane({ scenarios: [newer, owner, older] })

    expect(lane.owner).toMatchObject({ scenarioId: 'owner', kind: 'ai' })
    expect(lane.queued.map((item) => item.scenarioId)).toEqual(['older', 'newer'])
    expect(orderWorldScenariosForEvaluation([newer, owner, older]).map((item) => item.scenario.id))
      .toEqual(['owner', 'older', 'newer'])
  })

  it('distinguishes queued, performing, paused, and completed flows', () => {
    expect(getWorldScenarioRuntimeStatus({
      ...scenario('queued'),
      queuedTransition: { stageId: 'stage', eventId: 'event', queuedAtSeconds: 1 },
    })).toBe('queued')
    expect(getWorldScenarioRuntimeStatus({
      ...scenario('dialogue'),
      activeDialogue: { stageId: 'stage', eventId: 'event', lineIndex: 0, lineEndsAtSeconds: 2 },
    })).toBe('dialogue')
    expect(getWorldScenarioRuntimeStatus({ ...scenario('paused'), enabled: false })).toBe('paused')
    expect(getWorldScenarioRuntimeStatus({
      ...scenario('done'),
      stages: scenario('done').stages.map((stage) => ({ ...stage, status: 'completed' as const })),
    })).toBe('completed')
  })
})
