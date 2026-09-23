import {
  indexedDbStorageMarker,
  isIndexedDbStorageMarker,
  localStorageComfortLimit,
  readLargeStoredValue,
  removeLargeStoredValue,
  writeLargeStoredValue,
} from './browserStorage'
import { parseImportedPlan } from './planFileIO'
import type { BuildPlan } from '../types/bricks'
import { createEmptyWorldState, parseStoredWorldState } from './worldEntity'
import type { WorldState } from '../types/world'
import { createCoalescedAsyncWriter } from './coalescedWriter'
import { createWorkspaceSerializer } from './workspaceSerialization'
import { safeStorage } from './safeStorage'
import { coordinateStorageWrite } from './storageCoordinator'

const storageKey = 'brick-flow-agent:workspace-draft:v1'
const indexedDbKey = 'workspace-draft:v1'
const serializeWorkspace = createWorkspaceSerializer()
let recovery: { source: string; value: unknown } | undefined
let clearing = false
let latestSavedAt = 0
export const getWorkspaceRecovery = () => recovery

export type WorkspaceDraft = {
  plan: BuildPlan
  prompt: string
  world: WorldState
  savedAt?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const normalizeWorkspaceDraft = (value: unknown): WorkspaceDraft | undefined => {
  if (!isRecord(value)) return undefined
  const plan = parseImportedPlan(value.plan)
  if (!plan) return undefined
  const world = parseStoredWorldState(value.world, plan.id)
  if (value.world !== undefined && !world) return undefined
  const savedAt = typeof value.savedAt === 'number' && Number.isFinite(value.savedAt) ? value.savedAt : 0
  latestSavedAt = Math.max(latestSavedAt, savedAt)
  return {
    plan,
    prompt: typeof value.prompt === 'string' ? value.prompt : plan.prompt,
    world: world ?? createEmptyWorldState(plan.id),
    savedAt,
  }
}

export const loadWorkspaceDraft = () => {
  if (typeof window === 'undefined') return undefined
  const stored = safeStorage.getItem(storageKey)
  try {
    if (!stored || isIndexedDbStorageMarker(stored)) return undefined
    const result = normalizeWorkspaceDraft(JSON.parse(stored) as unknown)
    if (!result) recovery = { source: 'localStorage', value: stored }
    return result
  } catch {
    if (stored) recovery = { source: 'localStorage', value: stored }
    return undefined
  }
}

export const hasIndexedDbWorkspaceDraft = () => {
  if (typeof window === 'undefined') return false
  try {
    return isIndexedDbStorageMarker(window.localStorage.getItem(storageKey))
  } catch {
    return false
  }
}

export const loadWorkspaceDraftFromIndexedDb = async () => {
  try {
    const stored = await readLargeStoredValue<unknown>(indexedDbKey)
    if (stored === undefined) return undefined
    const result = normalizeWorkspaceDraft(stored)
    if (!result) recovery = { source: 'IndexedDB', value: stored }
    // Marker updates or removal may fail independently of the database write.
    // Prefer the newest payload when both storage backends contain a draft.
    const inline = loadWorkspaceDraft()
    if (inline && (inline.savedAt ?? 0) >= (result?.savedAt ?? 0)) return undefined
    return result
  } catch {
    if (hasIndexedDbWorkspaceDraft()) recovery = { source: 'IndexedDB unavailable', value: null }
    return undefined
  }
}

const persistWorkspaceDraft = async (plan: BuildPlan, prompt: string, world: WorldState) => {
  if (typeof window === 'undefined') return true
  if (recovery || clearing) return false
  latestSavedAt = Math.max(Date.now(), latestSavedAt + 1)
  const { value, serialized } = serializeWorkspace(plan, prompt, world, localStorageComfortLimit, latestSavedAt)

  if (serialized) {
    try {
      if (!safeStorage.setItem(storageKey, serialized)) throw new Error('LOCAL_STORAGE_UNAVAILABLE')
      await removeLargeStoredValue(indexedDbKey).catch(() => undefined)
      return true
    } catch {
      // Fall through to IndexedDB when localStorage is unavailable or full.
    }
  }

  try {
    await writeLargeStoredValue(indexedDbKey, value)
    safeStorage.removeItem(storageKey)
    safeStorage.setItem(storageKey, indexedDbStorageMarker)
    return true
  } catch {
    return false
  }
}

const workspaceDraftWriter = createCoalescedAsyncWriter<WorkspaceDraft>(({ plan, prompt, world }) =>
  coordinateStorageWrite(() => persistWorkspaceDraft(plan, prompt, world))
)

export const saveWorkspaceDraft = (plan: BuildPlan, prompt: string, world: WorldState) =>
  workspaceDraftWriter.write({ plan, prompt, world })

export const clearWorkspaceDraft = async () => {
  clearing = true
  try {
    await workspaceDraftWriter.cancelPendingAndWait()
    const needsIndexedDb = hasIndexedDbWorkspaceDraft() || recovery?.source.startsWith('IndexedDB')
    safeStorage.removeItem(storageKey)
    await removeLargeStoredValue(indexedDbKey).catch((error) => { if (needsIndexedDb) throw error })
    recovery = undefined
  } finally { clearing = false }
}
