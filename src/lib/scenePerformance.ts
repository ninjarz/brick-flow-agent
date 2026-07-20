export const shadowBrickThreshold = 800
export const simplifiedBrickThreshold = 2500

export const getSimulationPlaybackFps = (brickCount: number) => {
  if (brickCount >= simplifiedBrickThreshold) return 12
  if (brickCount >= shadowBrickThreshold) return 20
  return 30
}

export const getWorldAnimationFps = (brickCount: number, entityCount: number) => {
  if (entityCount <= 0) return 0
  if (brickCount >= simplifiedBrickThreshold || entityCount >= 80) return 20
  if (brickCount >= shadowBrickThreshold || entityCount >= 32) return 30
  return 60
}

export const getScenePerformanceSettings = (
  brickCount: number,
  viewMode: 'border' | 'borderless' | 'xray' | 'voxel',
) => ({
  enableRealtimeShadows: brickCount < shadowBrickThreshold,
  useSimplifiedView: viewMode !== 'voxel' && brickCount >= simplifiedBrickThreshold,
  maxDevicePixelRatio: brickCount < shadowBrickThreshold ? 1.5 : 1,
})
