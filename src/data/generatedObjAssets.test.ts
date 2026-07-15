import { describe, expect, it } from 'vitest'
import { getConnectedBrickComponents } from '../lib/planUtils'
import { generatedObjAssets } from './generatedObjAssets'

describe('compact generated OBJ assets', () => {
  it('expands all generated pieces and one-piece steps without losing identity', () => {
    expect(generatedObjAssets.map((asset) => asset.plan.bricks.length)).toEqual([212, 603, 1243, 91])
    for (const asset of generatedObjAssets) {
      expect(asset.plan.steps).toHaveLength(asset.plan.bricks.length)
      expect(asset.plan.steps.every((step, index) => step.brickIds[0] === asset.plan.bricks[index].id)).toBe(true)
      expect(new Set(asset.plan.bricks.map((brick) => brick.id)).size).toBe(asset.plan.bricks.length)
    }
  })

  it('keeps every generated OBJ model in one movable structure', () => {
    for (const asset of generatedObjAssets) {
      expect(getConnectedBrickComponents(asset.plan.bricks), asset.title).toHaveLength(1)
    }
  })
})
