import { beforeAll, describe, expect, it } from 'vitest'
import type { PlacedBrick } from '../types/bricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import { getBrickBounds, isBrickAboveGround } from './planUtils'
import { getBrickWorldSupportBounds } from './structuralGrid'

describe('down bracket molded wall support', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['99781', '36841']) })
  it.each(['99781', '36841'])('rests %s on the hanging wall rather than sinking it below ground', part => {
    const brick: PlacedBrick = {
      id: 'bracket', brickId: `hogwarts-ldraw-${part}`, color: 'lego-71',
      pose: { xStud: 2, yStud: 5, zStud: 2, rotationQuarterTurns: 0,
        orientationMatrix: [0,0,1,0,1,0,1,0,0] },
    }
    brick.pose.yStud -= getBrickWorldSupportBounds(brick)!.minY
    expect(getBrickBounds(brick)!.minY).toBeCloseTo(0, 5)
    expect(isBrickAboveGround(brick)).toBe(true)
    brick.pose.yStud -= .2
    expect(isBrickAboveGround(brick)).toBe(false)
  })
})
