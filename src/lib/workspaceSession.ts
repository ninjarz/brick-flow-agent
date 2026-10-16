import type { BuildPlan } from '../types/bricks'
import type { WorldDirectorTurn, WorldState } from '../types/world'
import { createEmptyWorldState } from './worldEntity'
import { consumeWorldObjectEvents } from './worldObjectEventBridge'
import { synchronizePlanVoxelBlockStates } from './voxelBlockState'

export type WorkspaceSnapshot = { plan: BuildPlan; world: WorldState; prompt: string }
type HistoryEntry = { snapshot: WorkspaceSnapshot; scope: 'plan' | 'workspace' }
export type WorkspaceHistory = { past: HistoryEntry[]; future: HistoryEntry[] }

/** All user transactions, hydration and disposable playtests share this boundary.
 * Simulation updates intentionally do not create undo entries.
 */
export const createWorkspaceSession = (initial: WorkspaceSnapshot) => {
  const synchronize = (value: WorkspaceSnapshot): WorkspaceSnapshot => {
    const next = consumeWorldObjectEvents(value.plan, value.world)
    return next.plan === value.plan && next.world === value.world ? value : { ...value, ...next }
  }
  let snapshot = synchronize(initial)
  let history: WorkspaceHistory = { past: [], future: [] }
  let epoch = 0
  let revision = 0
  let editRevision = 0
  let checkpoint: { snapshot: WorkspaceSnapshot; history: WorkspaceHistory } | undefined
  const listeners = new Set<() => void>()
  const replacementListeners = new Set<(snapshot: WorkspaceSnapshot) => void>()
  const invalidationListeners = new Set<() => void>()
  const invalidate = () => { epoch += 1; invalidationListeners.forEach((listener) => listener()) }
  const commit = (next: WorkspaceSnapshot, editing = true) => {
    if (next === snapshot) return
    snapshot = synchronize(next)
    revision += 1
    if (editing) editRevision += 1
    listeners.forEach((listener) => listener())
  }
  const remember = (scope: HistoryEntry['scope']) => {
    history = { past: [...history.past.slice(-49), { snapshot, scope }], future: [] }
  }
  const replace = (next: WorkspaceSnapshot, record = true) => {
    if (checkpoint) { snapshot = checkpoint.snapshot; history = checkpoint.history; checkpoint = undefined }
    if (record) { replacementListeners.forEach(listener => listener(snapshot)); remember('workspace') }
    else history = { past: [], future: [] }
    invalidate()
    commit({ ...next, plan: synchronizePlanVoxelBlockStates(next.plan) })
  }
  const travel = (direction: 'undo' | 'redo') => {
    const source = direction === 'undo' ? history.past : history.future
    const entry = source.at(-1)
    if (!entry) return
    const inverse = { snapshot, scope: entry.scope }
    history = direction === 'undo'
      ? { past: source.slice(0, -1), future: [...history.future.slice(-49), inverse] }
      : { past: [...history.past.slice(-49), inverse], future: source.slice(0, -1) }
    invalidate()
    commit(entry.scope === 'workspace' ? entry.snapshot : { ...snapshot, plan: entry.snapshot.plan })
  }
  return {
    getSnapshot: () => snapshot,
    getHistory: () => history,
    getEpoch: () => epoch,
    getRevision: () => revision,
    getEditRevision: () => editRevision,
    getPersistentSnapshot: () => checkpoint?.snapshot ?? snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    onReplace: (listener: (snapshot: WorkspaceSnapshot) => void) => { replacementListeners.add(listener); return () => { replacementListeners.delete(listener) } },
    onInvalidate: (listener: () => void) => { invalidationListeners.add(listener); return () => { invalidationListeners.delete(listener) } },
    invalidate,
    replace,
    switchProject: (next: WorkspaceSnapshot, nextHistory: WorkspaceHistory = { past: [], future: [] }) => {
      checkpoint = undefined
      history = nextHistory
      invalidate()
      commit(next)
    },
    getPersistentHistory: () => checkpoint?.history ?? history,
    setPlan: (value: BuildPlan | ((current: BuildPlan) => BuildPlan)) => {
      const plan = synchronizePlanVoxelBlockStates(typeof value === 'function' ? value(snapshot.plan) : value)
      if (plan === snapshot.plan) return
      if (plan.id !== snapshot.plan.id) { replace({ plan, world: createEmptyWorldState(plan.id), prompt: plan.prompt }); return }
      remember('plan')
      commit({ ...snapshot, plan })
    },
    setWorld: (value: WorldState | ((current: WorldState) => WorldState)) => {
      const world = typeof value === 'function' ? value(snapshot.world) : value
      if (world !== snapshot.world) commit({ ...snapshot, world }, false)
    },
    editWorld: (value: WorldState | ((current: WorldState) => WorldState)) => {
      const world = typeof value === 'function' ? value(snapshot.world) : value
      if (world === snapshot.world) return
      remember('workspace')
      commit({ ...snapshot, world })
    },
    commitDirectorTurn: (requestEpoch: number, turn: WorldDirectorTurn) => {
      if (requestEpoch !== epoch) return false
      commit({ ...snapshot, world: { ...snapshot.world, narrative: {
        ...snapshot.world.narrative,
        directorTurns: [...snapshot.world.narrative.directorTurns.filter((entry) => entry.id !== turn.id), turn].slice(-100),
      } } }, false)
      return true
    },
    setPrompt: (value: string | ((current: string) => string)) => {
      const prompt = typeof value === 'function' ? value(snapshot.prompt) : value
      if (prompt !== snapshot.prompt) commit({ ...snapshot, prompt })
    },
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    beginPlaytest: (world: WorldState) => {
      if (checkpoint) return
      checkpoint = { snapshot, history }
      history = { past: [], future: [] }
      invalidate()
      commit({ ...snapshot, world })
    },
    restorePlaytest: () => {
      if (!checkpoint) return
      const saved = checkpoint
      checkpoint = undefined
      history = saved.history
      invalidate()
      commit(saved.snapshot)
    },
  }
}
