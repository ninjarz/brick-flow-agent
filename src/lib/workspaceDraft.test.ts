import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBrick } from './planUtils'
import { createEmptyWorldState } from './worldEntity'
import type { BuildPlan } from '../types/bricks'

const key = 'brick-flow-agent:workspace-draft:v1'
const plan: BuildPlan = { id: 'draft', title: 'Draft', prompt: '', source: 'template-local', bricks: [], steps: [] }
let values: Map<string, string>
beforeEach(() => {
  vi.resetModules()
  values = new Map()
  vi.stubGlobal('indexedDB', undefined)
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } })
})
afterEach(() => vi.unstubAllGlobals())

describe('draft recovery', () => {
  it.each(['empty', 'floating', 'overlapping'])('restores %s editing state without enforcing publish validation', async (kind) => {
    const { saveWorkspaceDraft, loadWorkspaceDraft } = await import('./workspaceDraft')
    const bricks = kind === 'empty' ? [] : [makeBrick('brick-2x2', 'gray', 0, 1.2, 0)]
    if (kind === 'overlapping') bricks.push({ ...bricks[0], id: 'overlapping' })
    const draft = { ...plan, bricks }
    expect(await saveWorkspaceDraft(draft, 'unfinished', createEmptyWorldState(plan.id))).toBe(true)
    expect(loadWorkspaceDraft()?.plan.bricks).toEqual(bricks)
  })

  it('retains corrupt source data and blocks replacement autosaves', async () => {
    const { loadWorkspaceDraft, getWorkspaceRecovery, saveWorkspaceDraft } = await import('./workspaceDraft')
    values.set(key, '{ damaged')
    expect(loadWorkspaceDraft()).toBeUndefined()
    expect(getWorkspaceRecovery()?.value).toBe('{ damaged')
    expect(await saveWorkspaceDraft(plan, '', createEmptyWorldState(plan.id))).toBe(false)
    expect(values.get(key)).toBe('{ damaged')
  })
})
