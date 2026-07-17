import {
  indexedDbStorageMarker,
  isIndexedDbStorageMarker,
  localStorageComfortLimit,
  readLargeStoredValue,
  removeLargeStoredValue,
  writeLargeStoredValue,
} from './browserStorage'
import { parseImportedPlan } from './planFileIO'
import { getBlockingBuildPlanIssues, validateBuildPlan } from './planUtils'
import type { BuildPlan } from '../types/bricks'
import { createEmptyWorldState, parseStoredWorldState } from './worldEntity'
import type { WorldState } from '../types/world'

const storageKey = 'brick-flow-agent:workspace-draft:v1'
const indexedDbKey = 'workspace-draft:v1'

export type WorkspaceDraft = {
  plan: BuildPlan
  prompt: string
  world: WorldState
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const normalizeWorkspaceDraft = (value: unknown): WorkspaceDraft | undefined => {
  if (!isRecord(value)) return undefined
  const plan = parseImportedPlan(value.plan)
  if (!plan || getBlockingBuildPlanIssues(validateBuildPlan(plan)).length > 0) return undefined
  return {
    plan,
    prompt: typeof value.prompt === 'string' ? value.prompt : plan.prompt,
    world: parseStoredWorldState(value.world, plan.id) ?? createEmptyWorldState(plan.id),
  }
}

export const loadWorkspaceDraft = () => {
  if (typeof window === 'undefined') return undefined
  try {
    const stored = window.localStorage.getItem(storageKey)
    if (!stored || isIndexedDbStorageMarker(stored)) return undefined
    return normalizeWorkspaceDraft(JSON.parse(stored) as unknown)
  } catch {
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
    return normalizeWorkspaceDraft(await readLargeStoredValue<unknown>(indexedDbKey))
  } catch {
    return undefined
  }
}

let saveQueue = Promise.resolve(true)

const persistWorkspaceDraft = async (plan: BuildPlan, prompt: string, world: WorldState) => {
  if (typeof window === 'undefined') return true
  const value = { schemaVersion: 2, prompt, plan, world }
  const serialized = JSON.stringify(value)

  if (serialized.length <= localStorageComfortLimit) {
    try {
      window.localStorage.setItem(storageKey, serialized)
      await removeLargeStoredValue(indexedDbKey).catch(() => undefined)
      return true
    } catch {
      // Fall through to IndexedDB when localStorage is unavailable or full.
    }
  }

  try {
    await writeLargeStoredValue(indexedDbKey, value)
    window.localStorage.removeItem(storageKey)
    window.localStorage.setItem(storageKey, indexedDbStorageMarker)
    return true
  } catch {
    return false
  }
}

export const saveWorkspaceDraft = (plan: BuildPlan, prompt: string, world: WorldState) => {
  const nextSave = saveQueue.then(() => persistWorkspaceDraft(plan, prompt, world))
  saveQueue = nextSave.catch(() => false)
  return nextSave
}

export const clearWorkspaceDraft = async () => {
  if (typeof window !== 'undefined') window.localStorage.removeItem(storageKey)
  await removeLargeStoredValue(indexedDbKey).catch(() => undefined)
}
