import { describe, expect, it } from 'vitest'
import {
  getScenePerformanceSettings,
  getSimulationPlaybackFps,
  getWorldAnimationFps,
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

  it('caps React-driven simulation playback based on model size', () => {
    expect(getSimulationPlaybackFps(100)).toBe(30)
    expect(getSimulationPlaybackFps(shadowBrickThreshold)).toBe(20)
    expect(getSimulationPlaybackFps(simplifiedBrickThreshold)).toBe(12)
  })

  it('keeps small NPC scenes fluid and scales animation cadence for heavy worlds', () => {
    expect(getWorldAnimationFps(100, 4)).toBe(60)
    expect(getWorldAnimationFps(shadowBrickThreshold, 4)).toBe(30)
    expect(getWorldAnimationFps(100, 32)).toBe(30)
    expect(getWorldAnimationFps(simplifiedBrickThreshold, 4)).toBe(20)
    expect(getWorldAnimationFps(100, 80)).toBe(20)
    expect(getWorldAnimationFps(100, 0)).toBe(0)
  })
})
