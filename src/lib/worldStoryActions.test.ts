import type { WorldState } from '../types/world'
import { stepWorldSimulation } from './worldSimulation'
import { upgradeGrayRavenCompanionStages } from './worldScenarioMigrations'
import { parseStoredWorldState } from './worldEntity'
import { describe, expect, it } from 'vitest'
import { createDefaultWorldScenarios } from '../data/worldScenarios'
import { startWorldScenario } from './worldScenarioImport'
import { advanceWorldScenarioDialogue, advanceWorldScenarios } from './worldScenarioRuntime'
import { getWorldStoryActions } from './worldStoryActions'

const setup = () => startWorldScenario(createDefaultWorldScenarios('zh-CN')[0])!.world
const beginDialogue = () => {
  const world = setup()
  const action = getWorldStoryActions(world)[0]
  const targetId = 'target' in action.command ? action.command.target.id : ''
  return advanceWorldScenarios({ ...world, events: [{ id: 'investigate', type: 'interaction', actorId: action.actorId, targetId, timeSeconds: world.elapsedSeconds }] })
}

describe('player-facing story actions', () => {
  it('offers the current investigation without leaking locked objectives or recruitment', () => {
    expect(getWorldStoryActions(setup()).map(action => action.label)).toEqual(['询问北路斥候'])
  })
  it('hides actions for paused authoring flows, hidden targets and unavailable actors', () => {
    const world = setup()
    expect(getWorldStoryActions({ ...world, scenarios: world.scenarios.map(scenario => ({ ...scenario, enabled: false })) })).toEqual([])
    const action = getWorldStoryActions(world)[0]
    expect(getWorldStoryActions({ ...world, hiddenTargets: [{ kind: 'entity', id: action.actorId }] })).toEqual([])
    expect(getWorldStoryActions({ ...world, entities: world.entities.map(entity => ({ ...entity, controller: 'ai' })) })).toEqual([])
  })
  it('advances one dialogue line without advancing simulation time or applying future consequences', () => {
    const world = beginDialogue()
    const scenario = world.scenarios.find(candidate => candidate.activeDialogue)!
    expect(getWorldStoryActions(world)).toEqual([])
    const next = advanceWorldScenarioDialogue(world, scenario.id)
    expect(next.elapsedSeconds).toBe(world.elapsedSeconds)
    expect(next.paused).toBe(world.paused)
    expect(next.scenarios.find(candidate => candidate.id === scenario.id)?.activeDialogue?.lineIndex).toBe(1)
    expect((next.narrative.cluesByEntityId[next.entities.find(entity => entity.controller === 'player')!.id] ?? []).filter(clue => clue.id === 'gray-raven-broken-arrow')).toHaveLength(0)
  })
  it('completes through the runtime, unlocks a meaningful optional companion, and applies effects once', () => {
    let world = beginDialogue()
    const scenarioId = world.scenarios.find(candidate => candidate.activeDialogue)!.id
    for (let i = 0; i < 3; i++) world = advanceWorldScenarioDialogue(world, scenarioId)
    expect(getWorldStoryActions(world).map(action => action.label)).toEqual(['对质黑岩使者', '邀请艾琳同行'])
    expect((world.narrative.cluesByEntityId[world.entities.find(entity => entity.controller === 'player')!.id] ?? []).filter(clue => clue.id === 'gray-raven-broken-arrow')).toHaveLength(1)
    expect(advanceWorldScenarioDialogue(world, scenarioId)).toBe(world)
  })
  it('keeps incoming NPC small talk from making a player recruitment decision', () => {
    let world = beginDialogue()
    const scenarioId = world.scenarios.find(candidate => candidate.activeDialogue)!.id
    for (let i = 0; i < 3; i++) world = advanceWorldScenarioDialogue(world, scenarioId)
    const invitation = getWorldStoryActions(world).find(action => action.label === '邀请艾琳同行')!
    const eileenId = 'target' in invitation.command ? invitation.command.target.id : ''
    let approaching: WorldState = {
      ...world, paused: false,
      entities: world.entities.filter(entity => [eileenId, invitation.actorId].includes(entity.id)).map(entity => entity.id === eileenId
        ? { ...entity, transform: { ...entity.transform, x: 1.4, z: 0 }, activeCommand: { type: 'interact', target: { kind: 'entity', id: invitation.actorId } }, commandQueue: [] }
        : { ...entity, transform: { ...entity.transform, x: 0, z: 0 }, activeCommand: undefined, commandQueue: [] }),
    }
    for (let i = 0; i < 10; i++) approaching = stepWorldSimulation(approaching, [], .1)
    expect(approaching.events.some(event => event.type === 'interaction' && event.actorId === eileenId && event.targetId === invitation.actorId)).toBe(true)
    expect(advanceWorldScenarios(approaching).scenarios.find(scenario => scenario.id !== scenarioId)?.activeDialogue).toBeUndefined()
    expect(getWorldStoryActions(parseStoredWorldState(approaching, approaching.planId)!).map(action => action.label)).toContain('邀请艾琳同行')
  })

  it.each([45, 60])('upgrades the legacy default requirement while preserving a custom threshold of %i', value => {
    const stage = setup().scenarios[1].stages[0]
    const oldStage = { ...stage, trigger: { ...stage.trigger, conditions: { mode: 'all' as const, conditions: [{ type: 'affinity' as const, actorId: stage.trigger.actorId!, targetId: stage.trigger.targetId!, comparison: 'gte' as const, value }] } } }
    const upgraded = upgradeGrayRavenCompanionStages([oldStage], '北路同行者', 3)[0]
    expect(upgraded.trigger.conditions?.conditions[0].type).toBe(value === 45 ? 'clue' : 'affinity')
  })
  it('restores already-earned investigation knowledge when upgrading a legacy save', () => {
    const world = setup()
    world.scenarios[0].stages[0].status = 'completed'
    world.scenarios[0].stages[1].status = 'active'
    world.scenarios[1].authoringVersion = 3
    world.narrative.cluesByEntityId = {}
    const restored = parseStoredWorldState(world, world.planId)!
    const heroId = world.scenarios[0].stages[0].trigger.actorId!
    expect(restored.narrative.cluesByEntityId[heroId]).toEqual([expect.objectContaining({ id: 'gray-raven-broken-arrow', holderId: heroId })])
    expect(parseStoredWorldState(restored, restored.planId)!.narrative.cluesByEntityId[heroId]).toHaveLength(1)
  })

})
