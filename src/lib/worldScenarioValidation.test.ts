import { describe, expect, it } from 'vitest'
import type { WorldScenarioRuntime } from '../types/world'
import { validateWorldScenario } from './worldScenarioValidation'

const validScenario = (): WorldScenarioRuntime => ({
  id: 'scenario',
  assetId: 'asset',
  title: 'Scenario',
  description: 'Scenario',
  castEntityIds: ['hero', 'envoy'],
  processedEventIds: [],
  stages: [
    {
      id: 'opening',
      title: 'Opening',
      description: 'Talk',
      status: 'active',
      trigger: { eventType: 'interaction', actorId: 'hero', targetId: 'envoy' },
      dialogue: [{ id: 'line', speakerId: 'envoy', text: 'Listen.', durationSeconds: 2 }],
      actions: [{ type: 'set-faction', entityId: 'envoy', factionId: 'red' }],
    },
    {
      id: 'battle',
      title: 'Battle',
      description: 'Fight',
      status: 'locked',
      trigger: { eventType: 'defeated', targetId: 'envoy' },
      actions: [{ type: 'set-visibility', target: { kind: 'structure', id: 'outpost' }, visible: true }],
    },
  ],
})

describe('world scenario validation', () => {
  it('accepts a connected scenario with valid references', () => {
    expect(validateWorldScenario(validScenario(), {
      entityIds: ['hero', 'envoy'],
      structureIds: ['outpost'],
    })).toEqual([])
  })

  it('reports missing references, unreachable stages, and broken jumps', () => {
    const scenario = validScenario()
    scenario.castEntityIds = ['hero', 'missing-cast']
    scenario.stages[0].nextStageId = 'missing-stage'
    scenario.stages[0].dialogue![0] = { ...scenario.stages[0].dialogue![0], speakerId: 'missing-speaker', text: '' }
    const issues = validateWorldScenario(scenario, {
      entityIds: ['hero', 'envoy'],
      structureIds: ['outpost'],
    })

    expect(issues.some((issue) => issue.code === 'missing-entity' && issue.referenceId === 'missing-cast')).toBe(true)
    expect(issues.some((issue) => issue.code === 'missing-entity' && issue.referenceId === 'missing-speaker')).toBe(true)
    expect(issues.some((issue) => issue.code === 'invalid-dialogue')).toBe(true)
    expect(issues.some((issue) => issue.code === 'missing-stage' && issue.referenceId === 'missing-stage')).toBe(true)
    expect(issues.some((issue) => issue.code === 'unreachable-stage' && issue.stageIndex === 1)).toBe(true)
  })

  it('detects duplicate identifiers and cyclic stage flow', () => {
    const scenario = validScenario()
    scenario.stages[1].nextStageId = scenario.stages[0].id
    scenario.stages[0].branches = [
      { id: 'same-branch', title: 'First', trigger: { eventType: 'interaction' } },
      { id: 'same-branch', title: 'Second', trigger: { eventType: 'defeated' } },
    ]
    const issues = validateWorldScenario(scenario, {
      entityIds: ['hero', 'envoy'],
      structureIds: ['outpost'],
    })

    expect(issues.some((issue) => issue.code === 'duplicate-branch-id')).toBe(true)
    expect(new Set(issues.filter((issue) => issue.code === 'cyclic-stage-flow').map((issue) => issue.stageIndex))).toEqual(new Set([0, 1]))
  })
})
