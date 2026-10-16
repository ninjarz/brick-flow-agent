import { isWorldCoordinate } from './worldCoordinates'
import type { BrickColor, BuildPlan, PlacedBrick, VoxelBlockState } from '../types/bricks'
import {
  normalizeHorizontalStud,
  normalizeQuarterTurns,
  normalizeVerticalQuarterTurns,
  normalizeYStud,
  plateHeightToWorldStud,
} from './brickUnits'
import { pruneBrickStructures } from './brickStructures'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const isValidImportedPose = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false

  return (
    isWorldCoordinate(value.xStud) &&
    (Number.isFinite(value.yStud)
      ? isWorldCoordinate(value.yStud)
      : typeof value.yPlate === 'number' && isWorldCoordinate(plateHeightToWorldStud(value.yPlate))) &&
    isWorldCoordinate(value.zStud) &&
    [0, 1, 2, 3].includes(Number(value.rotationQuarterTurns)) &&
    (value.verticalQuarterTurns === undefined || [0, 1, 2, 3].includes(Number(value.verticalQuarterTurns))) &&
    (value.rollQuarterTurns === undefined || [0, 1, 2, 3].includes(Number(value.rollQuarterTurns)))
  )
}

export const normalizeImportedPose = (pose: Record<string, unknown>): PlacedBrick['pose'] => ({
  xStud: normalizeHorizontalStud(Number(pose.xStud)),
  yStud: Number.isFinite(pose.yStud)
    ? normalizeYStud(Number(pose.yStud))
    : plateHeightToWorldStud(Number(pose.yPlate ?? 0)),
  zStud: normalizeHorizontalStud(Number(pose.zStud)),
  rotationQuarterTurns: normalizeQuarterTurns(Number(pose.rotationQuarterTurns)),
  verticalQuarterTurns: normalizeVerticalQuarterTurns(Number(pose.verticalQuarterTurns ?? 0)),
  ...(pose.rollQuarterTurns ? { rollQuarterTurns: normalizeQuarterTurns(Number(pose.rollQuarterTurns)) } : {}),
})

export const normalizeImportedVoxelState = (value: unknown): VoxelBlockState | undefined => {
  if (!isRecord(value)) return undefined
  return {
    ...(value.slabHalf === 'top' || value.slabHalf === 'bottom' ? { slabHalf: value.slabHalf } : {}),
    ...(typeof value.open === 'boolean' ? { open: value.open } : {}),
    ...(typeof value.powered === 'boolean' ? { powered: value.powered } : {}),
    ...(typeof value.containerName === 'string' ? { containerName: value.containerName } : {}),
    ...(isRecord(value.fenceConnections) ? { fenceConnections: {
      north: value.fenceConnections.north === true, east: value.fenceConnections.east === true,
      south: value.fenceConnections.south === true, west: value.fenceConnections.west === true,
    } } : {}),
    ...(Array.isArray(value.storyContents) ? { storyContents: value.storyContents.filter((item) =>
      isRecord(item) && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.description === 'string'
    ).map((item) => ({ id: item.id as string, title: item.title as string, description: item.description as string,
      ...(Array.isArray(item.tags) ? { tags: item.tags.filter((tag): tag is string => typeof tag === 'string') } : {}),
      ...(typeof item.discovered === 'boolean' ? { discovered: item.discovered } : {}),
      ...(typeof item.taken === 'boolean' ? { taken: item.taken } : {}),
    })) } : {}),
  }
}

// Older palettes collapsed 3065's transparent colors into opaque color names.
const legacyTransparentColors: Record<string, BrickColor> = {
  red: 'trans-red', blue: 'trans-blue', yellow: 'trans-yellow', green: 'trans-green',
  white: 'trans-clear', black: 'trans-black', brown: 'trans-brown', orange: 'trans-orange',
  cyan: 'trans-cyan', lime: 'trans-lime', pink: 'trans-pink',
}

const migrateLegacyBrickColor = (brick: PlacedBrick): BrickColor => (
  brick.brickId === 'brick-trans-1x2' && Object.hasOwn(legacyTransparentColors, brick.color)
    ? legacyTransparentColors[brick.color]
    : brick.color
)

export const migrateLegacyTransparentColors = (plan: BuildPlan): BuildPlan => {
  let changed = false
  const bricks = plan.bricks.map((brick) => {
    const color = migrateLegacyBrickColor(brick)
    if (color === brick.color) return brick
    changed = true
    return { ...brick, color }
  })
  return changed ? { ...plan, bricks } : plan
}

export const normalizeImportedPlan = (plan: BuildPlan): BuildPlan => pruneBrickStructures({
  ...plan,
  structures: Array.isArray(plan.structures)
    ? plan.structures.filter((structure) => (
        typeof structure?.id === 'string' &&
        typeof structure?.name === 'string' &&
        typeof structure?.description === 'string' &&
        Array.isArray(structure?.brickIds)
      ))
    : [],
  bricks: plan.bricks.map((brick) => ({
    ...brick,
    color: migrateLegacyBrickColor(brick),
    pose: normalizeImportedPose(brick.pose as unknown as Record<string, unknown>),
    ...(brick.voxelState ? { voxelState: normalizeImportedVoxelState(brick.voxelState) } : {}),
  })),
})

export const tryNormalizeImportedPlan = (plan: BuildPlan) => {
  if (typeof plan.id !== 'string' || typeof plan.title !== 'string' || typeof plan.prompt !== 'string') return undefined
  const hasInvalidBrick = plan.bricks.some((brick) => !isRecord(brick) || typeof brick.id !== 'string' || typeof brick.brickId !== 'string' || typeof brick.color !== 'string' || !isValidImportedPose(brick.pose))
  if (hasInvalidBrick) return undefined
  if (plan.steps.some((step) => !isRecord(step) || typeof step.id !== 'string' || typeof step.title !== 'string' || typeof step.description !== 'string' || !Array.isArray(step.brickIds) || step.brickIds.some((id) => typeof id !== 'string'))) return undefined

  return normalizeImportedPlan(plan)
}
