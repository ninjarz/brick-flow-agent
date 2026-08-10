import { describe, expect, it } from 'vitest'
import { minecraftSceneAssets } from './minecraftSceneAssets'
import { importAssetPlanIncrementally } from '../lib/incrementalAssetImport'
import { getBlockingBuildPlanIssues, validateBuildPlan } from '../lib/planUtils'
import type { BuildPlan } from '../types/bricks'

const emptyPlan: BuildPlan = {
  id: 'workspace',
  title: 'Workspace',
  prompt: '',
  source: 'template-local',
  bricks: [],
  steps: [],
}

describe('Minecraft scene assets', () => {
  it('ships original, editable, structurally valid voxel scenes', () => {
    expect(minecraftSceneAssets).toHaveLength(4)
    for (const asset of minecraftSceneAssets) {
      expect(asset.plan.bricks.length).toBeGreaterThan(50)
      expect(asset.plan.bricks.every((brick) => brick.brickId.startsWith('minecraft-'))).toBe(true)
      expect(asset.plan.structures?.[0].brickIds).toHaveLength(asset.plan.bricks.length)
      expect(getBlockingBuildPlanIssues(validateBuildPlan(asset.plan))).toEqual([])
    }
  })

  it('loads each scene incrementally without replacing the workspace', () => {
    let id = 0
    const idFactory = (prefix: string) => `${prefix}-scene-${id++}`
    let plan = emptyPlan
    for (const asset of minecraftSceneAssets) {
      const previousCount = plan.bricks.length
      const result = importAssetPlanIncrementally(plan, asset.plan, idFactory)
      expect(result).toBeDefined()
      plan = result!.plan
      expect(plan.id).toBe(emptyPlan.id)
      expect(plan.bricks.length).toBe(previousCount + asset.plan.bricks.length)
    }
    expect(getBlockingBuildPlanIssues(validateBuildPlan(plan))).toEqual([])
  })
})
