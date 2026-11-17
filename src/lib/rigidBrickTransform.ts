import { Matrix3, Matrix4, Vector3 } from 'three'
import type { BrickDefinition, BrickPose } from '../types/bricks'
import { footprintToWorld, getBrickWorldFrame, isValidOrientationMatrix } from './brickUnits'
import sourceFrames from '../data/ldrawSourceFrames.json'
import { normalizeLDrawPartNumber } from './ldrawPartNumbers'

type Orientation = NonNullable<BrickPose['orientationMatrix']>

/** Source mould origins are stable mechanical datums, independent of the bounding centre. */
export const getBrickSourceAnchor = (definition: BrickDefinition) => {
  const frames = sourceFrames as Record<string, { origin: number[]; swapped: boolean }>
  const frame = frames[normalizeLDrawPartNumber(definition.partNumber)]
  if (!frame) return new Vector3()
  const [x, y, z] = frame.origin.map(value => -value / 20)
  const point = frame.swapped ? new Vector3(z, -y, x) : new Vector3(x, -y, z)
  return point.sub(new Vector3(definition.footprint.widthStuds / 2, definition.footprint.heightStuds / 2, definition.footprint.depthStuds / 2))
}

const rows = (matrix: Matrix3): Orientation => {
  const e = matrix.elements
  return [e[0], e[3], e[6], e[1], e[4], e[7], e[2], e[5], e[8]]
}

export const getOrientationResidual = (matrix: readonly number[]) => {
  let residual = 0
  for (let row = 0; row < 3; row++) {
    for (let other = 0; other < 3; other++) {
      let dot = 0
      for (let axis = 0; axis < 3; axis++) dot += matrix[row * 3 + axis] * matrix[other * 3 + axis]
      residual = Math.max(residual, Math.abs(dot - Number(row === other)))
    }
  }
  return residual
}

/** Polar projection removes source rounding scale/shear while retaining handedness. */
export const normalizeRigidOrientation = (orientation: Orientation): Orientation => {
  if (!isValidOrientationMatrix(orientation)) throw new Error('INVALID_RIGID_ORIENTATION')
  if (getOrientationResidual(orientation) <= 1e-12) return orientation
  const matrix = new Matrix3().set(...orientation)
  for (let iteration = 0; iteration < 4; iteration++) {
    const inverseTranspose = matrix.clone().invert().transpose()
    for (let index = 0; index < 9; index++) matrix.elements[index] = (matrix.elements[index] + inverseTranspose.elements[index]) / 2
  }
  const result = rows(matrix)
  if (getOrientationResidual(result) > 1e-12) throw new Error('RIGID_ORIENTATION_DID_NOT_CONVERGE')
  return result
}

/** Maps coordinates centred on the mould footprint to world coordinates. */
export const getRigidBrickMatrix = (definition: BrickDefinition, pose: BrickPose) => {
  const frame = getBrickWorldFrame(definition, pose)
  const matrix = new Matrix4().makeTranslation(frame.x, frame.y, frame.z)
  matrix.multiply(new Matrix4().makeRotationY(-pose.rotationQuarterTurns * Math.PI / 2))
  matrix.multiply(new Matrix4().makeRotationX(-(pose.verticalQuarterTurns ?? 0) * Math.PI / 2))
  matrix.multiply(new Matrix4().makeRotationZ((pose.rollQuarterTurns ?? 0) * Math.PI / 2))
  const m = pose.orientationMatrix
  if (m) matrix.multiply(new Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1))
  return matrix
}

export const brickPoseFromRigidMatrix = (definition: BrickDefinition, matrix: Matrix4, referencePose?: BrickPose): BrickPose => {
  if (!matrix.elements.every(Number.isFinite) || [3,7,11].some(index => Math.abs(matrix.elements[index]) > 1e-12) || Math.abs(matrix.elements[15] - 1) > 1e-12) throw new Error('INVALID_RIGID_TRANSFORM')
  const editor = referencePose ? new Matrix3().setFromMatrix4(getRigidBrickMatrix(definition, { ...referencePose, orientationMatrix: undefined })).invert() : new Matrix3()
  const orientation = rows(editor.multiply(new Matrix3().setFromMatrix4(matrix)))
  if (!isValidOrientationMatrix(orientation)) throw new Error('INVALID_RIGID_TRANSFORM')
  const rotationQuarterTurns = referencePose?.rotationQuarterTurns ?? 0
  const verticalQuarterTurns = referencePose?.verticalQuarterTurns ?? 0
  const footprint = footprintToWorld(definition, rotationQuarterTurns, verticalQuarterTurns, referencePose?.rollQuarterTurns ?? 0, orientation)
  const center = new Vector3().setFromMatrixPosition(matrix)
  return {
    xStud: center.x - footprint.widthStuds / 2,
    yStud: center.y - footprint.heightStuds / 2,
    zStud: center.z - footprint.depthStuds / 2,
    rotationQuarterTurns,
    verticalQuarterTurns,
    ...(referencePose?.rollQuarterTurns ? { rollQuarterTurns: referencePose.rollQuarterTurns } : {}),
    orientationMatrix: orientation,
  }
}

/** The supplied local anchor remains fixed, including off-centre connector seats. */
export const normalizeRigidBrickPose = (definition: BrickDefinition, pose: BrickPose, anchor = new Vector3()) => {
  if (!pose.orientationMatrix) return pose
  const orientation = normalizeRigidOrientation(pose.orientationMatrix)
  if (orientation === pose.orientationMatrix) return pose
  const matrix = getRigidBrickMatrix(definition, pose)
  const normalizedPose = { ...pose, orientationMatrix: orientation }
  const normalized = getRigidBrickMatrix(definition, normalizedPose)
  const position = anchor.clone().applyMatrix4(matrix).sub(anchor.clone().applyMatrix4(normalized))
  return { ...normalizedPose, xStud: pose.xStud + position.x, yStud: pose.yStud + position.y, zStud: pose.zStud + position.z }
}
