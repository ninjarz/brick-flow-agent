import { beforeAll, describe, expect, it } from 'vitest'
import { brickById } from '../data/basicBricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import { createBrickCollisionIndex, getBrickRawOverlapScore, makeBrick } from './planUtils'
import { getBrickWorldCollisionBounds, getBrickWorldStructuralCellBoxes, getBrickStructuralOverlapVolume, structuralCellBlocksCollision } from './structuralGrid'
import type { PlacedBrick } from '../types/bricks'

const fixtures = ['brick-1x1', 'slope-2x2', 'brick-round-2x2-axle']
const c = Math.SQRT1_2
const orientations: NonNullable<PlacedBrick['pose']['orientationMatrix']>[] = [
  [1,0,0,0,1,0,0,0,1], [-1,0,0,0,1,0,0,0,1], [c,0,c,0,1,0,-c,0,c], [1,0,0,0,c,-c,0,c,c],
]

describe('conservative occupancy broad phase', () => {
  beforeAll(() => loadLDrawGeneratedVisual(fixtures.map(id => brickById.get(id)!.partNumber)), 30_000)

  it('contains every occupied cell at arbitrary and reflected source rotations', () => {
    for (const id of fixtures) for (const matrix of orientations) {
      const brick = makeBrick(id, 'red', 3, 4, 5)
      brick.pose = { ...brick.pose, orientationMatrix: matrix, rollQuarterTurns: 1 }
      const bounds = getBrickWorldCollisionBounds(brick)!
      for (const cell of getBrickWorldStructuralCellBoxes(brick).filter(structuralCellBlocksCollision)) {
        for (const axis of ['X','Y','Z'] as const) {
          expect(bounds[`min${axis}`]).toBeLessThanOrEqual(cell[`min${axis}`] + 1e-10)
          expect(bounds[`max${axis}`]).toBeGreaterThanOrEqual(cell[`max${axis}`] - 1e-10)
        }
      }
    }
  })

  it('keeps exact overlaps across coarse cell boundaries and negative coordinates', () => {
    const targets = [-4.01, -.01, 3.99, 7.99].map(x => makeBrick('brick-1x1', 'red', x, 4, 0))
    const index = createBrickCollisionIndex(targets)
    for (const x of [-4, -.02, 0, 3.98, 4, 7.98, 8]) {
      const source = makeBrick('brick-1x1', 'blue', x, 4.2, .1)
      const direct = targets.reduce((sum, target) => sum + getBrickStructuralOverlapVolume(source, target), 0)
      expect(getBrickRawOverlapScore(source, targets, index)).toBeCloseTo(direct, 9)
    }
  })

  it('preserves exact overlap volume against a direct narrow-phase scan', () => {
    const targets = fixtures.flatMap((id,i) => orientations.map((matrix,j) => ({
      ...makeBrick(id,'red',i*.7,3+j*.2,i*.5),
      pose:{xStud:i*.7,yStud:3+j*.2,zStud:i*.5,rotationQuarterTurns:0 as const,orientationMatrix:matrix},
    })))
    const index = createBrickCollisionIndex(targets)
    let nonzero = 0
    for (const id of fixtures) for (const matrix of orientations) {
      const source={...makeBrick(id,'blue',.5,3,.5),pose:{xStud:.5,yStud:3,zStud:.5,rotationQuarterTurns:0 as const,orientationMatrix:matrix}}
      const expected=targets.reduce((sum,target)=>sum+getBrickStructuralOverlapVolume(source,target),0)
      nonzero += Number(expected>0)
      expect(getBrickRawOverlapScore(source,targets,index)).toBeCloseTo(expected,9)
    }
    expect(nonzero).toBeGreaterThan(0)
  })
})
