import { describe, expect, it } from 'vitest'
import {
  getScenePerformanceSettings,
  shadowBrickThreshold,
  simplifiedBrickThreshold,
} from './scenePerformance'

describe('scene performance policy', () => {
  it('keeps detail for small models', () => {
    expect(getScenePerformanceSettings(shadowBrickThreshold - 1, 'border')).toEqual({
      enableRealtimeShadows: true,
      maxDevicePixelRatio: 1.5,
      useSimplifiedView: false,
    })
  })

  it('reduces expensive effects for large models but preserves voxel diagnostics', () => {
    expect(getScenePerformanceSettings(simplifiedBrickThreshold, 'border').useSimplifiedView).toBe(true)
    expect(getScenePerformanceSettings(simplifiedBrickThreshold, 'xray').useSimplifiedView).toBe(true)
    expect(getScenePerformanceSettings(simplifiedBrickThreshold, 'voxel').useSimplifiedView).toBe(false)
  })
})
