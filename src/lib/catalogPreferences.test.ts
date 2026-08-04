import { describe, expect, it } from 'vitest'
import { defaultCatalogPreferences, normalizeCatalogPreferences } from './catalogPreferences'

describe('catalog preferences', () => {
  it('preserves a valid Minecraft catalog state', () => {
    expect(normalizeCatalogPreferences({ pack: 'minecraft', kind: 'wood', query: '栅栏' })).toEqual({
      pack: 'minecraft',
      kind: 'wood',
      query: '栅栏',
    })
  })

  it('bounds malformed or oversized persisted values', () => {
    expect(normalizeCatalogPreferences({ pack: 'unknown', kind: 3, query: 'x'.repeat(140) })).toEqual({
      ...defaultCatalogPreferences,
      query: 'x'.repeat(120),
    })
  })
})
