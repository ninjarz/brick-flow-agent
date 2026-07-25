import { describe, expect, it } from 'vitest'
import { worldEntityDefinitions } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { playTavernActivity } from './worldTavernActivities'

const makeWorld = () => {
  const first = createWorldEntity(worldEntityDefinitions[0], { name: '罗兰' })
  const second = createWorldEntity(worldEntityDefinitions[1], { name: '艾琳' })
  return { ...createEmptyWorldState('plan'), elapsedSeconds: 12, entities: [first, second] }
}

describe('playTavernActivity', () => {
  it('plays dice, adds a chapter, and pauses participants for their bubbles', () => {
    const world = makeWorld()
    const rolls = [0, 0.1, 0.8]
    const result = playTavernActivity(world, 'dice', 'zh-CN', world.entities[0].id, () => rolls.shift() ?? 0)
    expect(result?.body).toContain('3 点')
    expect(result?.body).toContain('17 点')
    expect(result?.world.narrative.stories).toHaveLength(1)
    expect(result?.world.narrative.stories[0].characterIds).toEqual(world.entities.map((entity) => entity.id))
    expect(result?.world.entities.every((entity) => entity.speech?.message === 'scenario-dialogue')).toBe(true)
    expect(result?.world.entities.every((entity) => entity.autonomy.nextDecisionAtSeconds >= 19)).toBe(true)
  })

  it('never chooses defeated or story-hidden characters', () => {
    const world = makeWorld()
    const hiddenTarget = world.entities[1]
    const result = playTavernActivity({ ...world, hiddenTargets: [{ kind: 'entity', id: hiddenTarget.id }] }, 'toast', 'zh-CN', hiddenTarget.id, () => 0)
    expect(result?.participantIds).toEqual([world.entities[0].id])
    expect(result?.body).not.toContain(hiddenTarget.name)
  })

  it('uses the active objective as a lightweight rumor hook', () => {
    const world = makeWorld()
    const result = playTavernActivity({
      ...world,
      scenarios: [{
        id: 'story', assetId: 'story', title: '故事', description: '', processedEventIds: [],
        stages: [{ id: 'clue', title: '寻找断箭', description: '', status: 'active', trigger: { eventType: 'interaction' } }],
      }],
    }, 'rumor', 'zh-CN', world.entities[0].id, () => 0)
    expect(result?.body).toContain('寻找断箭')
    expect(result?.world.entities[1].speech?.text).toContain('寻找断箭')
  })
})
