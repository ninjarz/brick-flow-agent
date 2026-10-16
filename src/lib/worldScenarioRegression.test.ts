import { describe, expect, it } from 'vitest'
import { duplicateWorldScenarioStage } from './worldScenarioAuthoring'
import { validateWorldScenario } from './worldScenarioValidation'
import { advanceWorldScenarios, resolveWorldScenarioAi } from './worldScenarioRuntime'
import { buildWorldNarrativeFeed } from './worldNarrativeFeed'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { makeBrick } from './planUtils'
import type { BrickStructure, BuildPlan } from '../types/bricks'
import type { WorldScenarioRuntime } from '../types/world'

const scenario = (): WorldScenarioRuntime => ({
  id: 'flow', assetId: 'authored-flow', title: 'Flow', description: '', enabled: true,
  processedEventIds: [], stages: [{ id: 'start', title: 'Start', description: '', status: 'active', trigger: { eventType: 'interaction' }, nextStageId: null }],
})
const speaker = () => createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'speaker' })

describe('scenario review regressions', () => {
  it('remaps a duplicated AI fallback and executes it when AI fails', () => {
    const original = scenario()
    original.stages[0].ai = { mode: 'choice', instruction: 'Choose', fallbackBranchId: 'fallback' }
    original.stages[0].branches = [{ id: 'fallback', title: 'Fallback', trigger: { eventType: 'interaction' }, nextStageId: null }]
    const duplicated = duplicateWorldScenarioStage(original, 'start', 'en-US')!
    const copied = duplicated.scenario
    expect(validateWorldScenario(copied, { entityIds: [], structureIds: [] })).toEqual([])
    copied.stages[0].status = 'completed'
    copied.stages[1].status = 'active'
    copied.pendingAi = { stageId: duplicated.stageId, eventId: 'trigger', requestedAtSeconds: 0 }
    const resolved = resolveWorldScenarioAi({ ...createEmptyWorldState('plan'), scenarios: [copied] }, copied.id, {})
    expect(resolved.scenarios[0].outcomeId).toBe(copied.stages[1].branches![0].id)
    expect(original.stages[0].ai.fallbackBranchId).toBe('fallback')
  })

  it('shows AI dialogue instead of authored defaults and filters hidden speakers consistently', () => {
    const flow = scenario()
    flow.activeDialogue = { stageId: 'start', eventId: 'trigger', lineIndex: 0, lineEndsAtSeconds: 5, source: 'ai', generatedDialogue: [{ id: 'ai-line', speakerId: 'speaker', text: 'Generated line', durationSeconds: 5 }] }
    flow.stages[0].dialogue = [{ id: 'authored', speakerId: 'speaker', text: 'Different fallback', durationSeconds: 5 }]
    const world = { ...createEmptyWorldState('plan'), entities: [speaker()], scenarios: [flow] }
    expect(buildWorldNarrativeFeed(world)[0].blocks).toMatchObject([{ text: 'Generated line' }])
    world.hiddenTargets = [{ kind: 'entity', id: 'speaker' }]
    expect(buildWorldNarrativeFeed(world)).toEqual([])
    expect(advanceWorldScenarios(world).scenarios[0].activeDialogue).toBeUndefined()
  })

  it.each([{ kind: 'brick', delay: 0 }, { kind: 'structure', delay: 0 }, { kind: 'brick', delay: 1 }, { kind: 'structure', delay: 1 }] as const)('issues a validated $kind attack with delay $delay', ({ kind, delay }) => {
    const entity = speaker()
    const brick = makeBrick('brick-1x1', 'gray', 5, 0, 0)
    const structure: BrickStructure = { id: 'fort', name: 'Fort', description: '', brickIds: [brick.id] }
    const plan: Pick<BuildPlan, 'bricks' | 'structures'> = { bricks: [brick], structures: [structure] }
    const flow = scenario()
    const target = { kind, id: kind === 'brick' ? brick.id : structure.id }
    flow.stages[0].actions = [{ type: 'issue-command', delaySeconds: delay, entityId: entity.id, command: { type: 'attack', target } }]
    let next = advanceWorldScenarios({ ...createEmptyWorldState('plan'), entities: [entity], scenarios: [flow], events: [{ id: 'trigger', type: 'interaction', actorId: entity.id, timeSeconds: 0 }] }, { plan })
    if (delay) next = advanceWorldScenarios({ ...next, elapsedSeconds: delay + 1 }, { plan })
    expect(next.entities[0].commandQueue).toContainEqual({ type: 'attack', target })
    expect(next.events.some((event) => event.type === 'command-issued')).toBe(true)
  })

  it('keeps a diagnostic when the scenario command target is unavailable', () => {
    const flow = scenario()
    flow.stages[0].actions = [{ type: 'issue-command', entityId: 'speaker', command: { type: 'attack', target: { kind: 'structure', id: 'missing' } } }]
    const next = advanceWorldScenarios({ ...createEmptyWorldState('plan'), entities: [speaker()], scenarios: [flow], events: [{ id: 'trigger', type: 'interaction', actorId: 'speaker', timeSeconds: 0 }] })
    expect(next.narrative.stories.at(-1)?.body).toContain('TARGET_NOT_FOUND')
  })

  it('retains the plan target context when an AI fallback issues a structure command', () => {
    const entity = speaker()
    const brick = makeBrick('brick-1x1', 'gray', 5, 0, 0)
    const flow = scenario()
    flow.stages[0].ai = { mode: 'choice', instruction: 'Choose', fallbackBranchId: 'fallback' }
    flow.stages[0].branches = [{ id: 'fallback', title: 'Fallback', trigger: { eventType: 'interaction' }, nextStageId: null, actions: [{ type: 'issue-command', entityId: entity.id, command: { type: 'attack', target: { kind: 'structure', id: 'fort' } } }] }]
    flow.pendingAi = { stageId: 'start', eventId: 'trigger', requestedAtSeconds: 0 }
    const next = resolveWorldScenarioAi({ ...createEmptyWorldState('plan'), entities: [entity], scenarios: [flow] }, flow.id, {}, { bricks: [brick], structures: [{ id: 'fort', name: 'Fort', description: '', brickIds: [brick.id] }] })
    expect(next.entities[0].commandQueue).toContainEqual({ type: 'attack', target: { kind: 'structure', id: 'fort' } })
  })

})
