import { describe, expect, it } from 'vitest'
import { brickById } from '../data/basicBricks'
import { transformBrickLocalPoint } from './brickUnits'
import { transformBrickLocalBounds, type BrickBounds } from './ldrawBounds'
import type { BrickPose } from '../types/bricks'

const directCorners = (bounds: BrickBounds, pose: BrickPose) => {
  const points = [bounds.minX,bounds.maxX].flatMap(x => [bounds.minY,bounds.maxY].flatMap(y => [bounds.minZ,bounds.maxZ].map(z => transformBrickLocalPoint(brickById.get('brick-1x1')!,pose,{x,y,z}))))
  return {minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))}
}

describe('shared rotated bounds', () => {
  it('retains the exact extrema from the original eight-corner transform across translations', () => {
    const c=Math.SQRT1_2
    const matrices: NonNullable<BrickPose['orientationMatrix']>[]=[[1,0,0,0,1,0,0,0,1],[-1,0,0,0,1,0,0,0,1],[c,0,c,0,1,0,-c,0,c],[1,0,0,0,c,-c,0,c,c]]
    const bounds={minX:-.3,maxX:.7,minY:-.15,maxY:1.4,minZ:-.2,maxZ:1.3}
    for (const matrix of matrices) for (const rotation of [0,1,2,3] as const) for (const translation of [.123456,-7.234567,100.765432]) {
      const pose:BrickPose={xStud:translation,yStud:translation+20,zStud:translation-3,rotationQuarterTurns:rotation,verticalQuarterTurns:1,rollQuarterTurns:3,orientationMatrix:matrix}
      expect(transformBrickLocalBounds(brickById.get('brick-1x1')!,pose,bounds)).toEqual(directCorners(bounds,pose))
    }
  })

  it('does not reuse stale extrema after a caller edits the bounds', () => {
    const definition=brickById.get('brick-1x1')!,bounds={minX:-.3,maxX:.7,minY:-.15,maxY:1.4,minZ:-.2,maxZ:1.3}
    const pose:BrickPose={xStud:4,yStud:5,zStud:6,rotationQuarterTurns:1}
    transformBrickLocalBounds(definition,pose,bounds)
    bounds.maxX+=2
    expect(transformBrickLocalBounds(definition,pose,bounds)).toEqual(directCorners(bounds,pose))
  })
})
