import { describe, expect, it } from 'vitest'
import { Matrix3, Matrix4, Vector3 } from 'three'
import { brickById } from '../data/basicBricks'
import { transformBrickLocalPoint } from './brickUnits'
import { brickPoseFromRigidMatrix, getOrientationResidual, getRigidBrickMatrix, normalizeRigidBrickPose, normalizeRigidOrientation } from './rigidBrickTransform'
import type { BrickPose } from '../types/bricks'

const definition = brickById.get('brick-2x4')!

describe('rigid construction transforms', () => {
  it.each([0, 1, 2, 3] as const)('matches existing local point transforms with yaw %s and a reflected source frame', yaw => {
    const pose: BrickPose = { xStud: 10, yStud: 20, zStud: 30, rotationQuarterTurns: yaw, verticalQuarterTurns: 1, rollQuarterTurns: 3,
      orientationMatrix: [-.6, 0, .8, 0, 1, 0, .8, 0, .6] }
    const matrix = getRigidBrickMatrix(definition, pose)
    const point = { x: .3, y: .7, z: 1.1 }
    const actual = new Vector3(point.x - definition.footprint.widthStuds / 2, point.y - definition.footprint.heightStuds / 2, point.z - definition.footprint.depthStuds / 2).applyMatrix4(matrix)
    const expected = transformBrickLocalPoint(definition, pose, point)
    expect(actual.distanceTo(new Vector3(expected.x, expected.y, expected.z))).toBeLessThan(1e-12)
    const restored = getRigidBrickMatrix(definition, brickPoseFromRigidMatrix(definition, matrix))
    expect(Math.max(...matrix.elements.map((value, i) => Math.abs(value - restored.elements[i])))).toBeLessThan(1e-12)
  })

  it.each([1, -1])('projects approximate CAD rotations to an orthogonal matrix retaining determinant sign %s', handedness => {
    const source: NonNullable<BrickPose['orientationMatrix']> = [.600000495, 0, .799999875, 0, handedness, 0, -.799999875, 0, .600000495]
    expect(getOrientationResidual(source)).toBeGreaterThan(1e-8)
    const normalized = normalizeRigidOrientation(source)
    expect(getOrientationResidual(normalized)).toBeLessThan(1e-12)
    expect(new Matrix3().set(...normalized).determinant()).toBeCloseTo(handedness, 12)
    expect(normalizeRigidOrientation(normalized)).toBe(normalized)
  })

  it('preserves the world position of an explicit connector anchor during normalization', () => {
    const pose: BrickPose = { xStud: .401262, yStud: 20, zStud: 30, rotationQuarterTurns: 1, verticalQuarterTurns: 3, rollQuarterTurns: 2,
      orientationMatrix: [.600000495, 0, .799999875, 0, 1, 0, -.799999875, 0, .600000495] }
    const anchor = new Vector3(.75, -.4, 1.25)
    const before = anchor.clone().applyMatrix4(getRigidBrickMatrix(definition, pose))
    const corrected = normalizeRigidBrickPose(definition, pose, anchor)
    expect(anchor.clone().applyMatrix4(getRigidBrickMatrix(definition, corrected)).distanceTo(before)).toBeLessThan(1e-12)
    expect(normalizeRigidBrickPose(definition, corrected, anchor)).toBe(corrected)
    expect(corrected.rotationQuarterTurns).toBe(1)
    expect(corrected.verticalQuarterTurns).toBe(3)
    expect(corrected.rollQuarterTurns).toBe(2)
    const restored = brickPoseFromRigidMatrix(definition, getRigidBrickMatrix(definition, corrected), corrected)
    expect(restored.rotationQuarterTurns).toBe(1)
    expect(restored.verticalQuarterTurns).toBe(3)
    expect(restored.rollQuarterTurns).toBe(2)
  })

  it('rejects actual scale and shear instead of projecting a stretched part into validity', () => {
    expect(() => normalizeRigidOrientation([1.01, 0, 0, 0, 1, 0, 0, 0, 1])).toThrow('INVALID_RIGID_ORIENTATION')
    expect(() => brickPoseFromRigidMatrix(definition, new Matrix4().makeScale(1, 1.01, 1))).toThrow('INVALID_RIGID_TRANSFORM')
  })
})
