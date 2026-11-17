import { describe, expect, it } from 'vitest'
import { brickById } from '../data/basicBricks'
import { transformBrickLocalPoint } from './brickUnits'
import { getBrickWorldBounds, seedLDrawContactHull, transformBrickLocalBounds, type BrickBounds } from './ldrawBounds'
import type { BrickPose } from '../types/bricks'

const directCorners = (bounds: BrickBounds, pose: BrickPose) => {
  const points = [bounds.minX,bounds.maxX].flatMap(x => [bounds.minY,bounds.maxY].flatMap(y => [bounds.minZ,bounds.maxZ].map(z => transformBrickLocalPoint(brickById.get('brick-1x1')!,pose,{x,y,z}))))
  return {minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))}
}

describe('shared rotated bounds', () => {
  it('does not use an empty rotated AABB corner as the ground contact surface', () => {
    const definition = { ...brickById.get('brick-1x1')!, partNumber: 'test-contact-tetrahedron', footprint: { widthStuds: 2, heightStuds: 2, depthStuds: 2 } }
    seedLDrawContactHull(definition.partNumber, [0,0,0, 2,0,0, 0,2,0, 0,0,2])
    const c = Math.SQRT1_2
    const pose: BrickPose = { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0,
      orientationMatrix: [-c,c,0, -c,-c,0, 0,0,1] }
    const conservative = transformBrickLocalBounds(definition, pose, { minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 2 })
    expect(conservative.minY).toBeCloseTo(0, 12)
    const actual = getBrickWorldBounds(definition, pose)
    expect(actual.minY).toBeCloseTo(Math.SQRT2, 12)
    const grounded = { ...pose, yStud: -actual.minY }
    expect(getBrickWorldBounds(definition, grounded).minY).toBeCloseTo(0, 12)
  })

  it('invalidates contact extrema when a mould hull is replaced', () => {
    const definition = { ...brickById.get('brick-1x1')!, partNumber: 'test-contact-revision' }
    const pose: BrickPose = { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0 }
    seedLDrawContactHull(definition.partNumber, [0,0,0, 1,1,1])
    expect(getBrickWorldBounds(definition, pose).minY).toBe(0)
    seedLDrawContactHull(definition.partNumber, [0,.25,0, 1,1,1])
    expect(getBrickWorldBounds(definition, pose).minY).toBe(.25)
  })

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
