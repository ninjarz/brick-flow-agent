import type { BuildPlan, PlacedBrick } from '../types/bricks'
import {
  normalizeHorizontalStud,
  normalizeQuarterTurns,
  normalizeVerticalQuarterTurns,
  normalizeYStud,
  plateHeightToWorldStud,
} from './brickUnits'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const isValidImportedPose = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false

  return (
    Number.isFinite(value.xStud) &&
    (Number.isFinite(value.yStud) || Number.isFinite(value.yPlate)) &&
    Number.isFinite(value.zStud) &&
    [0, 1, 2, 3].includes(Number(value.rotationQuarterTurns)) &&
    (value.verticalQuarterTurns === undefined || [0, 1, 2, 3].includes(Number(value.verticalQuarterTurns)))
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
})

export const normalizeImportedPlan = (plan: BuildPlan): BuildPlan => ({
  ...plan,
  bricks: plan.bricks.map((brick) => ({
    ...brick,
    pose: normalizeImportedPose(brick.pose as unknown as Record<string, unknown>),
  })),
})

export const tryNormalizeImportedPlan = (plan: BuildPlan) => {
  const hasInvalidBrick = plan.bricks.some((brick) => !isValidImportedPose(brick.pose))
  if (hasInvalidBrick) return undefined

  return normalizeImportedPlan(plan)
}
