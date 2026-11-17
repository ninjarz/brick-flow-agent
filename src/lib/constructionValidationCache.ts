import { brickById } from '../data/basicBricks'
import type { BuildPlan } from '../types/bricks'
import type { ConstructionValidator } from './manualSerializer'
import { createConstructionSceneBuilder } from './constructionScene'
import { getRigidBrickMatrix } from './rigidBrickTransform'
import type { BuildPlanIssue } from './planUtils'
import { prepareAnalysisGeometry } from './prepareAnalysisGeometry'
import type { LegacyConstructionSource } from './legacyConstructionMigration'

export type ConstructionValidationCache = {
  physicsRevision: string
  sourcePlanSha256: string
  steps: Record<string, { islands: number[][] }>
  legacy?: LegacyConstructionSource
}

/** Identity is irrelevant to mechanics; all moulds and staged transforms must match. */
export const createReferenceConstructionValidator = (plan: BuildPlan, reference: BuildPlan, cache: ConstructionValidationCache): ConstructionValidator => {
  const steps = new Map(reference.steps.map((step, index) => [step.id, { step, index }]))
  const introduced = new Map<string, number>()
  reference.steps.forEach((step, index) => { for (const id of step.brickIds) if (!introduced.has(id)) introduced.set(id, index) })
  const buildReference = createConstructionSceneBuilder(reference)
  // Bound cancellation in the affine reframe by the magnitude of its operands.
  let magnitude = 1
  for (const brick of plan.bricks) {
    const values = [brick.pose.xStud, brick.pose.yStud, brick.pose.zStud]
    if (!values.every(Number.isFinite)) return () => undefined
    for (const value of values) magnitude = Math.max(magnitude, Math.abs(value))
  }
  const translationRoundoff = 256 * Number.EPSILON * magnitude
  return (step, bricks) => {
    const key = step.construction?.sourceStepId ?? step.id
    const certificate = cache.steps[key], source = steps.get(key)
    if (!certificate || !source) return undefined
    const expected = buildReference(source.step, { has: id => (introduced.get(id) ?? Infinity) <= source.index })
    if (!expected || expected.bricks.length !== bricks.length) return undefined
    if (new Set(bricks.map(brick => brick.id)).size !== bricks.length) return undefined
    for (let index = 0; index < bricks.length; index++) {
      const actual = bricks[index], original = expected.bricks[index]
      if (actual.brickId !== original.brickId || actual.color !== original.color || JSON.stringify(actual.voxelState) !== JSON.stringify(original.voxelState)) return undefined
      const definition = brickById.get(actual.brickId)
      if (!definition) return undefined
      const a = getRigidBrickMatrix(definition, actual.pose).elements
      const b = getRigidBrickMatrix(definition, original.pose).elements
      if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) return undefined
      for (const element of [0,1,2,4,5,6,8,9,10]) if (Math.abs(a[element] - b[element]) > 1e-12) return undefined
      for (const element of [12,13,14]) if (Math.abs(a[element] - b[element]) > translationRoundoff) return undefined
    }
    const issues: BuildPlanIssue[] = []
    for (const [island, members] of certificate.islands.entries()) {
      for (const index of members) {
        if (!Number.isInteger(index) || !bricks[index]) return undefined
        issues.push({ type: 'disconnected-island', brickId: bricks[index].id, componentIndex: island + 2, componentCount: certificate.islands.length + 1 })
      }
    }
    return issues
  }
}

let trustedSource: Promise<{ plan: BuildPlan; cache: ConstructionValidationCache } | undefined> | undefined

export const loadVerifiedConstructionSource = () => {
  if (typeof __CONSTRUCTION_PHYSICS_REVISION__ === 'undefined' || !globalThis.crypto?.subtle) return Promise.resolve(undefined)
  if (!trustedSource) trustedSource = (async () => {
    const { default: snapshot } = await import('../data/hogwartsConstructionValidation.json')
    const cache = snapshot as unknown as ConstructionValidationCache
    if (cache.physicsRevision !== __CONSTRUCTION_PHYSICS_REVISION__) return undefined
    const { default: source } = await import('../data/legoHogwartsPlan.json')
    const plan = source as unknown as BuildPlan
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(plan)))
    const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
    if (hash !== cache.sourcePlanSha256) return undefined
    const definitions = [...new Set(plan.bricks.map(brick => brick.brickId))].map(id => brickById.get(id)!).filter(Boolean)
    await prepareAnalysisGeometry(definitions, [])
    return { plan, cache }
  })().catch(() => undefined)
  return trustedSource
}

export const prepareConstructionValidator = async (plan: BuildPlan): Promise<ConstructionValidator | undefined> => {
  if (!plan.steps.some(step => step.construction?.official?.set === '71043')) return undefined
  const source = await loadVerifiedConstructionSource()
  return source ? createReferenceConstructionValidator(plan, source.plan, source.cache) : undefined
}
