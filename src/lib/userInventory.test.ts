import { describe, expect, it } from 'vitest'
import { brickById, getDefaultBrickColor } from '../data/basicBricks'
import { getEffectiveInventory, normalizeInventoryOverrides } from './userInventory'

describe('user inventory', () => {
  it('sanitizes unknown, negative, and fractional values', () => {
    expect(normalizeInventoryOverrides({
      'brick-2x4': 3.9,
      'missing-part': 8,
      'brick-1x1': -2,
    })).toEqual({ 'brick-2x4': 3 })
  })

  it('uses overrides without changing untouched defaults', () => {
    const overrides = { 'brick-2x4': 5 }
    expect(getEffectiveInventory('brick-2x4', 99, overrides)).toBe(5)
    expect(getEffectiveInventory('brick-1x2', 99, overrides)).toBe(99)
  })

  it('prefers visible gray LEGO previews while keeping semantic Minecraft colors', () => {
    expect(getDefaultBrickColor(brickById.get('brick-2x4')!)).toBe('gray')
    expect(getDefaultBrickColor(brickById.get('minecraft-grass-block')!)).toBe('green')
  })
})
