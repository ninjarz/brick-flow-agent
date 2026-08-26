import { describe, expect, it } from 'vitest'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { buildWorldScenarioAiPrompt, parseWorldScenarioAiResolution } from './worldScenarioAi'
import type { WorldScenarioRuntime } from '../types/world'

describe('world scenario AI', () => {
  it('builds a constrained prompt from a pending graph node', () => {
    const scenario: WorldScenarioRuntime = {
      id: 'flow',
      assetId: 'authored',
      title: 'Border mystery',
      description: 'Investigate the caravan.',
      processedEventIds: ['event'],
      pendingAi: { stageId: 'choice', eventId: 'event', requestedAtSeconds: 1 },
      stages: [{
        id: 'choice',
        title: 'Question the stranger',
        description: 'Decide whether he cooperates.',
        status: 'active',
        trigger: { eventType: 'interaction' },
        ai: {
          mode: 'choice',
          instruction: 'Use established trust to decide.',
          maxDialogueLines: 2,
          fallbackBranchId: 'refuse',
        },
        branches: [
          { id: 'help', title: 'He helps', aiGuidance: 'Trust is positive.', trigger: { eventType: 'interaction' } },
          { id: 'refuse', title: 'He refuses', aiGuidance: 'Trust is low.', trigger: { eventType: 'interaction' } },
        ],
      }],
    }
    const world = {
      ...createEmptyWorldState('prompt'),
      scenarios: [scenario, {
        id: 'other-flow',
        assetId: 'authored',
        title: 'Quarry alarm',
        description: 'A separate investigation.',
        processedEventIds: [],
        stages: [{
          id: 'alarm',
          title: 'Search the quarry',
          description: 'Search.',
          status: 'active' as const,
          trigger: { eventType: 'interaction' as const },
        }],
      }],
      events: [{ id: 'event', timeSeconds: 1, type: 'interaction' as const, actorId: 'hero' }],
    }

    const prompt = buildWorldScenarioAiPrompt(world, scenario, 'zh-CN')
    expect(prompt).toContain('Use established trust to decide.')
    expect(prompt).toContain('"id":"help"')
    expect(prompt).toContain('1 to 2 short dialogue lines')
    expect(prompt).toContain('Quarry alarm')
    expect(prompt).toContain('Search the quarry')
  })

  it('omits hidden characters from allowed AI speakers', () => {
    const visible = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'visible' })
    const hidden = createWorldEntity(worldEntityDefinitionById.get('knight')!, {
      id: 'hidden', name: 'Hidden Guard', description: 'A concealed watcher.',
    })
    const scenario: WorldScenarioRuntime = {
      id: 'flow',
      assetId: 'authored',
      title: 'Flow',
      description: 'Flow',
      processedEventIds: [],
      pendingAi: { stageId: 'node', eventId: 'event', requestedAtSeconds: 1 },
      stages: [{
        id: 'node',
        title: 'Node',
        description: 'Node',
        status: 'active',
        trigger: { eventType: 'interaction' },
        ai: { mode: 'dialogue', instruction: 'Speak.', speakerIds: [visible.id, hidden.id] },
      }],
    }
    const world = {
      ...createEmptyWorldState('hidden-speaker'),
      entities: [visible, hidden],
      scenarios: [scenario],
      hiddenTargets: [{ kind: 'entity' as const, id: hidden.id }],
    }

    const prompt = buildWorldScenarioAiPrompt(world, scenario, 'zh-CN')
    expect(prompt).toContain('"id":"visible"')
    expect(prompt).not.toContain('Hidden Guard')
    expect(prompt).not.toContain('"id":"hidden"')
  })

  it('parses fenced JSON while discarding malformed dialogue rows', () => {
    expect(parseWorldScenarioAiResolution(`\`\`\`json
{"branchId":"help","dialogue":[{"speakerId":"guide","text":"跟我来。"},{"speakerId":4,"text":"bad"}]}
\`\`\``)).toEqual({
      branchId: 'help',
      dialogue: [{ speakerId: 'guide', text: '跟我来。' }],
    })
  })
})
