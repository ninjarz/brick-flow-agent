import { safeStorage } from './safeStorage'
import type { BrickPack } from '../types/bricks'

export type CatalogPackPreference = BrickPack | 'npc'

export type CatalogPreferences = {
  pack: CatalogPackPreference
  kind: string
  query: string
}

const storageKey = 'brick-flow-agent:catalog-preferences:v1'
const validPacks = new Set<CatalogPackPreference>(['lego', 'minecraft', 'npc'])

export const defaultCatalogPreferences: CatalogPreferences = {
  pack: 'lego',
  kind: 'all',
  query: '',
}

export const normalizeCatalogPreferences = (value: unknown): CatalogPreferences => {
  if (!value || typeof value !== 'object') return defaultCatalogPreferences
  const candidate = value as Partial<CatalogPreferences>
  return {
    pack: validPacks.has(candidate.pack as CatalogPackPreference)
      ? candidate.pack as CatalogPackPreference
      : defaultCatalogPreferences.pack,
    kind: typeof candidate.kind === 'string' && candidate.kind.length <= 40 ? candidate.kind : 'all',
    query: typeof candidate.query === 'string' ? candidate.query.slice(0, 120) : '',
  }
}

export const loadCatalogPreferences = (): CatalogPreferences => {
  if (typeof window === 'undefined') return defaultCatalogPreferences
  try {
    return normalizeCatalogPreferences(JSON.parse(safeStorage.getItem(storageKey) ?? 'null'))
  } catch {
    return defaultCatalogPreferences
  }
}

export const saveCatalogPreferences = (preferences: CatalogPreferences) => {
  if (typeof window === 'undefined') return
  try {
    safeStorage.setItem(storageKey, JSON.stringify(normalizeCatalogPreferences(preferences)))
  } catch {
    // Catalog UI preferences are optional when browser storage is unavailable.
  }
}
