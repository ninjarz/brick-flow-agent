import type { PlacedBrick } from '../types/bricks'

export const getVisibleBricksDuringPlacement = (
  bricks: PlacedBrick[],
  movingSourceBrickIds: string[],
) => {
  if (movingSourceBrickIds.length === 0) return bricks

  const movingSourceIdSet = new Set(movingSourceBrickIds)
  return bricks.filter((brick) => !movingSourceIdSet.has(brick.id))
}

/** Keep unchanged snapshots addressable by the scene preparation cache. */
export const getVisibleSceneBricks = (bricks: PlacedBrick[], hiddenIds: Set<string>, showHidden: boolean) =>
  showHidden || hiddenIds.size === 0 ? bricks : bricks.filter(brick => !hiddenIds.has(brick.id))
