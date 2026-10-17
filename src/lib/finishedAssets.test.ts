import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultFinishedAssets, loadFinishedAssets, loadFinishedAssetsFromIndexedDb, mergeRecoveredFinishedAssets, needsFinishedAssetsRecovery, saveFinishedAssets } from './finishedAssets'

const storage = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), remove: vi.fn() }))
vi.mock('./browserStorage', () => ({
  indexedDbStorageMarker: '__brick_flow_agent_indexeddb__',
  isIndexedDbStorageMarker: (value: unknown) => value === '__brick_flow_agent_indexeddb__',
  localStorageComfortLimit: 2_500_000,
  readLargeStoredValue: storage.read, writeLargeStoredValue: storage.write, removeLargeStoredValue: storage.remove,
}))
vi.mock('./storageCoordinator', () => ({ areStorageWritesPaused: () => false, coordinateStorageWrite: (write: () => Promise<boolean>) => write() }))
const key = 'brick-flow-agent:finished-assets:v18'
const marker = '__brick_flow_agent_indexeddb__'
// The curved entry and antenna need precise geometry: recovery must prepare it
// before validating, even when this asset has never been rendered in the session.
const asset = { ...defaultFinishedAssets.find((entry) => entry.id === 'finished-lego-21000')!, id: 'custom-one', title: 'Saved work' }
let values: Map<string, string>
beforeEach(() => {
  vi.resetAllMocks()
  values = new Map([[key, marker]])
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } })
  storage.read.mockResolvedValue(undefined)
  storage.remove.mockResolvedValue(undefined)
  storage.write.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

describe('finished asset recovery', () => {
  it('preserves the marker and stored copy when reads fail, then allows a successful retry', async () => {
    storage.read.mockRejectedValueOnce(new Error('temporarily unavailable')).mockResolvedValueOnce([asset])
    expect(loadFinishedAssets()).toEqual(defaultFinishedAssets)
    expect(await loadFinishedAssetsFromIndexedDb()).toEqual({ status: 'unavailable' })
    expect(await saveFinishedAssets(defaultFinishedAssets)).toBe(false)
    expect(values.get(key)).toBe(marker)
    expect(storage.remove).not.toHaveBeenCalled()
    expect(storage.write).not.toHaveBeenCalled()
    const recovered = await loadFinishedAssetsFromIndexedDb()
    expect(recovered.status).toBe('loaded')
    if (recovered.status !== 'loaded') throw new Error('Recovery failed')
    expect(recovered.assets.find((entry) => entry.id === asset.id)).toMatchObject({ title: asset.title, id: asset.id })
    expect(await saveFinishedAssets(recovered.assets)).toBe(true)
    expect(JSON.parse(values.get(key)!).map((entry: { id: string }) => entry.id)).toEqual([asset.id])
  })

  it.each([{ label: 'null', payload: null }, { label: 'object', payload: {} }, { label: 'partially invalid', payload: [asset, { id: 'broken' }] }])('does not overwrite a $label database payload', async ({ payload }) => {
    storage.read.mockResolvedValue(payload)
    expect(await loadFinishedAssetsFromIndexedDb()).toEqual({ status: 'invalid' })
    expect(await saveFinishedAssets(defaultFinishedAssets)).toBe(false)
    expect(values.get(key)).toBe(marker)
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('distinguishes a missing database entry from an expected copy that is missing', async () => {
    expect(await loadFinishedAssetsFromIndexedDb()).toEqual({ status: 'invalid' })
    values.clear()
    expect(await loadFinishedAssetsFromIndexedDb()).toEqual({ status: 'missing' })
    expect(await saveFinishedAssets(defaultFinishedAssets)).toBe(true)
  })

  it('protects malformed inline data as well as IndexedDB copies', async () => {
    values.set(key, '{broken')
    loadFinishedAssets()
    expect(needsFinishedAssetsRecovery()).toBe(true)
    expect(await loadFinishedAssetsFromIndexedDb()).toEqual({ status: 'invalid' })
    expect(await saveFinishedAssets(defaultFinishedAssets)).toBe(false)
    expect(values.get(key)).toBe('{broken')
  })

  it('merges edits made during recovery and keeps new versions of matching IDs', () => {
    const edited = { ...asset, title: 'Edited while loading' }
    const added = { ...asset, id: 'custom-two', title: 'Added while loading' }
    const merged = mergeRecoveredFinishedAssets([...defaultFinishedAssets, asset], [...defaultFinishedAssets, edited, added])
    expect(merged.filter((entry) => entry.id.startsWith('custom-'))).toEqual([edited, added])
  })
})
