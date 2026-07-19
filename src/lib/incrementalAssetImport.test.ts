import { describe, expect, it } from 'vitest'
import type { BuildPlan } from '../types/bricks'
import { importAssetPlanIncrementally } from './incrementalAssetImport'
import { getBlockingBuildPlanIssues, makeBrick, validateBuildPlan } from './planUtils'

const plan = (id: string, bricks: BuildPlan['bricks'], steps: BuildPlan['steps'] = []): BuildPlan => ({
  id,
  title: id,
  prompt: id,
  source: 'template-local',
  bricks,
  steps,
})

const deterministicIds = () => {
  let index = 0
  return (prefix: string) => `${prefix}-import-${index++}`
}

describe('incremental asset import', () => {
  it('keeps the current plan identity and places imported bricks beside it', () => {
    const currentBrick = makeBrick('brick-2x2', 'gray', 0, 0, 0)
    const assetBrick = makeBrick('brick-2x2', 'red', 0, 0, 0)
    const current = plan('current-plan', [currentBrick], [{
      id: 'current-step',
      title: 'Current step',
      description: '',
      brickIds: [currentBrick.id],
    }])
    const asset = plan('asset-plan', [assetBrick], [{
      id: 'asset-step',
      title: 'Asset step',
      description: '',
      brickIds: [assetBrick.id],
    }])

    const result = importAssetPlanIncrementally(current, asset, deterministicIds())!

    expect(result.plan.id).toBe(current.id)
    expect(result.plan.title).toBe(current.title)
    expect(result.plan.bricks[0]).toBe(currentBrick)
    expect(result.plan.bricks).toHaveLength(2)
    expect(result.importedBrickIds[0]).not.toBe(assetBrick.id)
    expect(result.brickIdMap[assetBrick.id]).toBe(result.importedBrickIds[0])
    expect(result.placementOffset.x).toBeGreaterThanOrEqual(0)
    expect(result.plan.steps.at(-1)?.brickIds).toEqual(result.importedBrickIds)
    expect(getBlockingBuildPlanIssues(validateBuildPlan(result.plan))).toEqual([])
  })

  it('can import the same structured asset repeatedly without id collisions', () => {
    const first = makeBrick('brick-1x1', 'red', 0, 0, 0)
    const second = makeBrick('brick-1x1', 'blue', 1, 0, 0)
    const asset = {
      ...plan('asset', [first, second], [{
        id: 'asset-step', title: 'Pair', description: '', brickIds: [first.id, second.id],
      }]),
      structures: [{ id: 'asset-structure', name: 'Pair', description: '', brickIds: [first.id, second.id] }],
    }
    const idFactory = deterministicIds()
    const initial = plan('workspace', [])
    const once = importAssetPlanIncrementally(initial, asset, idFactory)!
    const twice = importAssetPlanIncrementally(once.plan, asset, idFactory)!
    const brickIds = twice.plan.bricks.map((brick) => brick.id)
    const stepIds = twice.plan.steps.map((step) => step.id)
    const structureIds = (twice.plan.structures ?? []).map((structure) => structure.id)

    expect(new Set(brickIds).size).toBe(brickIds.length)
    expect(new Set(stepIds).size).toBe(stepIds.length)
    expect(new Set(structureIds).size).toBe(structureIds.length)
    expect(twice.plan.structures).toHaveLength(2)
    expect(twice.structureIdMap['asset-structure']).toBe(twice.plan.structures?.at(-1)?.id)
    expect(getBlockingBuildPlanIssues(validateBuildPlan(twice.plan))).toEqual([])
  })
})
