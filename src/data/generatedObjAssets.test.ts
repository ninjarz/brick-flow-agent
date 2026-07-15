import { describe, expect, it } from 'vitest'
import { getConnectedBrickComponents } from '../lib/planUtils'
import { generatedObjAssets } from './generatedObjAssets'

describe('compact generated OBJ assets', () => {
  it('expands all generated pieces and one-piece steps without losing identity', () => {
    expect(generatedObjAssets.map((asset) => asset.plan.bricks.length)).toEqual([245, 681, 1365, 91])
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

  it('uses curved edge bricks for the Stanford Bunny presets', () => {
    const bunnyAssets = generatedObjAssets.filter((asset) => asset.id.includes('stanford-bunny'))
    expect(bunnyAssets).toHaveLength(3)
    for (const asset of bunnyAssets) {
      expect(asset.plan.bricks.some((brick) => brick.brickId === 'slope-curved-2x1-low'), asset.title).toBe(true)
      expect(asset.plan.bricks.some((brick) => brick.brickId === 'slope-1x2'), asset.title).toBe(false)
    }
  })
})
