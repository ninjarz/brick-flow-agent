import { isValidOrientationMatrix } from './brickUnits'
import { getOrientationResidual } from './rigidBrickTransform'
import type { BuildConstructionStep, BuildPlan, ConstructionGroup } from '../types/bricks'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const rigidMatrix = (value: unknown): value is number[] => {
  if (!Array.isArray(value) || value.length !== 16 || !value.every(Number.isFinite)) return false
  if ([3,7,11].some(index => Math.abs(value[index]) > 1e-12) || Math.abs(value[15] - 1) > 1e-12) return false
  const orientation = [value[0],value[4],value[8], value[1],value[5],value[9], value[2],value[6],value[10]]
  return isValidOrientationMatrix(orientation) && getOrientationResidual(orientation) <= 1e-12
}

export const isValidConstructionData = (plan: BuildPlan) => {
  const assemblies = plan.constructionAssemblies
  if (assemblies === undefined) return plan.steps.every(step => step.construction === undefined)
  if (!record(assemblies)) return false
  const ids = new Set(plan.bricks.map(brick => brick.id))
  const validIds = (value: unknown) => Array.isArray(value) && value.every(id => typeof id === 'string' && ids.has(id)) && new Set(value).size === value.length
  if (Object.values(assemblies).some(assembly => !record(assembly) || !validIds(assembly.brickIds))) return false
  const validGroup = (group: unknown) => record(group) && typeof group.assemblyId === 'string' && Object.hasOwn(assemblies, group.assemblyId)
    && (group.baseBrickId === undefined || typeof group.baseBrickId === 'string' && ids.has(group.baseBrickId))
    && (group.flip === undefined || typeof group.flip === 'boolean')
  for (const step of plan.steps) {
    const stage = step.construction
    if (stage === undefined) continue
    if (!validGroup(stage)) return false
    if (stage.sourceStepId !== undefined && typeof stage.sourceStepId !== 'string') return false
    if (stage.groups !== undefined && (!Array.isArray(stage.groups) || !stage.groups.length || !stage.groups.every(validGroup))) return false
    if (stage.adjustments !== undefined && (!Array.isArray(stage.adjustments) || !stage.adjustments.every(adjustment => record(adjustment)
      && typeof adjustment.brickId === 'string' && ids.has(adjustment.brickId)
      && typeof adjustment.anchorBrickId === 'string' && ids.has(adjustment.anchorBrickId) && rigidMatrix(adjustment.matrix)))) return false
    for (const value of [stage.hiddenPrintBrickIds, stage.focusBrickIds]) if (value !== undefined && !validIds(value)) return false
    if (stage.official !== undefined) {
      const source = stage.official
      if (!record(source) || typeof source.set !== 'string' || !Number.isInteger(source.book) || source.book <= 0 || !Number.isInteger(source.page) || source.page <= 0) return false
      for (const value of [source.numberedStep, source.inset]) if (value !== undefined && (!Number.isInteger(value) || value <= 0)) return false
    }
  }
  return true
}

export const remapConstructionStep = (stage: BuildConstructionStep | undefined, ids: Map<string, string>, assemblies: Map<string, string>): BuildConstructionStep | undefined => {
  if (!stage) return undefined
  const group = (item: ConstructionGroup): ConstructionGroup => ({ ...item, assemblyId: assemblies.get(item.assemblyId)!,
    ...(item.baseBrickId ? { baseBrickId: ids.get(item.baseBrickId)! } : {}) })
  return {
    ...stage,
    ...group(stage),
    ...(stage.groups ? { groups: stage.groups.map(group) } : {}),
    ...(stage.adjustments ? { adjustments: stage.adjustments.map(item => ({ ...item, brickId: ids.get(item.brickId)!, anchorBrickId: ids.get(item.anchorBrickId)!, matrix: [...item.matrix] })) } : {}),
    ...(stage.hiddenPrintBrickIds ? { hiddenPrintBrickIds: stage.hiddenPrintBrickIds.map(id => ids.get(id)!) } : {}),
    ...(stage.focusBrickIds ? { focusBrickIds: stage.focusBrickIds.map(id => ids.get(id)!) } : {}),
  }
}

/** Deleted datums invalidate their recipe, while other edited stages remain usable. */
export const pruneConstructionData = (plan: BuildPlan): BuildPlan => {
  if (!plan.constructionAssemblies) return plan
  const ids = new Set(plan.bricks.map(brick => brick.id))
  const assemblies = Object.fromEntries(Object.entries(plan.constructionAssemblies).map(([id, assembly]) => [id, {
    brickIds: assembly.brickIds.filter(brickId => ids.has(brickId)),
  }] as const).filter(([, assembly]) => assembly.brickIds.length))
  const available = (group: ConstructionGroup) => Object.hasOwn(assemblies, group.assemblyId) && (!group.baseBrickId || ids.has(group.baseBrickId))
  const steps = plan.steps.map(step => {
    const stage = step.construction
    if (!stage) return step
    if (![stage, ...(stage.groups ?? [])].every(available) || stage.adjustments?.some(item => !ids.has(item.anchorBrickId))) return { ...step, construction: undefined }
    const included = new Set(assemblies[stage.assemblyId].brickIds)
    if (step.brickIds.some(id => !included.has(id))) return { ...step, construction: undefined }
    return { ...step, construction: { ...stage,
      ...(stage.adjustments ? { adjustments: stage.adjustments.filter(item => ids.has(item.brickId)) } : {}),
      ...(stage.hiddenPrintBrickIds ? { hiddenPrintBrickIds: stage.hiddenPrintBrickIds.filter(id => ids.has(id)) } : {}),
      ...(stage.focusBrickIds ? { focusBrickIds: stage.focusBrickIds.filter(id => ids.has(id)) } : {}),
    } }
  }).filter(step => step.brickIds.length > 0 || step.construction)
  return { ...plan, constructionAssemblies: assemblies, steps }
}
