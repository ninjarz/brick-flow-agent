import { describe, expect, it } from 'vitest'
import { makeBrick } from './planUtils'
import { getDisasterFrame, runDisasterSimulation } from './disasterSimulation'

const createStableStack = () => [
  makeBrick('brick-2x4', 'gray', 0, 0, 0),
  makeBrick('brick-2x2', 'gray', 1, 1.2, 1),
]

describe('disaster simulation', () => {
  it('is deterministic and produces a weighted bridge-game score', () => {
    const bricks = createStableStack()
    const first = runDisasterSimulation(bricks, { scenario: 'earthquake', intensity: 82 })
    const second = runDisasterSimulation(bricks, { scenario: 'earthquake', intensity: 82 })

    expect([...first.failureTimeByBrickId]).toEqual([...second.failureTimeByBrickId])
    expect([...first.failureModeByBrickId]).toEqual([...second.failureModeByBrickId])
    expect(first.score).toBe(second.score)
    expect(first.score).toBeGreaterThanOrEqual(0)
    expect(first.score).toBeLessThanOrEqual(100)
    expect(Object.keys(first.scoreBreakdown)).toEqual(['survival', 'staticStability', 'span', 'materialEfficiency'])
  })

  it('propagates the failure of a detached component', () => {
    const [base, top] = createStableStack()
    const detached = { ...top, id: 'detached-test', pose: { ...top.pose, yStud: 5 } }
    const result = runDisasterSimulation([base, detached], { scenario: 'wind', intensity: 35 })
    const finalFrame = getDisasterFrame(result, result.options.durationSeconds)

    expect(result.failureTimeByBrickId.get(detached.id)).toBe(0)
    expect(result.failureModeByBrickId.get(detached.id)).toBe('detached')
    expect(finalFrame.failedIds.has(detached.id)).toBe(true)
    expect(finalFrame.offsetsByBrickId.get(detached.id)?.y).toBeLessThan(0)
  })

  it('applies stronger visible displacement at higher intensity', () => {
    const bricks = createStableStack()
    const low = runDisasterSimulation(bricks, { scenario: 'wind', intensity: 20 })
    const high = runDisasterSimulation(bricks, { scenario: 'wind', intensity: 90 })
    const lowFrame = getDisasterFrame(low, 2)
    const highFrame = getDisasterFrame(high, 2)
    const topId = bricks[1].id
    const lowOffset = lowFrame.offsetsByBrickId.get(topId)?.x ?? 0
    const highOffset = highFrame.offsetsByBrickId.get(topId)?.x ?? 0

    expect(Math.abs(highOffset)).toBeGreaterThan(Math.abs(lowOffset))
  })

  it('applies wind load using the projected area from the selected direction', () => {
    const wall = [
      makeBrick('brick-2x8', 'gray', 0, 0, 0),
      makeBrick('brick-1x6', 'gray', 1, 1.2, 0),
      makeBrick('brick-1x6', 'gray', 1, 2.4, 0),
      makeBrick('brick-1x6', 'gray', 1, 3.6, 0),
    ]
    const narrowSide = runDisasterSimulation(wall, { scenario: 'wind', intensity: 65, directionDegrees: 0 })
    const broadSide = runDisasterSimulation(wall, { scenario: 'wind', intensity: 65, directionDegrees: 90 })
    const topId = wall.at(-1)!.id
    const narrowStress = narrowSide.peakStressByBrickId.get(topId) ?? 0
    const broadStress = broadSide.peakStressByBrickId.get(topId) ?? 0

    expect(broadStress).toBeGreaterThan(narrowStress * 2)
  })

  it('only loads the first brick hit by a fully blocked wind ray', () => {
    const front = makeBrick('brick-1x2', 'gray', 0, 0, 0)
    const rear = makeBrick('brick-1x2', 'gray', 3, 0, 0)
    const result = runDisasterSimulation([front, rear], {
      scenario: 'wind',
      intensity: 70,
      directionDegrees: 0,
    })

    expect(result.windExposureByBrickId.get(front.id)?.exposedRatio).toBe(1)
    expect(result.windExposureByBrickId.get(rear.id)?.exposedRatio).toBe(0)
    const frame = getDisasterFrame(result, 2)
    expect(Math.abs(frame.offsetsByBrickId.get(front.id)?.x ?? 0)).toBeGreaterThan(0)
    expect(frame.offsetsByBrickId.get(rear.id)?.x).toBe(0)

    result.failureTimeByBrickId.set(front.id, 1)
    const unshieldedFrame = getDisasterFrame(result, 2)
    expect(unshieldedFrame.windExposureByBrickId.get(rear.id)?.exposedRatio).toBe(1)
    expect(Math.abs(unshieldedFrame.offsetsByBrickId.get(rear.id)?.x ?? 0)).toBeGreaterThan(0)
  })

  it('scales wind load by the visible fraction of a partially blocked face', () => {
    const front = makeBrick('brick-1x1', 'gray', 0, 0, 0)
    const rear = makeBrick('brick-2x2', 'gray', 3, 0, 0)
    const result = runDisasterSimulation([front, rear], {
      scenario: 'wind',
      intensity: 70,
      directionDegrees: 0,
    })
    const rearExposure = result.windExposureByBrickId.get(rear.id)

    expect(rearExposure?.exposedRatio).toBeCloseTo(0.5, 1)
    expect(rearExposure?.exposedArea).toBeCloseTo((rearExposure?.projectedArea ?? 0) * 0.5, 1)
  })

  it('only applies direct rain load to the top brick in a covered stack', () => {
    const base = makeBrick('brick-1x2', 'gray', 0, 0, 0)
    const roof = makeBrick('brick-1x2', 'gray', 0, 1.2, 0)
    const result = runDisasterSimulation([base, roof], { scenario: 'rain', intensity: 10 })

    expect(result.rainExposureByBrickId.get(roof.id)?.exposedRatio).toBe(1)
    expect(result.rainExposureByBrickId.get(base.id)?.exposedRatio).toBe(0)
  })

  it('tracks partial roof coverage and exposes lower bricks after the roof fails', () => {
    const base = makeBrick('brick-2x2', 'gray', 0, 0, 0)
    const roof = makeBrick('brick-1x1', 'gray', 0, 1.2, 0)
    const result = runDisasterSimulation([base, roof], { scenario: 'rain', intensity: 10 })

    expect(result.rainExposureByBrickId.get(base.id)?.exposedRatio).toBeCloseTo(0.75, 2)
    result.failureTimeByBrickId.set(roof.id, 1)
    const unshieldedFrame = getDisasterFrame(result, 2)
    expect(unshieldedFrame.rainExposureByBrickId.get(base.id)?.exposedRatio).toBe(1)
    expect(unshieldedFrame.waterAccumulation).toBeGreaterThan(0)
  })

  it('classifies wind failures from overturning moment separately from shear', () => {
    const tower = [
      makeBrick('brick-2x2', 'gray', 0, 0, 0),
      makeBrick('brick-1x1', 'gray', 0.5, 1.2, 0.5),
      makeBrick('brick-1x1', 'gray', 0.5, 2.4, 0.5),
      makeBrick('brick-1x1', 'gray', 0.5, 3.6, 0.5),
    ]
    const result = runDisasterSimulation(tower, {
      scenario: 'wind',
      intensity: 100,
      directionDegrees: 0,
    })

    expect([...result.failureModeByBrickId.values()]).toContain('overturn')
  })
})
