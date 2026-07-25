export const getSceneCameraFrameRequestKey = (
  explicitFrameKey: string | undefined,
  brickIds: readonly string[],
) => explicitFrameKey ?? brickIds.join('|')
