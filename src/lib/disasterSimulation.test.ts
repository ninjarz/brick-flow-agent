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
})
