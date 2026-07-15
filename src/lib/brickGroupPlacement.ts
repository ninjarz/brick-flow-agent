import {
  createBrickCollisionIndex,
  createPlanSpatialState,
  getBrickBounds,
  getNearestHorizontalSearchOffsets,
  hasBrickCollision,
  isBrickAboveGround,
} from './planUtils'
import { WORLD_SNAP_STEP_STUDS, normalizeHorizontalStud, normalizeYStud } from './brickUnits'
import type { PlacedBrick } from '../types/bricks'

export type StationaryPlanSpatialData = {
  excludedKey: string
  stationaryBricks: PlacedBrick[]
  spatialState: ReturnType<typeof createPlanSpatialState>
}

export const rotationRepositionSearchRadiusStuds = 5
const boundsTolerance = 0.000001

const liftBrickGroupAboveGround = (bricks: PlacedBrick[]) => {
  const minY = bricks.reduce((lowest, brick) => {
    const bounds = getBrickBounds(brick)
    return bounds ? Math.min(lowest, bounds.minY) : lowest
  }, Infinity)
  if (!Number.isFinite(minY) || minY >= -boundsTolerance) return bricks

  const liftSteps = Math.ceil(Math.max(0, -minY) / WORLD_SNAP_STEP_STUDS)
  const liftStuds = liftSteps * WORLD_SNAP_STEP_STUDS
  return bricks.map((brick) => ({
    ...brick,
    pose: { ...brick.pose, yStud: normalizeYStud(brick.pose.yStud + liftStuds) },
  }))
}

export const findNearestOpenBrickGroupAround = (
  rotatedBricks: PlacedBrick[],
  allBricks: PlacedBrick[],
  selectedIds: Set<string>,
  stationaryData?: StationaryPlanSpatialData,
) => {
  const stationaryBricks = stationaryData?.stationaryBricks ?? allBricks.filter((brick) => !selectedIds.has(brick.id))
  const stationaryCollisionIndex = stationaryData?.spatialState.collisionIndex ?? createBrickCollisionIndex(stationaryBricks)

  for (const offset of getNearestHorizontalSearchOffsets(rotationRepositionSearchRadiusStuds)) {
    const candidateBricks = liftBrickGroupAboveGround(rotatedBricks.map((brick) => ({
      ...brick,
      pose: {
        ...brick.pose,
        xStud: normalizeHorizontalStud(brick.pose.xStud + offset.xStud),
        zStud: normalizeHorizontalStud(brick.pose.zStud + offset.zStud),
      },
    })))

    if (candidateBricks.some((brick) => !isBrickAboveGround(brick))) continue
    if (candidateBricks.some((brick) => hasBrickCollision(brick, stationaryBricks, stationaryCollisionIndex))) continue

    const groupCollisionIndex = createBrickCollisionIndex(candidateBricks)
    if (candidateBricks.some((brick) => hasBrickCollision(brick, candidateBricks, groupCollisionIndex))) continue
    return candidateBricks
  }

  return undefined
}
