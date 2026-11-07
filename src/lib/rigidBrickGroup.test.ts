import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { makeBrick } from './planUtils'
import { rotateRigidBrickGroup, translateRigidBrickGroup } from './rigidBrickGroup'
import { getLDrawSceneMatrix } from './ldrawSceneBatches'
import { brickById } from '../data/basicBricks'
import { getBrickWorldFrame } from './brickUnits'

const parts = () => [makeBrick('brick-1x2', 'gray', .009989, 4.500927, 16.000034), makeBrick('brick-1x1', 'red', 2.300007, 6.100034, 17.200023, 1)]
describe('rigid editing', () => {
  it('preserves sub-grid offsets when nudging', () => {
    const before = parts(), after = translateRigidBrickGroup(before, { xStud: .2 })
    after.forEach((brick, i) => {
      expect(brick.pose.xStud - before[i].pose.xStud).toBeCloseTo(.2, 12)
      expect(brick.pose.yStud).toBe(before[i].pose.yStud)
      expect(brick.pose.zStud).toBe(before[i].pose.zStud)
    })
  })
  it.each(['horizontal', 'vertical'] as const)('rotates every world vertex rigidly around %s and restores after four turns', axis => {
    const before = parts(), pivot = getBrickWorldFrame(brickById.get(before[0].brickId)!, before[0].pose)
    const origin = new Vector3(pivot.x, pivot.y, pivot.z)
    const rotation = axis === 'horizontal' ? new Matrix4().makeRotationY(-Math.PI / 2) : new Matrix4().makeRotationX(-Math.PI / 2)
    const after = rotateRigidBrickGroup(before, before[0], axis, 1)
    before.forEach((brick, i) => {
      const def = brickById.get(brick.brickId)!
      const point = new Vector3(.2, .3, .4)
      const expected = point.clone().applyMatrix4(getLDrawSceneMatrix(def, brick)).sub(origin).applyMatrix4(rotation).add(origin)
      const actual = point.clone().applyMatrix4(getLDrawSceneMatrix(def, after[i]))
      expect(actual.distanceTo(expected)).toBeLessThan(1e-9)
    })
    let restored = after
    for(let i=0;i<3;i++) restored = rotateRigidBrickGroup(restored, restored[0], axis, 1)
    restored.forEach((brick, i) => expect(new Vector3(brick.pose.xStud, brick.pose.yStud, brick.pose.zStud).distanceTo(new Vector3(before[i].pose.xStud, before[i].pose.yStud, before[i].pose.zStud))).toBeLessThan(1e-9))
  })
})
