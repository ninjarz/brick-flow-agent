export type WorldFixedStepClock = {
  previousTimeMs: number
  accumulatorSeconds: number
}

export const createWorldFixedStepClock = (timeMs: number): WorldFixedStepClock => ({
  previousTimeMs: timeMs,
  accumulatorSeconds: 0,
})

export const advanceWorldFixedStepClock = (
  clock: WorldFixedStepClock,
  timeMs: number,
  stepSeconds: number,
  options: { maxFrameDeltaSeconds?: number; maxSteps?: number } = {},
) => {
  const maxFrameDeltaSeconds = options.maxFrameDeltaSeconds ?? 0.25
  const maxSteps = options.maxSteps ?? 3
  const rawDeltaSeconds = (timeMs - clock.previousTimeMs) / 1_000
  const deltaSeconds = Math.max(0, Math.min(maxFrameDeltaSeconds, rawDeltaSeconds))
  const accumulated = Math.min(maxFrameDeltaSeconds, clock.accumulatorSeconds + deltaSeconds)
  const stepCount = Math.min(maxSteps, Math.floor((accumulated + 1e-9) / stepSeconds))
  return {
    clock: {
      previousTimeMs: timeMs,
      accumulatorSeconds: Math.max(0, accumulated - stepCount * stepSeconds),
    },
    stepCount,
  }
}
