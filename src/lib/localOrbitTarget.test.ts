import { describe, expect, it } from 'vitest'
import { Box3, PerspectiveCamera, Vector2, Vector3 } from 'three'
import { getLocalOrbitTarget } from './localOrbitTarget'

const setup = () => {
  const camera = new PerspectiveCamera(45, 1.5, .1, 2000)
  camera.position.set(0, 0, 20)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  return camera
}

describe('local orbit target', () => {
  it('uses the nearest surface depth and preserves framing for off-centre hits', () => {
    const camera = setup()
    const boxes = [new Box3(new Vector3(1, -2, 0), new Vector3(5, 2, 2)), new Box3(new Vector3(1, -2, 10), new Vector3(5, 2, 12))]
    const before = camera.quaternion.clone()
    const position = camera.position.clone()
    const target = getLocalOrbitTarget(camera, new Vector2(.3, 0), boxes)!
    expect(target.z).toBeCloseTo(12)
    camera.lookAt(target)
    expect(camera.quaternion.angleTo(before)).toBeLessThan(1e-7)
    expect(camera.position.equals(position)).toBe(true)
  })
  it('leaves the pivot alone when dragging empty space', () => {
    expect(getLocalOrbitTarget(setup(), new Vector2(), [])).toBeUndefined()
  })
  it('ignores geometry behind the camera', () => {
    const box = new Box3(new Vector3(-1, -1, 30), new Vector3(1, 1, 32))
    expect(getLocalOrbitTarget(setup(), new Vector2(), [box])).toBeUndefined()
  })
  it('queries a large scene without mutating its bounds', () => {
    const camera = setup()
    const boxes = Array.from({ length: 6025 }, (_, i) => new Box3(new Vector3(i % 100 - 50, Math.floor(i / 100) - 30, 0), new Vector3(i % 100 - 49, Math.floor(i / 100) - 29, 1)))
    const before = boxes[0].clone()
    expect(getLocalOrbitTarget(camera, new Vector2(), boxes)).toBeDefined()
    expect(boxes[0].equals(before)).toBe(true)
  })
})
