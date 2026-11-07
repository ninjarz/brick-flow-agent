import { describe, expect, it } from 'vitest'
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { getCameraNavigationDelta } from './cameraNavigation'

const setup = () => {
  const camera = new PerspectiveCamera(45, 1.5, .1, 1000)
  camera.position.set(10, 12, 20); camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
  return camera
}
describe('zoom-aware camera navigation', () => {
  it('scales perspective movement with orbit distance', () => {
    const camera = setup(), target = new Vector3(), keys = new Set(['w'])
    const near = getCameraNavigationDelta(camera, target, keys, .1)
    camera.position.multiplyScalar(4)
    expect(getCameraNavigationDelta(camera, target, keys, .1).length()).toBeCloseTo(near.length() * 4, 10)
  })
  it('respects lens zoom and orthographic zoom', () => {
    const camera = setup(), target = new Vector3(), keys = new Set(['d'])
    const base = getCameraNavigationDelta(camera, target, keys, .1).length()
    camera.zoom = 2
    expect(getCameraNavigationDelta(camera, target, keys, .1).length()).toBeCloseTo(base / 2, 10)
    const ortho = new OrthographicCamera(-10, 10, 8, -8, .1, 1000)
    const first = getCameraNavigationDelta(ortho, target, keys, .1).length()
    ortho.zoom = 4
    expect(getCameraNavigationDelta(ortho, target, keys, .1).length()).toBeCloseTo(first / 4, 10)
  })
  it('has consistent diagonal speed, cancels opposing keys, and preserves height', () => {
    const camera = setup(), target = new Vector3()
    const w = getCameraNavigationDelta(camera, target, new Set(['w']), .1)
    const diagonal = getCameraNavigationDelta(camera, target, new Set(['w', 'd']), .1)
    expect(diagonal.length()).toBeCloseTo(w.length(), 10)
    expect(diagonal.y).toBe(0)
    expect(getCameraNavigationDelta(camera, target, new Set(['w', 's']), .1).length()).toBe(0)
    expect(getCameraNavigationDelta(camera, target, new Set(['a']), .2).length()).toBeCloseTo(w.length() * 2, 10)
  })
  it('continues panning when looking straight down', () => {
    const camera = setup(); camera.position.set(0, 20, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
    const delta = getCameraNavigationDelta(camera, new Vector3(), new Set(['w']), .1)
    expect(delta.length()).toBeGreaterThan(0)
    expect(delta.y).toBe(0)
  })
})
