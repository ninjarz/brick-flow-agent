export const shadowBrickThreshold = 800
export const simplifiedBrickThreshold = 2500

export const getScenePerformanceSettings = (
  brickCount: number,
  viewMode: 'border' | 'borderless' | 'voxel',
) => ({
  enableRealtimeShadows: brickCount < shadowBrickThreshold,
  useSimplifiedView: viewMode !== 'voxel' && brickCount >= simplifiedBrickThreshold,
  maxDevicePixelRatio: brickCount < shadowBrickThreshold ? 1.5 : 1,
})
