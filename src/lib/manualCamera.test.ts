import { describe, expect, it } from 'vitest'
import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { getManualCameraMove } from './manualCamera'

const setup = () => {
  const camera = new PerspectiveCamera(50, 1.5, .1, 2000)
  camera.position.set(10, 12, 20)
  const target = new Vector3()
  camera.lookAt(target); camera.updateMatrixWorld()
  return { camera, target }
}

describe('manual camera continuity', () => {
  it('does not move when the complete new piece is already visible', () => {
    const { camera, target } = setup()
    const before = camera.position.clone()
    expect(getManualCameraMove(camera, target, new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1)))).toBeUndefined()
    expect(camera.position.equals(before)).toBe(true)
  })
  it('leaves pieces near the viewport edge alone when fully visible', () => {
    const { camera, target } = setup()
    const center = new Vector3(.97, 0, .98).unproject(camera)
    const bounds = new Box3().setFromCenterAndSize(center, new Vector3(.001, .001, .001))
    expect(getManualCameraMove(camera, target, bounds)).toBeUndefined()
  })
  it.each([
    [60, 0, 0, 62, 3, 2],
    [-3, 60, 0, 3, 66, 4],
    [30, 40, 70, 32, 42, 72],
    [-100, -20, -100, 100, 50, 100],
  ])('brings an offscreen step into view without rotating the camera', (...coordinates) => {
    const { camera, target } = setup()
    const orientation = camera.quaternion.clone()
    const bounds = new Box3(new Vector3(...coordinates.slice(0, 3)), new Vector3(...coordinates.slice(3)))
    const next = getManualCameraMove(camera, target, bounds)!
    expect(next).toBeDefined()
    camera.position.copy(next.position); camera.lookAt(next.target); camera.updateMatrixWorld()
    expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-7)
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const projected = new Vector3(x, y, z).project(camera)
      expect(Math.abs(projected.x)).toBeLessThan(.93)
      expect(Math.abs(projected.y)).toBeLessThan(.93)
      expect(projected.z).toBeGreaterThan(-1)
      expect(projected.z).toBeLessThan(1)
    }
  })
})
