import { describe, expect, it } from 'vitest'
import { createPlanSpatialState, getBrickBounds, makeBrick } from './planUtils'
import { dropBrickGroupAtPoint } from './brickGroupPlacement'

const spatialDataFor = (stationaryBricks: ReturnType<typeof makeBrick>[]) => ({
  stationaryBricks,
  spatialState: createPlanSpatialState(stationaryBricks),
})

describe('dropBrickGroupAtPoint', () => {
  it('aligns the anchor centre to the pointer and lands on the ground', () => {
    const brick = makeBrick('brick-2x2', 'red', 0, 0, 0)
    const result = dropBrickGroupAtPoint([brick], brick.id, { x: 4, z: 3 }, spatialDataFor([]))

    expect(result).toHaveLength(1)
    expect(result?.[0].pose).toMatchObject({ xStud: 3, yStud: 0, zStud: 2 })
  })

  it('stops on the uppermost occupied surface instead of tunnelling through it', () => {
    const base = makeBrick('brick-2x2', 'gray', 3, 3, 2)
    const moving = makeBrick('brick-2x2', 'red', 0, 0, 0)
    const result = dropBrickGroupAtPoint([moving], moving.id, { x: 4, z: 3 }, spatialDataFor([base]))

    expect(result?.[0].pose).toMatchObject({ xStud: 3, zStud: 2 })
    expect(getBrickBounds(result![0])?.minY).toBeCloseTo(getBrickBounds(base)!.maxY)
  })

  it('preserves offsets while dropping an arbitrary multi-selection', () => {
    const anchor = makeBrick('brick-1x1', 'red', 0, 0, 0)
    const companion = makeBrick('brick-1x1', 'blue', 1, 0, 0)
    const result = dropBrickGroupAtPoint(
      [anchor, companion],
      anchor.id,
      { x: 4.5, z: 2.5 },
      spatialDataFor([]),
    )

    expect(result?.map((brick) => brick.pose)).toMatchObject([
      { xStud: 4, yStud: 0, zStud: 2 },
      { xStud: 5, yStud: 0, zStud: 2 },
    ])
  })
})
