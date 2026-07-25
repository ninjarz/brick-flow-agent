import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { applyTavernAiResponse, buildTavernAiPrompt, parseTavernAiResponse } from './worldTavernAi'
import { playTavernActivity } from './worldTavernActivities'

const makeBase = () => {
  const first = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'roland', name: '罗兰' })
  const second = createWorldEntity(worldEntityDefinitionById.get('archer')!, { id: 'eileen', name: '艾琳' })
  const world = { ...createEmptyWorldState('plan'), elapsedSeconds: 20, entities: [first, second] }
  return { world, base: playTavernActivity(world, 'dice', 'zh-CN', first.id, () => 0.4)! }
}

describe('AI tavern director', () => {
  it('accepts only one concise line per known participant', () => {
    const parsed = parseTavernAiResponse({
      title: '断箭骰局',
      narration: '骰子停下时，两人都看向了门外。',
      lines: [
        { speakerId: 'roland', text: '这一点数让我想起那支断箭。' },
        { speakerId: 'roland', text: '重复台词不应进入。' },
        { speakerId: 'invented', text: '陌生人不应进入。' },
        { speakerId: 'eileen', text: '先把酒喝完。' },
      ],
    }, ['roland', 'eileen'])
    expect(parsed?.lines).toEqual([
      { speakerId: 'roland', text: '这一点数让我想起那支断箭。' },
      { speakerId: 'eileen', text: '先把酒喝完。' },
    ])
  })

  it('rejects response-level extra state mutation fields', () => {
    expect(parseTavernAiResponse({
      title: '作弊', narration: '', lines: [], health: 0,
    }, ['roland'])).toBeUndefined()
  })

  it('preserves the rule result while replacing presentation and the matching story', () => {
    const { world, base } = makeBase()
    const currentWorld = { ...base.world, elapsedSeconds: 24 }
    const result = applyTavernAiResponse(currentWorld, base, {
      title: '命运落杯',
      narration: '炉火噼啪一响，像是在替胜者鼓掌。',
      lines: [
        { speakerId: 'roland', text: '看来今晚运气不错。' },
        { speakerId: 'eileen', text: '下一局可没这么容易。' },
      ],
    })
    expect(result.body).toContain(base.body)
    expect(result.body).toContain('炉火噼啪')
    expect(result.source).toBe('ai')
    expect(result.world.narrative.stories.find((story) => story.id === base.storyId)).toMatchObject({
      title: '命运落杯', source: 'ai',
    })
    expect(result.world.entities.map((entity) => entity.speech?.text)).toEqual([
      '看来今晚运气不错。', '下一局可没这么容易。',
    ])
    expect(world.narrative.stories).toHaveLength(0)
  })

  it('builds a prompt with immutable results and no unrelated character roster', () => {
    const { world, base } = makeBase()
    const outsider = createWorldEntity(worldEntityDefinitionById.get('priest')!, { id: 'outsider', name: '局外人' })
    const prompt = buildTavernAiPrompt({ ...world, entities: [...world.entities, outsider] }, 'dice', base, 'zh-CN')
    expect(prompt).toContain(base.body)
    expect(prompt).toContain('罗兰')
    expect(prompt).not.toContain('局外人')
    expect(prompt).toContain('Never contradict dice rolls')
  })
})
