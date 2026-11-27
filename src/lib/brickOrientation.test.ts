import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import rawHogwarts from '../data/legoHogwartsPlan.json'
import { brickById } from '../data/basicBricks'
import type { BuildPlan } from '../types/bricks'
import { getBrickAssemblyPosition, getBrickSelectionReference } from './brickEditorCoordinates'
import {
  applyBrickEulerAngles,
  getBrickEulerAngles,
  getBrickRotationMatrix,
  isIdentityRotationMatrix,
  isReflectedRotationMatrix,
  normalizeAngleDegrees,
  rotationMatrixFromEulerAngles,
} from './brickOrientation'
import { getLDrawSceneMatrix } from './ldrawSceneBatches'
import { createBrickCollisionIndex, hasBrickCollision, makeBrick } from './planUtils'
import { rotateRigidBrickGroupByMatrix } from './rigidBrickGroup'

const hogwartsPlan = rawHogwarts as unknown as BuildPlan

describe('unified brick orientation', () => {
  it('normalizes degrees into [0, 360) without -0 or 360', () => {
    expect(normalizeAngleDegrees(0)).toBe(0)
    expect(normalizeAngleDegrees(-0)).toBe(0)
    expect(normalizeAngleDegrees(360)).toBe(0)
    expect(normalizeAngleDegrees(-90)).toBe(270)
    expect(normalizeAngleDegrees(393.74)).toBe(33.7)
  })

  it('extracts exact angles for orthogonal quarter-turn poses', () => {
    const brick = makeBrick('plate-1x3', 'gray', 10, 0, 10, 1)
    expect(getBrickEulerAngles(brick.pose)).toEqual({ yaw: 90, pitch: 0, roll: 0 })

    const flipped = { ...brick, pose: { ...brick.pose, rotationQuarterTurns: 2 as const, verticalQuarterTurns: 2 as const, rollQuarterTurns: 3 as const } }
    const flippedAngles = getBrickEulerAngles(flipped.pose)
    const reconstructed = rotationMatrixFromEulerAngles(flippedAngles)
    const original = getBrickRotationMatrix(flipped.pose)
    for (let i = 0; i < 16; i++) expect(reconstructed.elements[i]).toBeCloseTo(original.elements[i], 9)

    const pitched = { ...brick, pose: { ...brick.pose, rotationQuarterTurns: 1 as const, verticalQuarterTurns: 0 as const, rollQuarterTurns: 3 as const } }
    expect(getBrickEulerAngles(pitched.pose)).toEqual({ yaw: 90, pitch: 0, roll: 270 })
  })

  it('extracts real non-90 world angles from Hogwarts angled east wing parts', () => {
    const angledPlate = hogwartsPlan.bricks.find(
      (b) => b.brickId === 'plate-1x3' && b.pose.orientationMatrix && getBrickEulerAngles(b.pose).yaw % 90 !== 0,
    )
    expect(angledPlate).toBeDefined()
    const angles = getBrickEulerAngles(angledPlate!.pose)
    expect(angles.yaw % 90).not.toBe(0)
    // Reconstructing the rotation matrix from extracted angles matches the original brick matrix
    const reconstructed = rotationMatrixFromEulerAngles(angles, isReflectedRotationMatrix(getBrickRotationMatrix(angledPlate!.pose)))
    const original = getBrickRotationMatrix(angledPlate!.pose)
    for (let i = 0; i < 16; i++) expect(reconstructed.elements[i]).toBeCloseTo(original.elements[i], 2)
  })

  it('round-trips arbitrary angles and keeps the assembly origin fixed', () => {
    const plate = makeBrick('plate-1x3', 'gray', 40, 0, 34)
    const beforePos = getBrickAssemblyPosition(plate)

    const rotated = applyBrickEulerAngles(plate, { yaw: 33.7, pitch: 0, roll: 0 })
    expect(rotated.pose.orientationMatrix).toBeDefined()
    expect(getBrickEulerAngles(rotated.pose)).toEqual({ yaw: 33.7, pitch: 0, roll: 0 })

    const afterPos = getBrickAssemblyPosition(rotated)
    expect(afterPos.x).toBeCloseTo(beforePos.x, 5)
    expect(afterPos.y).toBeCloseTo(beforePos.y, 5)
    expect(afterPos.z).toBeCloseTo(beforePos.z, 5)

    // Returning to an exact 90-degree multiple clears orientationMatrix
    const snapped = applyBrickEulerAngles(rotated, { yaw: 90, pitch: 0, roll: 0 })
    expect(snapped.pose.orientationMatrix).toBeUndefined()
    expect(snapped.pose.rotationQuarterTurns).toBe(1)
    expect(getBrickEulerAngles(snapped.pose)).toEqual({ yaw: 90, pitch: 0, roll: 0 })
  })

  it('preserves reflection handedness when editing angles on mirrored parts', () => {
    const brick = makeBrick('brick-1x2', 'red', 4, 0, 4)
    const mirrored = {
      ...brick,
      pose: {
        ...brick.pose,
        orientationMatrix: [-1, 0, 0, 0, 1, 0, 0, 0, 1] as NonNullable<typeof brick.pose.orientationMatrix>,
      },
    }
    expect(isReflectedRotationMatrix(getBrickRotationMatrix(mirrored.pose))).toBe(true)

    const rotated = applyBrickEulerAngles(mirrored, { yaw: 45, pitch: 0, roll: 0 })
    expect(isReflectedRotationMatrix(getBrickRotationMatrix(rotated.pose))).toBe(true)
    expect(getBrickEulerAngles(rotated.pose)).toEqual({ yaw: 45, pitch: 0, roll: 0 })
  })

  it('rigidly rotates a multi-brick group by arbitrary angles around the group reference', () => {
    const structure = hogwartsPlan.structures!.find((item) => item.name.includes('海格小屋'))!
    const ids = new Set(structure.brickIds)
    const bricks = hogwartsPlan.bricks.filter((brick) => ids.has(brick.id))
    const reference = getBrickSelectionReference(bricks, structure)!

    const deltaMatrix = rotationMatrixFromEulerAngles({ yaw: 27.5, pitch: 0, roll: 0 })
    expect(isIdentityRotationMatrix(deltaMatrix)).toBe(false)

    const rotated = rotateRigidBrickGroupByMatrix(bricks, deltaMatrix, reference.position)
    const afterRef = getBrickSelectionReference(rotated, structure)!
    expect(afterRef.position.x).toBeCloseTo(reference.position.x, 6)
    expect(afterRef.position.y).toBeCloseTo(reference.position.y, 6)
    expect(afterRef.position.z).toBeCloseTo(reference.position.z, 6)

    // Every brick's world transform equals deltaMatrix around reference.position
    const pivot = new Vector3(reference.position.x, reference.position.y, reference.position.z)
    const sample = new Vector3(0.15, 0.25, -0.3)
    bricks.slice(0, 10).forEach((brick, index) => {
      const def = brickById.get(brick.brickId)!
      const expected = sample
        .clone()
        .applyMatrix4(getLDrawSceneMatrix(def, brick))
        .sub(pivot)
        .applyMatrix4(deltaMatrix)
        .add(pivot)
      const actual = sample.clone().applyMatrix4(getLDrawSceneMatrix(def, rotated[index]))
      expect(actual.distanceTo(expected)).toBeLessThan(1e-6)
    })

    // Identity check
    expect(isIdentityRotationMatrix(new Matrix4())).toBe(true)
  })

  it('blocks misaligned angled plates whose outer studs penetrate the upper plate, while allowing aligned or single-stud pivots', () => {
    const base = applyBrickEulerAngles(makeBrick('plate-1x3', 'gray', 37, 0, 101), { yaw: 5, pitch: 0, roll: 0 })
    const misalignedTop = applyBrickEulerAngles(makeBrick('plate-1x3', 'gray', 37, 0.4, 101), { yaw: 352, pitch: 0, roll: 0 })
    const grazingTop = applyBrickEulerAngles(makeBrick('plate-1x3', 'gray', 37, 0.4, 101), { yaw: 142, pitch: 0, roll: 0 })
    const alignedTop = applyBrickEulerAngles(makeBrick('plate-1x3', 'gray', 37, 0.4, 101), { yaw: 5, pitch: 0, roll: 0 })
    const crossedTop = applyBrickEulerAngles(makeBrick('plate-1x3', 'gray', 37, 0.4, 101), { yaw: 95, pitch: 0, roll: 0 })

    // Misaligned 5 deg vs 352 deg and grazing 5 deg vs 142 deg (43 deg relative): outer studs hit upper plate wall
    const index = createBrickCollisionIndex([base])
    expect(hasBrickCollision(misalignedTop, [base], index)).toBe(true)
    expect(hasBrickCollision(misalignedTop, [base])).toBe(true)
    expect(hasBrickCollision(grazingTop, [base], index)).toBe(true)

    // Aligned 5 deg vs 5 deg: all 3 studs engage cleanly
    expect(hasBrickCollision(alignedTop, [base], index)).toBe(false)

    // Crossed 90 deg (5 deg vs 95 deg): outer studs clear the upper plate body
    expect(hasBrickCollision(crossedTop, [base], index)).toBe(false)

    // Single-stud 1x1 pivot underneath a 1x3 plate at arbitrary 33.7 deg is legal
    const pivot1x1 = makeBrick('plate-round-1x1', 'gray', 38, 0, 101)
    const pivotedTop = applyBrickEulerAngles(makeBrick('plate-1x3', 'gray', 37, 0.4, 101), { yaw: 33.7, pitch: 0, roll: 0 })
    expect(hasBrickCollision(pivotedTop, [pivot1x1], createBrickCollisionIndex([pivot1x1]))).toBe(false)
  })
})
