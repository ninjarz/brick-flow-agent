import { Euler, Matrix4, Vector3 } from 'three'
import { brickById } from '../data/basicBricks'
import type { BrickPose, BrickRotationQuarterTurns, BrickVerticalQuarterTurns, PlacedBrick } from '../types/bricks'
import { getBrickAssemblyPosition } from './brickEditorCoordinates'
import { footprintToWorld, getBrickWorldFrame, normalizeQuarterTurns, normalizeVerticalQuarterTurns } from './brickUnits'

export type BrickEulerAngles = {
  yaw: number
  pitch: number
  roll: number
}

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const ORTHOGONAL_TOLERANCE_DEG = 1e-3
const mirrorX = new Matrix4().makeScale(-1, 1, 1)

export const normalizeAngleDegrees = (degrees: number): number => {
  if (!Number.isFinite(degrees)) return 0
  const wrapped = ((degrees % 360) + 360) % 360
  const rounded = Math.round(wrapped * 10) / 10
  return rounded >= 360 || Math.abs(rounded) < 1e-6 ? 0 : rounded
}

/** Builds the pure 3x3 world orientation part (embedded in Matrix4) matching rendering and physics. */
export const getBrickRotationMatrix = (pose: BrickPose): Matrix4 => {
  const matrix = new Matrix4().makeRotationY(-pose.rotationQuarterTurns * Math.PI / 2)
  matrix.multiply(new Matrix4().makeRotationX(-(pose.verticalQuarterTurns ?? 0) * Math.PI / 2))
  matrix.multiply(new Matrix4().makeRotationZ((pose.rollQuarterTurns ?? 0) * Math.PI / 2))
  const m = pose.orientationMatrix
  if (m) matrix.multiply(new Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1))
  return matrix
}

export const isReflectedRotationMatrix = (matrix: Matrix4): boolean => matrix.determinant() < 0

/** Extracts unified world yaw/pitch/roll angles in degrees [0, 360) matching the YXZ editor convention. */
export const getBrickEulerAngles = (pose: BrickPose): BrickEulerAngles => {
  const rotation = getBrickRotationMatrix(pose)
  const proper = isReflectedRotationMatrix(rotation) ? rotation.clone().multiply(mirrorX) : rotation
  const euler = new Euler().setFromRotationMatrix(proper, 'YXZ')
  return {
    yaw: normalizeAngleDegrees(-euler.y * RAD_TO_DEG),
    pitch: normalizeAngleDegrees(-euler.x * RAD_TO_DEG),
    roll: normalizeAngleDegrees(euler.z * RAD_TO_DEG),
  }
}

export const rotationMatrixFromEulerAngles = (angles: BrickEulerAngles, reflected = false): Matrix4 => {
  const euler = new Euler(
    -angles.pitch * DEG_TO_RAD,
    -angles.yaw * DEG_TO_RAD,
    angles.roll * DEG_TO_RAD,
    'YXZ',
  )
  const matrix = new Matrix4().makeRotationFromEuler(euler)
  if (reflected) matrix.multiply(mirrorX)
  return matrix
}

const nearestQuarterTurns = (degrees: number): BrickRotationQuarterTurns | undefined => {
  const wrapped = ((degrees % 360) + 360) % 360
  const nearest = Math.round(wrapped / 90)
  if (Math.abs(wrapped - nearest * 90) > ORTHOGONAL_TOLERANCE_DEG) return undefined
  return normalizeQuarterTurns(nearest)
}

const matrix4ToOrientationTuple = (matrix: Matrix4): NonNullable<BrickPose['orientationMatrix']> => {
  const e = matrix.elements
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]].map(
    (value) => (Math.abs(value) < 1e-12 ? 0 : value),
  ) as NonNullable<BrickPose['orientationMatrix']>
}

export const poseOrientationFromMatrix = (
  matrix: Matrix4,
): Pick<BrickPose, 'rotationQuarterTurns' | 'verticalQuarterTurns' | 'rollQuarterTurns' | 'orientationMatrix'> => {
  const reflected = isReflectedRotationMatrix(matrix)
  if (!reflected) {
    const euler = new Euler().setFromRotationMatrix(matrix, 'YXZ')
    const yawTurns = nearestQuarterTurns(-euler.y * RAD_TO_DEG)
    const pitchTurns = nearestQuarterTurns(-euler.x * RAD_TO_DEG)
    const rollTurns = nearestQuarterTurns(euler.z * RAD_TO_DEG)
    if (yawTurns !== undefined && pitchTurns !== undefined && rollTurns !== undefined) {
      return {
        rotationQuarterTurns: yawTurns,
        verticalQuarterTurns: normalizeVerticalQuarterTurns(pitchTurns) as BrickVerticalQuarterTurns,
        ...(rollTurns ? { rollQuarterTurns: rollTurns } : { rollQuarterTurns: undefined }),
        orientationMatrix: undefined,
      }
    }
  }
  return {
    rotationQuarterTurns: 0,
    verticalQuarterTurns: 0,
    rollQuarterTurns: undefined,
    orientationMatrix: matrix4ToOrientationTuple(matrix),
  }
}

export const isIdentityRotationMatrix = (matrix: Matrix4, epsilon = 1e-9): boolean => {
  const e = matrix.elements
  return (
    Math.abs(e[0] - 1) <= epsilon &&
    Math.abs(e[5] - 1) <= epsilon &&
    Math.abs(e[10] - 1) <= epsilon &&
    Math.abs(e[1]) <= epsilon &&
    Math.abs(e[2]) <= epsilon &&
    Math.abs(e[4]) <= epsilon &&
    Math.abs(e[6]) <= epsilon &&
    Math.abs(e[8]) <= epsilon &&
    Math.abs(e[9]) <= epsilon
  )
}

/**
 * Applies a target world rotation matrix to a single brick while keeping its
 * assembly origin (or world center for non-LDraw bricks) fixed in place.
 */
export const applyBrickRotationMatrix = (brick: PlacedBrick, targetRotation: Matrix4): PlacedBrick => {
  const definition = brickById.get(brick.brickId)
  const orientation = poseOrientationFromMatrix(targetRotation)
  if (!definition) {
    return { ...brick, pose: { ...brick.pose, ...orientation } }
  }

  const beforeAssembly = getBrickAssemblyPosition(brick)
  const beforeFrame = getBrickWorldFrame(definition, brick.pose)
  const nextFootprint = footprintToWorld(
    definition,
    orientation.rotationQuarterTurns,
    orientation.verticalQuarterTurns ?? 0,
    orientation.rollQuarterTurns ?? 0,
    orientation.orientationMatrix,
  )
  const candidate: PlacedBrick = {
    ...brick,
    pose: {
      ...brick.pose,
      ...orientation,
      xStud: beforeFrame.x - nextFootprint.width / 2,
      yStud: beforeFrame.y - nextFootprint.height / 2,
      zStud: beforeFrame.z - nextFootprint.depth / 2,
    },
  }
  if (definition.pack === 'lego') {
    const afterAssembly = getBrickAssemblyPosition(candidate)
    const offset = new Vector3(
      beforeAssembly.x - afterAssembly.x,
      beforeAssembly.y - afterAssembly.y,
      beforeAssembly.z - afterAssembly.z,
    )
    candidate.pose = {
      ...candidate.pose,
      xStud: Number((candidate.pose.xStud + offset.x).toFixed(6)),
      yStud: Number((candidate.pose.yStud + offset.y).toFixed(6)),
      zStud: Number((candidate.pose.zStud + offset.z).toFixed(6)),
    }
  }
  return candidate
}

/** Applies unified world Euler angles (in degrees) to a single brick in place. */
export const applyBrickEulerAngles = (brick: PlacedBrick, targetAngles: BrickEulerAngles): PlacedBrick => {
  const reflected = isReflectedRotationMatrix(getBrickRotationMatrix(brick.pose))
  const targetMatrix = rotationMatrixFromEulerAngles(targetAngles, reflected)
  return applyBrickRotationMatrix(brick, targetMatrix)
}
