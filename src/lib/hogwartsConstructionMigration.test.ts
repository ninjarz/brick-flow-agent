import { beforeAll, describe, expect, it } from 'vitest'
import sourceJson from '../data/legoHogwartsPlan.json'
import cacheJson from '../data/hogwartsConstructionValidation.json'
import { brickById } from '../data/basicBricks'
import type { BuildPlan } from '../types/bricks'
import { migrateLegacyConstructionInstances } from './legacyConstructionMigration'
import { normalizeImportedPlan } from './planImport'
import { prepareStructuralGeometry } from './prepareStructuralGeometry'
import { createConstructionSceneBuilder } from './constructionScene'
import { createReferenceConstructionValidator, type ConstructionValidationCache } from './constructionValidationCache'
import { getBlockingBuildPlanIssues, makeBrick, validateBuildPlan } from './planUtils'

const source = sourceJson as unknown as BuildPlan
const cache = cacheJson as unknown as ConstructionValidationCache
const legacy = cache.legacy!

beforeAll(async () => {
  await prepareStructuralGeometry([...new Set(source.bricks.map(brick => brick.brickId))].map(id => brickById.get(id)!))
}, 60_000)

describe('complete old Hogwarts workspace migration', () => {
  it('upgrades the saved 819-step instance, retains other models and recognizes every physical construction stage', () => {
    const extra = { ...makeBrick('brick-2x2', 'red', -20, 0, -20), id: 'other-model' }
    const old = normalizeImportedPlan({ ...source, constructionAssemblies: undefined, bricks: [extra, ...legacy.bricks],
      steps: [{ id: 'other-step', title: '', description: '', brickIds: [extra.id] }, ...legacy.steps.map((step, index) => ({ ...step, id: `old-${index}`, title: '', description: '' }))] })
    const migrated = migrateLegacyConstructionInstances(old, source, legacy)
    expect(migrated).not.toBe(old)
    expect(migrated.bricks[0]).toBe(old.bricks[0])
    expect(migrated.bricks.map(brick => brick.id)).toEqual(old.bricks.map(brick => brick.id))
    expect(migrated.steps).toHaveLength(source.steps.length + 1)
    expect(getBlockingBuildPlanIssues(validateBuildPlan(migrated))).toEqual([])
    const build = createConstructionSceneBuilder(migrated)
    const validate = createReferenceConstructionValidator(migrated, source, cache)
    const completed = new Set<string>([extra.id])
    for (const step of migrated.steps.slice(1)) {
      for (const id of step.brickIds) completed.add(id)
      const view = build(step, completed)!
      expect(validate(step, view.bricks), step.id).toBeDefined()
    }
  }, 120_000)
})
