import { describe, expect, it } from 'vitest'
import { createDefaultWorldScenarios } from '../data/worldScenarios'
import type { BuildPlan } from '../types/bricks'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { addWorldScenario, startWorldScenario } from './worldScenarioImport'
import { advanceWorldScenarios } from './worldScenarioRuntime'
import { getBlockingBuildPlanIssues, makeBrick, validateBuildPlan } from './planUtils'

const deterministicIds = () => {
  let index = 0
  return (prefix: string) => `${prefix}-scenario-${index++}`
}

describe('world scenario import', () => {
  const finishDialogue = (world: ReturnType<typeof createEmptyWorldState>) => {
    let next = world
    while (next.scenarios.some((scenario) => scenario.activeDialogue)) {
      const endsAt = next.scenarios.find((scenario) => scenario.activeDialogue)?.activeDialogue?.lineEndsAtSeconds ?? next.elapsedSeconds
      next = advanceWorldScenarios({ ...next, elapsedSeconds: endsAt })
    }
    return next
  }

  it('starts a self-contained scenario with remapped references', () => {
    const asset = createDefaultWorldScenarios('zh-CN')[0]
    const result = startWorldScenario(asset, deterministicIds())!

    expect(result.plan.id).not.toBe(asset.plan.id)
    expect(result.world.planId).toBe(result.plan.id)
    expect(result.world.entities).toHaveLength(4)
    expect(result.world.paused).toBe(true)
    expect(result.world.narrative.stories[0].characterIds).toEqual(result.importedEntityIds)
    expect(result.world.scenarios).toHaveLength(1)
    expect(result.world.entities.every((entity) => entity.storylineId === result.world.scenarios[0].id)).toBe(true)
    expect(result.world.scenarios[0].castEntityIds).toEqual(result.importedEntityIds)
    expect(result.world.scenarios[0].stages.map((stage) => stage.status)).toEqual(['active', 'locked', 'locked'])
    expect(result.world.scenarios[0].stages[0].trigger.actorId).toBe(result.importedEntityIds[1])
    expect(result.world.scenarios[0].stages[0].trigger.targetId).toBe(result.importedEntityIds[2])
    expect(result.world.entities[1].controller).toBe('player')
    expect(result.world.entities[3].factionId).toBe('neutral')
    expect(result.world.hiddenTargets).toHaveLength(2)
    expect(result.world.hiddenTargets.every((target) => target.kind === 'structure')).toBe(true)
    expect(result.plan.structures).toHaveLength(4)
    expect(result.world.hiddenTargets.every((target) => (
      target.kind === 'structure' && result.plan.structures?.some((structure) => structure.id === target.id)
    ))).toBe(true)
    expect(result.world.entities.flatMap((entity) => entity.commandQueue).some((command) => (
      'target' in command && command.target.kind === 'entity' && result.importedEntityIds.includes(command.target.id)
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
    expect(result.world.scenarios).toHaveLength(1)
    expect(result.world.scenarios[0].stages[1].actions).toContainEqual({
      type: 'issue-command',
      entityId: result.importedEntityIds[3],
      command: { type: 'attack', target: { kind: 'entity', id: result.importedEntityIds[1] } },
    })
    expect(result.world.scenarios[0].stages[2].branches?.[0]).toMatchObject({
      id: 'gray-raven-retreat',
      trigger: { eventType: 'defeated', targetId: result.importedEntityIds[1] },
    })
    expect(result.plan.bricks).toHaveLength(1 + createDefaultWorldScenarios('zh-CN')[0].plan.bricks.length)
    expect(getBlockingBuildPlanIssues(validateBuildPlan(result.plan))).toEqual([])
  })

  it('plays the Gray Raven investigation through confrontation and defense', () => {
    const result = startWorldScenario(createDefaultWorldScenarios('zh-CN')[0], deterministicIds())!
    const [, rolandId, eileenId, envoyId] = result.importedEntityIds
    let world = advanceWorldScenarios({
      ...result.world,
      events: [{ id: 'investigated', timeSeconds: 2, type: 'interaction', actorId: rolandId, targetId: eileenId }],
    })
    expect(world.scenarios[0].activeDialogue?.lineIndex).toBe(0)
    world = finishDialogue(world)
    expect(world.scenarios[0].stages.map((stage) => stage.status)).toEqual(['completed', 'active', 'locked'])
    expect(world.narrative.stories.at(-1)?.title).toContain('断箭')
    expect(world.hiddenTargets).toHaveLength(1)

    world = advanceWorldScenarios({
      ...world,
      events: [...world.events, { id: 'confronted', timeSeconds: 4, type: 'interaction', actorId: rolandId, targetId: envoyId }],
    })
    expect(world.entities.find((entity) => entity.id === envoyId)?.factionId).toBe('neutral')
    expect(world.entities.find((entity) => entity.id === rolandId)?.speech?.text).toContain('商队')
    world = finishDialogue(world)
    expect(world.scenarios[0].stages.map((stage) => stage.status)).toEqual(['completed', 'completed', 'active'])
    expect(world.entities.find((entity) => entity.id === envoyId)?.factionId).toBe('red')
    expect(world.entities.find((entity) => entity.id === envoyId)?.commandQueue[0]).toEqual({
      type: 'attack', target: { kind: 'entity', id: rolandId },
    })
    expect(world.hiddenTargets).toEqual([])

    world = advanceWorldScenarios({
      ...world,
      events: [...world.events, { id: 'defended', timeSeconds: 9, type: 'defeated', actorId: rolandId, targetId: envoyId }],
    })
    expect(world.scenarios[0].stages.every((stage) => stage.status === 'completed')).toBe(true)
    expect(world.narrative.stories.at(-1)?.title).toContain('黎明')
  })
})
