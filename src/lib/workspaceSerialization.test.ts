import { describe, expect, it } from 'vitest'
import { createEmptyWorldState } from './worldEntity'
import { makeBrick } from './planUtils'
import { createWorkspaceSerializer } from './workspaceSerialization'
import type { BuildPlan } from '../types/bricks'

const plan: BuildPlan = {
  id: 'plan-1', title: 'Cached', prompt: 'test', source: 'template-local',
  bricks: [makeBrick('brick-2x2', 'gray', 0, 0, 0)], steps: [],
}

describe('workspace serialization', () => {
  it('reuses immutable plan JSON across frequent world saves', () => {
    let planSerializations = 0
    const serializer = createWorkspaceSerializer((value) => {
      if (value === plan) planSerializations += 1
      return JSON.stringify(value)
    })
    const world = createEmptyWorldState(plan.id)
    const first = serializer(plan, 'first', world, 1_000_000)
    const second = serializer(plan, 'second', { ...world, elapsedSeconds: 2 }, 1_000_000)
    expect(planSerializations).toBe(1)
    expect(JSON.parse(first.serialized!)).toEqual(first.value)
    expect(JSON.parse(second.serialized!)).toEqual(second.value)
  })

  it('avoids constructing an inline payload beyond the storage limit', () => {
    const result = createWorkspaceSerializer()(plan, 'test', createEmptyWorldState(plan.id), 10)
    expect(result.serialized).toBeUndefined()
    expect(result.totalLength).toBeGreaterThan(10)
    expect(result.value.plan).toBe(plan)
  })

  it('invalidates the plan cache when immutable plan identity changes', () => {
    let serializations = 0
    const nextPlan = { ...plan, title: 'Changed' }
    const serializer = createWorkspaceSerializer((value) => {
      if (value === plan || value === nextPlan) serializations += 1
      return JSON.stringify(value)
    })
    const world = createEmptyWorldState(plan.id)
    serializer(plan, 'test', world, 1_000_000)
    serializer(nextPlan, 'test', { ...world, planId: nextPlan.id }, 1_000_000)
    expect(serializations).toBe(2)
  })
})
