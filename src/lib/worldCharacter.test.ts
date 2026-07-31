import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createWorldEntity } from './worldEntity'
import {
  createWorldEntityGoal,
  normalizeWorldEntityGoals,
  reconcileWorldEntityGoals,
} from './worldCharacter'

describe('world character agenda', () => {
  it('keeps at most three goals with exactly one active goal', () => {
    const goals = normalizeWorldEntityGoals([
      createWorldEntityGoal('守住酒馆', 'scenario', 1),
      createWorldEntityGoal('调查断箭', 'player', 2),
      createWorldEntityGoal('询问艾琳', 'ai', 3),
      createWorldEntityGoal('巡查北路', 'seed', 4),
    ])

    expect(goals).toHaveLength(3)
    expect(goals.map((goal) => goal.status)).toEqual(['active', 'queued', 'queued'])
    expect(goals.map((goal) => goal.summary)).toEqual(['守住酒馆', '调查断箭', '询问艾琳'])
  })

  it('promotes queued commands and preserves a narrative goal after commands finish', () => {
    const entity = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'roland' })
    entity.activeCommand = { type: 'move', target: { kind: 'entity', id: 'envoy' } }
    entity.commandQueue = [{ type: 'guard', target: { kind: 'structure', id: 'tavern' } }]
    entity.mind.goals = normalizeWorldEntityGoals([
      createWorldEntityGoal('接近黑岩使者', 'player', 1, { kind: 'entity', id: 'envoy' }, 'move'),
      createWorldEntityGoal('守住灰鸦酒馆', 'scenario', 1),
    ])

    const running = reconcileWorldEntityGoals(entity, 2, (target) => target.id)
    expect(running.mind.goals.map((goal) => [goal.commandType, goal.status])).toEqual([
      ['move', 'active'],
      ['guard', 'queued'],
      [undefined, 'queued'],
    ])

    const advanced = reconcileWorldEntityGoals({
      ...running,
      activeCommand: running.commandQueue[0],
      commandQueue: [],
    }, 3)
    expect(advanced.mind.goals.map((goal) => [goal.commandType, goal.status])).toEqual([
      ['guard', 'active'],
      [undefined, 'queued'],
    ])

    const completed = reconcileWorldEntityGoals({ ...advanced, activeCommand: undefined }, 4)
    expect(completed.mind.goals).toEqual([
      expect.objectContaining({ summary: '守住灰鸦酒馆', status: 'active' }),
    ])
  })
})
