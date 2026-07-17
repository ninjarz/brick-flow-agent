import type { BrickStructure, BuildPlan } from '../types/bricks'

const normalizeText = (value: string) => value.trim().replace(/\s+/g, ' ')

export const getPlanStructures = (plan: BuildPlan) => plan.structures ?? []

export const getBrickStructure = (plan: BuildPlan, brickId: string) =>
  getPlanStructures(plan).find((structure) => structure.brickIds.includes(brickId))

export const getExactSelectionStructure = (plan: BuildPlan, selectedIds: string[]) => {
  const selectedIdSet = new Set(selectedIds)
  return getPlanStructures(plan).find((structure) => (
    structure.brickIds.length === selectedIdSet.size &&
    structure.brickIds.every((brickId) => selectedIdSet.has(brickId))
  ))
}

export type SolidifyStructureIssue = 'EMPTY_SELECTION' | 'BRICK_NOT_FOUND' | 'BRICK_ALREADY_SOLIDIFIED'

export type SolidifyStructureResult =
  | { ok: true; plan: BuildPlan; structure: BrickStructure }
  | { ok: false; plan: BuildPlan; issue: SolidifyStructureIssue }

export const solidifyBrickSelection = (
  plan: BuildPlan,
  brickIds: string[],
  options: { name?: string; description?: string } = {},
): SolidifyStructureResult => {
  const uniqueIds = [...new Set(brickIds)]
  if (uniqueIds.length === 0) return { ok: false, plan, issue: 'EMPTY_SELECTION' }
  const liveIds = new Set(plan.bricks.map((brick) => brick.id))
  if (uniqueIds.some((brickId) => !liveIds.has(brickId))) return { ok: false, plan, issue: 'BRICK_NOT_FOUND' }
  const assignedIds = new Set(getPlanStructures(plan).flatMap((structure) => structure.brickIds))
  if (uniqueIds.some((brickId) => assignedIds.has(brickId))) {
    return { ok: false, plan, issue: 'BRICK_ALREADY_SOLIDIFIED' }
  }
  const structureNumber = getPlanStructures(plan).length + 1
  const structure: BrickStructure = {
    id: `structure-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: normalizeText(options.name ?? '') || `结构 ${structureNumber}`,
    description: normalizeText(options.description ?? ''),
    brickIds: uniqueIds,
  }
  return {
    ok: true,
    structure,
    plan: { ...plan, structures: [...getPlanStructures(plan), structure] },
  }
}

export const updateBrickStructure = (plan: BuildPlan, updated: BrickStructure): BuildPlan => ({
  ...plan,
  structures: getPlanStructures(plan).map((structure) => structure.id === updated.id
    ? {
        ...updated,
        name: normalizeText(updated.name) || structure.name,
        description: updated.description.trim(),
      }
    : structure),
})

export const dissolveBrickStructure = (plan: BuildPlan, structureId: string): BuildPlan => ({
  ...plan,
  structures: getPlanStructures(plan).filter((structure) => structure.id !== structureId),
})

export const pruneBrickStructures = (plan: BuildPlan): BuildPlan => {
  const liveIds = new Set(plan.bricks.map((brick) => brick.id))
  const structures = getPlanStructures(plan)
    .map((structure) => ({
      ...structure,
      brickIds: structure.brickIds.filter((brickId) => liveIds.has(brickId)),
    }))
    .filter((structure) => structure.brickIds.length > 0)
  return { ...plan, structures }
}

