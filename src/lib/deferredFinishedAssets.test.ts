import { describe, expect, it } from 'vitest'
import hogwartsJson from '../data/legoHogwartsPlan.json'
import type { BuildPlan } from '../types/bricks'
import {
  defaultFinishedAssets,
  getFinishedAssetCounts,
  hogwartsAssetId,
  hogwartsPlanSummary,
  isFinishedAssetPlanDeferred,
  resolveFinishedAssetPlan,
} from './finishedAssets'

const shipped = hogwartsJson as unknown as BuildPlan
const placeholder = () => defaultFinishedAssets.find((asset) => asset.id === hogwartsAssetId)!

describe('deferred Hogwarts replica', () => {
  it('keeps the placeholder summary in sync with the shipped plan', () => {
    expect(hogwartsPlanSummary).toEqual({
      id: shipped.id,
      title: shipped.title,
      prompt: shipped.prompt,
      brickCount: shipped.bricks.length,
      stepCount: shipped.steps.length,
    })
  })

  it('lists the replica without its bricks but with the real counts', () => {
    const asset = placeholder()
    expect(isFinishedAssetPlanDeferred(asset)).toBe(true)
    expect(asset.plan.bricks).toHaveLength(0)
    expect(getFinishedAssetCounts(asset)).toEqual({ bricks: 6025, steps: shipped.steps.length })
  })

  it('resolves the full plan once and leaves other assets untouched', async () => {
    const [first, second] = await Promise.all([resolveFinishedAssetPlan(placeholder()), resolveFinishedAssetPlan(placeholder())])
    expect(first.deferredPlan).toBeUndefined()
    expect(first.plan.bricks).toHaveLength(6025)
    expect(first.plan.constructionAssemblies).toBeDefined()
    expect(second.plan).toBe(first.plan)
    expect(placeholder().plan.bricks).toHaveLength(0)
    const regular = defaultFinishedAssets.find((asset) => asset.id === 'finished-lego-30023')!
    expect(await resolveFinishedAssetPlan(regular)).toBe(regular)
  })
})
