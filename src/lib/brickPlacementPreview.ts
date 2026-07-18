import type { PlacedBrick } from '../types/bricks'

export const getVisibleBricksDuringPlacement = (
  bricks: PlacedBrick[],
  movingSourceBrickIds: string[],
) => {
  if (movingSourceBrickIds.length === 0) return bricks

  const movingSourceIdSet = new Set(movingSourceBrickIds)
  return bricks.filter((brick) => !movingSourceIdSet.has(brick.id))
}
