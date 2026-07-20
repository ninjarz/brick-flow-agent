import { describe, expect, it } from 'vitest'
import { createDefaultWorldScenarios } from '../data/worldScenarios'
import type { BuildPlan } from '../types/bricks'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { addWorldScenario, startWorldScenario } from './worldScenarioImport'
import { getBlockingBuildPlanIssues, makeBrick, validateBuildPlan } from './planUtils'

const deterministicIds = () => {
  let index = 0
  return (prefix: string) => `${prefix}-scenario-${index++}`
}

describe('world scenario import', () => {
  it('starts a self-contained scenario with remapped references', () => {
    const asset = createDefaultWorldScenarios('zh-CN')[0]
    const result = startWorldScenario(asset, deterministicIds())!

    expect(result.plan.id).not.toBe(asset.plan.id)
    expect(result.world.planId).toBe(result.plan.id)
    expect(result.world.entities).toHaveLength(4)
    expect(result.world.paused).toBe(true)
    expect(result.world.narrative.stories[0].characterIds).toEqual(result.importedEntityIds)
    expect(result.world.entities.flatMap((entity) => entity.commandQueue).some((command) => (
      'target' in command && command.target.kind === 'structure' && result.plan.structures?.some((structure) => structure.id === command.target.id)
    ))).toBe(true)
    expect(result.plan.bricks).toHaveLength(asset.plan.bricks.length)
    expect(getBlockingBuildPlanIssues(validateBuildPlan(result.plan))).toEqual([])
  })

  it('adds a scenario without replacing existing bricks, characters, or stories', () => {
    const currentBrick = makeBrick('brick-2x2', 'gray', 0, 0, 0)
    const currentPlan: BuildPlan = {
      id: 'current-plan',
      title: 'Current',
      prompt: 'Current',
      source: 'template-local',
      bricks: [currentBrick],
      steps: [{ id: 'current-step', title: 'Current', description: '', brickIds: [currentBrick.id] }],
    }
    const existing = createWorldEntity(worldEntityDefinitionById.get('knight')!, {
      id: 'existing-entity',
      name: '罗兰',
      transform: { x: -4, z: -4 },
    })
    const currentWorld = {
      ...createEmptyWorldState(currentPlan.id),
      entities: [existing],
      narrative: {
        ...createEmptyWorldState(currentPlan.id).narrative,
        stories: [{
          id: 'existing-story',
          title: 'Existing',
          body: 'Existing story',
          createdAtSeconds: 0,
          eventIds: [],
          characterIds: [existing.id],
          chapterNumber: 1,
          source: 'local' as const,
        }],
      },
    }

    const result = addWorldScenario(currentPlan, currentWorld, createDefaultWorldScenarios('zh-CN')[0], deterministicIds())!

    expect(result.plan.id).toBe(currentPlan.id)
    expect(result.plan.bricks[0]).toBe(currentBrick)
    expect(result.world.entities[0]).toBe(existing)
    expect(result.world.entities).toHaveLength(5)
    expect(new Set(result.world.entities.map((entity) => entity.id)).size).toBe(5)
    expect(new Set(result.world.entities.map((entity) => entity.name)).size).toBe(5)
    expect(result.world.narrative.stories.map((story) => story.id)).toContain('existing-story')
    expect(result.world.narrative.stories.at(-1)?.chapterNumber).toBe(2)
    expect(result.plan.bricks).toHaveLength(1 + createDefaultWorldScenarios('zh-CN')[0].plan.bricks.length)
    expect(getBlockingBuildPlanIssues(validateBuildPlan(result.plan))).toEqual([])
  })
})
