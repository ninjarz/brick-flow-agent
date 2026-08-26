import { describe, expect, it } from 'vitest'
import { createEmptyBuildPlan } from './localGenerator'

describe('createEmptyBuildPlan', () => {
  it('creates a genuinely empty canvas without template bricks or build steps', () => {
    const plan = createEmptyBuildPlan({ title: 'Untitled plan' })

    expect(plan.id).toMatch(/^plan-/)
    expect(plan.title).toBe('Untitled plan')
    expect(plan.prompt).toBe('')
    expect(plan.bricks).toEqual([])
    expect(plan.steps).toEqual([])
    expect(plan.structures).toEqual([])
  })
})
