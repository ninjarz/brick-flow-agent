import { describe, expect, it } from 'vitest'
import { makeBrick } from './planUtils'
import { getVisibleBricksDuringPlacement } from './brickPlacementPreview'

describe('getVisibleBricksDuringPlacement', () => {
  it('hides only the source bricks while a placed group is moving', () => {
    const stationary = makeBrick('brick-2x2', 'gray', 0, 0, 0)
    const movingA = makeBrick('brick-1x1', 'red', 4, 0, 0)
    const movingB = makeBrick('brick-1x1', 'blue', 5, 0, 0)

    expect(getVisibleBricksDuringPlacement(
      [stationary, movingA, movingB],
      [movingA.id, movingB.id],
    )).toEqual([stationary])
  })

  it('keeps the original scene intact while adding a new brick', () => {
    const brick = makeBrick('brick-2x2', 'gray', 0, 0, 0)
    const bricks = [brick]

    expect(getVisibleBricksDuringPlacement(bricks, [])).toBe(bricks)
  })
})
