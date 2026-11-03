import { describe, expect, it } from 'vitest'
import { getSceneGridFade } from './sceneGridFade'

describe('soft scene grid coverage', () => {
  it('keeps distant and diagonal model corners entirely before the fade', () => {
    for (const bounds of [
      { minX: -15, maxX: 15, minZ: -15, maxZ: 15 },
      { minX: -80, maxX: 170, minZ: -30, maxZ: 95 },
      { minX: -200, maxX: -100, minZ: 40, maxZ: 180 },
    ]) {
      const fade = getSceneGridFade(bounds)
      for (const x of [bounds.minX, bounds.maxX]) for (const z of [bounds.minZ, bounds.maxZ]) {
        expect(Math.hypot(x - fade.centerX, z - fade.centerZ)).toBeLessThanOrEqual(fade.start)
      }
      expect(fade.end - fade.start).toBeGreaterThanOrEqual(9)
    }
  })
})
