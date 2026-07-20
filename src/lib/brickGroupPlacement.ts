import {
  createBrickCollisionIndex,
  createPlanSpatialState,
  getBrickBounds,
  getBrickRawOverlapScore,
  getNearestHorizontalSearchOffsets,
  hasBrickCollision,
  isBrickAboveGround,
} from './planUtils'
import { brickById } from '../data/basicBricks'
import { WORLD_SNAP_STEP_STUDS, getBrickWorldFrame, normalizeHorizontalStud, normalizeYStud } from './brickUnits'
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

type HorizontalDropPoint = {
  x: number
  z: number
}

const translateBrickGroup = (
  bricks: PlacedBrick[],
  delta: { xStud?: number; yStud?: number; zStud?: number },
) => bricks.map((brick) => ({
  ...brick,
  pose: {
    ...brick.pose,
    xStud: normalizeHorizontalStud(brick.pose.xStud + (delta.xStud ?? 0)),
    yStud: normalizeYStud(brick.pose.yStud + (delta.yStud ?? 0)),
    zStud: normalizeHorizontalStud(brick.pose.zStud + (delta.zStud ?? 0)),
  },
}))

const canPlaceDroppedGroup = (
  bricks: PlacedBrick[],
  stationaryBricks: PlacedBrick[],
  stationaryCollisionIndex: ReturnType<typeof createBrickCollisionIndex>,
) => bricks.every((brick) => (
  isBrickAboveGround(brick) &&
  getBrickRawOverlapScore(brick, stationaryBricks, stationaryCollisionIndex) <= boundsTolerance
))

/**
 * Aligns the anchor brick's horizontal centre to the pointer, then lowers the
 * whole rigid selection from above until the next grid step would collide.
 * The source array is never mutated, so callers can use the result as a ghost
 * preview and commit it only after explicit confirmation.
 */
export const dropBrickGroupAtPoint = (
  bricks: PlacedBrick[],
  anchorBrickId: string,
  point: HorizontalDropPoint,
  stationaryData: Pick<StationaryPlanSpatialData, 'stationaryBricks' | 'spatialState'>,
) => {
  const anchor = bricks.find((brick) => brick.id === anchorBrickId) ?? bricks[0]
  const anchorDefinition = anchor ? brickById.get(anchor.brickId) : undefined
  if (!anchor || !anchorDefinition || bricks.length === 0) return undefined

  const anchorFrame = getBrickWorldFrame(anchorDefinition, anchor.pose)
  const horizontallyAligned = translateBrickGroup(bricks, {
    xStud: normalizeHorizontalStud(point.x - anchorFrame.x),
    zStud: normalizeHorizontalStud(point.z - anchorFrame.z),
  })
  const groupBounds = horizontallyAligned.map(getBrickBounds).filter((bounds) => Boolean(bounds))
  if (groupBounds.length !== horizontallyAligned.length) return undefined

  const groupMinY = Math.min(...groupBounds.map((bounds) => bounds!.minY))
  const groupMinX = Math.min(...groupBounds.map((bounds) => bounds!.minX))
  const groupMaxX = Math.max(...groupBounds.map((bounds) => bounds!.maxX))
  const groupMinZ = Math.min(...groupBounds.map((bounds) => bounds!.minZ))
  const groupMaxZ = Math.max(...groupBounds.map((bounds) => bounds!.maxZ))
  const stationaryMaxY = Math.max(
    0,
    ...stationaryData.stationaryBricks
      .map(getBrickBounds)
      .filter((bounds) => Boolean(bounds))
      .filter((bounds) => (
        bounds!.minX < groupMaxX - boundsTolerance &&
        bounds!.maxX > groupMinX + boundsTolerance &&
        bounds!.minZ < groupMaxZ - boundsTolerance &&
        bounds!.maxZ > groupMinZ + boundsTolerance
      ))
      .map((bounds) => bounds!.maxY),
  )
  const startShift = stationaryMaxY + WORLD_SNAP_STEP_STUDS - groupMinY
  let candidate = translateBrickGroup(horizontallyAligned, { yStud: startShift })
  const collisionIndex = stationaryData.spatialState.collisionIndex

  if (!canPlaceDroppedGroup(candidate, stationaryData.stationaryBricks, collisionIndex)) return undefined

  // Descending from above deliberately stops at the first obstacle. This
  // prevents a preview from tunnelling through a roof into an enclosed gap.
  const maxDropSteps = Math.ceil((stationaryMaxY + 1) / WORLD_SNAP_STEP_STUDS) + 2
  for (let step = 0; step < maxDropSteps; step += 1) {
    const lowered = translateBrickGroup(candidate, { yStud: -WORLD_SNAP_STEP_STUDS })
    // normalizeYStud clamps at ground level. Once any member can no longer
    // descend by the same delta, the rigid group has landed; continuing would
    // compress upper layers into the grounded brick.
    if (lowered.some((brick, index) => brick.pose.yStud === candidate[index].pose.yStud)) break
    if (!canPlaceDroppedGroup(lowered, stationaryData.stationaryBricks, collisionIndex)) break
    candidate = lowered
  }

  return candidate
}
