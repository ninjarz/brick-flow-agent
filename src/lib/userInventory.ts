import { safeStorage } from './safeStorage'
import { brickById } from '../data/basicBricks'

export type InventoryOverrides = Record<string, number>

export const inventoryStorageKey = 'brick-flow-agent:user-inventory:v1'

export const normalizeInventoryOverrides = (value: unknown): InventoryOverrides => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(Object.entries(value).flatMap(([brickId, rawInventory]) => {
    const inventory = Number(rawInventory)
    if (!brickById.has(brickId) || !Number.isFinite(inventory) || inventory < 0) return []
    return [[brickId, Math.floor(inventory)]]
  }))
}

export const loadInventoryOverrides = (): InventoryOverrides => {
  if (typeof window === 'undefined') return {}
  try {
    return normalizeInventoryOverrides(JSON.parse(safeStorage.getItem(inventoryStorageKey) ?? '{}'))
  } catch {
    return {}
  }
}

export const saveInventoryOverrides = (overrides: InventoryOverrides) => {
  if (Object.keys(overrides).length === 0) {
    safeStorage.removeItem(inventoryStorageKey)
    return
  }
  safeStorage.setItem(inventoryStorageKey, JSON.stringify(overrides))
}

export const getEffectiveInventory = (
  brickId: string,
  defaultInventory: number,
  overrides: InventoryOverrides,
) => overrides[brickId] ?? defaultInventory
