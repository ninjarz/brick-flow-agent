import { describe, expect, it } from 'vitest'
import type { WorldScenarioRuntime } from '../types/world'
import {
  addWorldScenarioStage,
  deleteWorldScenarioStage,
  duplicateWorldScenarioStage,
  getWorldScenarioDefaultNextStageId,
  moveWorldScenarioStage,
  updateWorldScenarioStageTransition,
} from './worldScenarioAuthoring'

const makeScenario = (): WorldScenarioRuntime => ({
  id: 'story',
  assetId: 'asset',
  title: 'Story',
  description: 'Story',
  processedEventIds: [],
  stages: [
    { id: 'opening', title: 'Opening', description: 'Opening', status: 'active', trigger: { eventType: 'interaction' } },
    { id: 'battle', title: 'Battle', description: 'Battle', status: 'locked', trigger: { eventType: 'defeated' } },
  ],
})

describe('world scenario authoring', () => {
  it('adds and duplicates stages without sharing identifiers', () => {
    const added = addWorldScenarioStage(makeScenario(), 'en-US')
    expect(added.scenario.stages).toHaveLength(3)
    expect(added.scenario.stages.at(-1)?.status).toBe('locked')

    const duplicated = duplicateWorldScenarioStage(makeScenario(), 'opening', 'en-US')!
    expect(duplicated.scenario.stages.map((stage) => stage.id)).toEqual(['opening', 'opening-copy', 'battle'])
    expect(duplicated.scenario.stages[1].status).toBe('locked')

    const terminalScenario = makeScenario()
    terminalScenario.stages[0].nextStageId = null
    const duplicatedTerminal = duplicateWorldScenarioStage(terminalScenario, 'opening', 'en-US')!
    expect(duplicatedTerminal.scenario.stages[0].nextStageId).toBe('opening-copy')
    expect(duplicatedTerminal.scenario.stages[1].nextStageId).toBeNull()
  })

  it('repairs transitions and active state when deleting a stage', () => {
    const scenario = makeScenario()
    scenario.stages[0].nextStageId = 'battle'
    scenario.stages[1].status = 'active'
    scenario.stages[0].status = 'completed'
    const deleted = deleteWorldScenarioStage(scenario, 'battle')!
    expect(deleted.scenario.stages).toHaveLength(1)
    expect(deleted.scenario.stages[0].status).toBe('active')
    expect(deleted.scenario.stages[0].nextStageId).toBeNull()
  })

  it('supports automatic, explicit, and terminal default transitions', () => {
    let scenario = makeScenario()
    expect(getWorldScenarioDefaultNextStageId(scenario, 0)).toBe('battle')
    scenario = updateWorldScenarioStageTransition(scenario, 'opening', null)
    expect(getWorldScenarioDefaultNextStageId(scenario, 0)).toBeUndefined()
    scenario = updateWorldScenarioStageTransition(scenario, 'opening', 'battle')
    expect(getWorldScenarioDefaultNextStageId(scenario, 0)).toBe('battle')
    expect(moveWorldScenarioStage(scenario, 'battle', -1).stages.map((stage) => stage.id)).toEqual(['battle', 'opening'])
  })
})
