import { describe, expect, it } from 'vitest'
import type { BuildPlan } from '../types/bricks'
import { makeBrick } from './planUtils'
import { dissolveBrickStructure, getExactSelectionStructure, pruneBrickStructures, solidifyBrickSelection } from './brickStructures'

const makePlan = (): BuildPlan => ({
  id: 'plan-1',
  title: 'Structures',
  prompt: '',
  source: 'template-local',
  bricks: [
    makeBrick('brick-1x1', 'red', 0, 0, 0),
    makeBrick('brick-1x1', 'blue', 1, 0, 0),
  ],
  steps: [],
})

describe('brick structures', () => {
  it('solidifies selected bricks without changing their geometry', () => {
    const plan = makePlan()
    const originalBricks = plan.bricks
    const result = solidifyBrickSelection(plan, plan.bricks.map((brick) => brick.id), { name: '城门' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.bricks).toBe(originalBricks)
    expect(result.structure).toMatchObject({ name: '城门', brickIds: plan.bricks.map((brick) => brick.id) })
    expect(getExactSelectionStructure(result.plan, result.structure.brickIds)?.id).toBe(result.structure.id)
  })

  it('prevents one brick from belonging to multiple solidified structures', () => {
    const plan = makePlan()
    const first = solidifyBrickSelection(plan, [plan.bricks[0].id])
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = solidifyBrickSelection(first.plan, plan.bricks.map((brick) => brick.id))
    expect(second).toMatchObject({ ok: false, issue: 'BRICK_ALREADY_SOLIDIFIED' })
  })

  it('dissolves metadata without deleting bricks and prunes deleted members', () => {
    const plan = makePlan()
    const result = solidifyBrickSelection(plan, plan.bricks.map((brick) => brick.id))
    if (!result.ok) throw new Error('expected structure')
    expect(dissolveBrickStructure(result.plan, result.structure.id).bricks).toEqual(plan.bricks)

    const pruned = pruneBrickStructures({ ...result.plan, bricks: [plan.bricks[0]] })
    expect(pruned.structures?.[0].brickIds).toEqual([plan.bricks[0].id])
  })
})
