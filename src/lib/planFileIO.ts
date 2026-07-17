import { isValidImportedPose, normalizeImportedPose, tryNormalizeImportedPlan } from './planImport'
import type { BuildPlan, PlacedBrick } from '../types/bricks'
import type { WorldState } from '../types/world'
import { parseStoredWorldState } from './worldEntity'

export type ImportText = {
  importedPlanTitle: string
  importedStepTitle: (stepNumber: number) => string
}

const defaultImportText: ImportText = {
  importedPlanTitle: '导入的手册方案',
  importedStepTitle: (stepNumber) => `第 ${stepNumber} 步`,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isBuildPlan = (value: unknown): value is BuildPlan => {
  if (!isRecord(value)) return false
  const plan = value as Partial<BuildPlan>
  return Boolean(
    plan.id &&
      plan.title &&
      typeof plan.prompt === 'string' &&
      (plan.source === 'template-local' || plan.source === 'llm') &&
      Array.isArray(plan.bricks) &&
      Array.isArray(plan.steps),
  )
}

const isValidSource = (value: unknown): value is BuildPlan['source'] =>
  value === 'template-local' || value === 'llm'

const buildPlanFromManualJson = (
  value: unknown,
  text: ImportText,
): BuildPlan | undefined => {
  if (!isRecord(value) || ![1, 2, 3, 4, 5].includes(Number(value.schemaVersion)) || !Array.isArray(value.steps)) return undefined

  const bricks: PlacedBrick[] = []
  const steps: BuildPlan['steps'] = []

  value.steps.forEach((rawStep, stepIndex) => {
    if (!isRecord(rawStep) || !Array.isArray(rawStep.addPieces)) return

    const brickIds: string[] = []
    rawStep.addPieces.forEach((rawPiece) => {
      if (!isRecord(rawPiece) || typeof rawPiece.instanceId !== 'string' || typeof rawPiece.brickId !== 'string') return
      if (typeof rawPiece.color !== 'string' || !isValidImportedPose(rawPiece.pose)) return

      bricks.push({
        id: rawPiece.instanceId,
        brickId: rawPiece.brickId,
        color: rawPiece.color as PlacedBrick['color'],
        pose: normalizeImportedPose(rawPiece.pose),
      })
      brickIds.push(rawPiece.instanceId)
    })

    steps.push({
      id: `manual-step-${stepIndex + 1}`,
      title: typeof rawStep.title === 'string' ? rawStep.title : text.importedStepTitle(stepIndex + 1),
      description: typeof rawStep.description === 'string' ? rawStep.description : '',
      brickIds,
    })
  })

  if (bricks.length === 0 || steps.length === 0) return undefined

  return {
    id: typeof value.planId === 'string' ? value.planId : `imported-manual-${Date.now().toString(36)}`,
    title: typeof value.title === 'string' ? value.title : text.importedPlanTitle,
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
    source: isValidSource(value.source) ? value.source : 'template-local',
    bricks,
    steps,
  }
}

export const parseImportedPlan = (
  value: unknown,
  text: ImportText = defaultImportText,
): BuildPlan | undefined => {
  if (isBuildPlan(value)) return tryNormalizeImportedPlan(value)
  if (isRecord(value)) {
    const nestedPlan = parseImportedPlan(value.plan, text)
    if (nestedPlan) return nestedPlan
  }
  return buildPlanFromManualJson(value, text)
}

export type ImportedProject = {
  plan: BuildPlan
  world?: WorldState
}

export const parseImportedProject = (
  value: unknown,
  text: ImportText = defaultImportText,
): ImportedProject | undefined => {
  const plan = parseImportedPlan(value, text)
  if (!plan) return undefined
  const world = isRecord(value) && value.world !== undefined
    ? parseStoredWorldState(value.world, plan.id)
    : undefined
  return { plan, world }
}
