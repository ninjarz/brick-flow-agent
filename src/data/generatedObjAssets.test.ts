import { describe, expect, it } from 'vitest'
import { generatedObjAssets } from './generatedObjAssets'

describe('compact generated OBJ assets', () => {
  it('expands all generated pieces and one-piece steps without losing identity', () => {
    expect(generatedObjAssets.map((asset) => asset.plan.bricks.length)).toEqual([211, 604, 1244, 92])
    for (const asset of generatedObjAssets) {
      expect(asset.plan.steps).toHaveLength(asset.plan.bricks.length)
      expect(asset.plan.steps.every((step, index) => step.brickIds[0] === asset.plan.bricks[index].id)).toBe(true)
      expect(new Set(asset.plan.bricks.map((brick) => brick.id)).size).toBe(asset.plan.bricks.length)
    }
  })
})
