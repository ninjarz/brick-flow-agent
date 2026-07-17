import { describe, expect, it } from 'vitest'
import { advanceWorldFixedStepClock, createWorldFixedStepClock } from './worldClock'

describe('world fixed-step clock', () => {
  it('preserves small residual time while producing deterministic steps', () => {
    const result = advanceWorldFixedStepClock(createWorldFixedStepClock(1_000), 1_250, 0.1)
    expect(result.stepCount).toBe(2)
    expect(result.clock.accumulatorSeconds).toBeCloseTo(0.05)
  })

  it('caps long background gaps and never runs backward', () => {
    const backgrounded = advanceWorldFixedStepClock(createWorldFixedStepClock(1_000), 3_601_000, 0.1)
    expect(backgrounded.stepCount).toBe(2)
    expect(backgrounded.clock.accumulatorSeconds).toBeCloseTo(0.05)
    const backward = advanceWorldFixedStepClock(backgrounded.clock, 500, 0.1)
    expect(backward.stepCount).toBe(0)
    expect(backward.clock.accumulatorSeconds).toBeCloseTo(0.05)
  })

  it('resets cleanly on visibility changes', () => {
    const reset = createWorldFixedStepClock(10_000)
    expect(advanceWorldFixedStepClock(reset, 10_016, 0.1).stepCount).toBe(0)
  })
})
