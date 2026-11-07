import { Matrix4, Vector3 } from 'three'
import { brickById } from '../data/basicBricks'
import { footprintToWorld, getBrickWorldFrame, normalizeQuarterTurns } from './brickUnits'
import type { PlacedBrick } from '../types/bricks'

export const translateRigidBrickGroup = (bricks: PlacedBrick[], delta: { xStud?: number; yStud?: number; zStud?: number }) => bricks.map(brick => ({ ...brick, pose: { ...brick.pose,
  xStud: brick.pose.xStud + (delta.xStud ?? 0), yStud: brick.pose.yStud + (delta.yStud ?? 0), zStud: brick.pose.zStud + (delta.zStud ?? 0),
} }))

export const rotateRigidBrickGroup = (bricks: PlacedBrick[], pivotBrick: PlacedBrick, axis: 'horizontal' | 'vertical', turns: number, reference?: { x: number; y: number; z: number }) => {
  const pivotDefinition = brickById.get(pivotBrick.brickId)
  if (!pivotDefinition) return bricks
  const p = reference ?? getBrickWorldFrame(pivotDefinition, pivotBrick.pose)
  const pivot = new Vector3(p.x, p.y, p.z)
  const rotation = axis === 'horizontal' ? new Matrix4().makeRotationY(-turns * Math.PI / 2) : new Matrix4().makeRotationX(-turns * Math.PI / 2)
  const euler = (pose: PlacedBrick['pose']) => new Matrix4().makeRotationY(-pose.rotationQuarterTurns * Math.PI / 2)
    .multiply(new Matrix4().makeRotationX(-(pose.verticalQuarterTurns ?? 0) * Math.PI / 2))
    .multiply(new Matrix4().makeRotationZ((pose.rollQuarterTurns ?? 0) * Math.PI / 2))
  return bricks.map(brick => {
    const definition = brickById.get(brick.brickId)
    if (!definition) return brick
    const f = getBrickWorldFrame(definition, brick.pose)
    const center = new Vector3(f.x, f.y, f.z).sub(pivot).applyMatrix4(rotation).add(pivot)
    const pose = { ...brick.pose, rotationQuarterTurns: axis === 'horizontal' ? normalizeQuarterTurns(brick.pose.rotationQuarterTurns + turns) : brick.pose.rotationQuarterTurns,
      verticalQuarterTurns: axis === 'vertical' ? normalizeQuarterTurns((brick.pose.verticalQuarterTurns ?? 0) + turns) : brick.pose.verticalQuarterTurns }
    const source = brick.pose.orientationMatrix
    const matrix = source ? new Matrix4().set(source[0],source[1],source[2],0,source[3],source[4],source[5],0,source[6],source[7],source[8],0,0,0,0,1) : new Matrix4()
    matrix.premultiply(euler(brick.pose)).premultiply(rotation).premultiply(euler(pose).invert())
    const e = matrix.elements
    const orientationMatrix = [e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]].map(n => Math.abs(n) < 1e-12 ? 0 : n) as NonNullable<PlacedBrick['pose']['orientationMatrix']>
    const size = footprintToWorld(definition, pose.rotationQuarterTurns, pose.verticalQuarterTurns ?? 0, pose.rollQuarterTurns ?? 0, orientationMatrix)
    return { ...brick, pose: { ...pose, orientationMatrix, xStud: center.x - size.width / 2, yStud: center.y - size.height / 2, zStud: center.z - size.depth / 2 } }
  })
}
