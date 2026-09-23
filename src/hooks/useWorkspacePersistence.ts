import { useCallback, useEffect, useRef, useState } from 'react'
import type { createWorkspaceSession, WorkspaceHistory, WorkspaceSnapshot } from '../lib/workspaceSession'
import { getWorkspaceRecovery, loadWorkspaceDraftFromIndexedDb, saveWorkspaceDraft } from '../lib/workspaceDraft'
import { projectStore, ProjectConflict, type Project, type ProjectIndex, type ProjectCheckpoint } from '../lib/projectStore'
import { createEmptyWorldState } from '../lib/worldEntity'
import { claimLegacyProjectAnalysis, clearProjectAnalysis } from '../lib/projectAnalysisStorage'

type Status = 'loading' | 'saving' | 'saved' | 'unavailable' | 'recovery' | 'conflict'
export const useWorkspacePersistence = (session: ReturnType<typeof createWorkspaceSession>) => {
  const [hydrated, setHydrated] = useState(false)
  const [status, setStatus] = useState<Status>('loading')
  const [projects, setProjects] = useState<ProjectIndex[]>([])
  const [current, setCurrent] = useState<Project>()
  const [checkpoints, setCheckpoints] = useState<ProjectCheckpoint[]>([])
  const [busy, setBusy] = useState(false)
  const active = useRef<Project>()
  const blocked = useRef(false)
  const lastSaved = useRef<WorkspaceSnapshot>()
  const histories = useRef(new Map<string, WorkspaceHistory>())
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(operation)
    queue.current = next.catch(() => undefined)
    return next
  }, [])
  const refresh = useCallback(async () => {
    setProjects(await projectStore.list())
    setCheckpoints(active.current ? await projectStore.checkpoints(active.current.id) : [])
  }, [])
  const install = useCallback((project: Project, reload = false) => {
    claimLegacyProjectAnalysis(project.id, project.snapshot.plan.id)
    if (active.current && !reload) histories.current.set(active.current.id, session.getPersistentHistory())
    active.current = project
    lastSaved.current = project.snapshot
    blocked.current = false
    session.switchProject(project.snapshot, reload ? undefined : histories.current.get(project.id))
    setCurrent(project)
    setStatus('saved')
  }, [session])
  useEffect(() => {
    let canceled = false
    void enqueue(async () => {
      const revision = session.getRevision()
      const existing = await projectStore.list()
      if (canceled) return
      if (existing.length) {
        const project = await projectStore.initialize(session.getPersistentSnapshot())
        if (canceled) return
        if (session.getRevision() === revision) install(project)
        else { active.current = project; setCurrent(project) }
      } else {
        const draft = await loadWorkspaceDraftFromIndexedDb()
        if (canceled) return
        if (getWorkspaceRecovery()) { setStatus('recovery'); setHydrated(true); return }
        const snapshot = draft && session.getRevision() === revision ? draft : session.getPersistentSnapshot()
        const project = await projectStore.initialize(snapshot)
        if (canceled) return
        if (session.getRevision() === revision) install(project)
        else { active.current = project; setCurrent(project) }
      }
      const backup = session.getPersistentSnapshot()
      await saveWorkspaceDraft(backup.plan, backup.prompt, backup.world)
      setHydrated(true)
      await refresh()
    }).catch(() => { if (!canceled) { setStatus('unavailable'); setHydrated(true) } })
    return () => { canceled = true }
  }, [session, enqueue, install, refresh])

  const saveCurrent = useCallback(async () => {
    if (getWorkspaceRecovery() && !active.current) { setStatus('recovery'); return false }
    if (blocked.current) return false
    const editing = session.getEditRevision()
    const snapshot = session.getPersistentSnapshot()
    if (snapshot === lastSaved.current && active.current) return true
    setStatus('saving')
    try {
      if (!active.current) active.current = await projectStore.initialize(snapshot)
      const saved = await projectStore.save(active.current.id, active.current.revision, snapshot)
      active.current = saved
      lastSaved.current = snapshot
      setCurrent(saved)
      setStatus('saved')
      // Compatibility backup for older releases; project content is authoritative.
      await saveWorkspaceDraft(snapshot.plan, snapshot.prompt, snapshot.world)
      if (session.getEditRevision() !== editing) { setStatus('unavailable'); return false }
      return true
    } catch (error) {
      blocked.current = error instanceof ProjectConflict
      setStatus(blocked.current ? 'conflict' : 'unavailable')
      return false
    }
  }, [session])
  const save = useCallback(() => enqueue(saveCurrent), [enqueue, saveCurrent])
  useEffect(() => {
    if (!hydrated) return
    let timeoutId = 0
    let previous = session.getPersistentSnapshot()
    const unsubscribe = session.subscribe(() => {
      const next = session.getPersistentSnapshot()
      if (next.plan === previous.plan && next.prompt === previous.prompt) return
      previous = next
      window.clearTimeout(timeoutId)
      timeoutId = window.setTimeout(() => void save(), 120)
    })
    const unreplace = session.onReplace(snapshot => {
      void enqueue(async () => {
        if (!active.current || blocked.current) return
        try { await projectStore.checkpoint(active.current.id, active.current.revision, snapshot, 'Before replacement'); await refresh() }
        catch (error) { blocked.current = true; setStatus(error instanceof ProjectConflict ? 'conflict' : 'unavailable') }
      })
    })
    void save()
    const intervalId = window.setInterval(() => void save(), 2_000)
    const onHidden = () => { if (document.hidden) void save() }
    document.addEventListener('visibilitychange', onHidden)
    return () => { unsubscribe(); unreplace(); window.clearTimeout(timeoutId); window.clearInterval(intervalId); document.removeEventListener('visibilitychange', onHidden) }
  }, [hydrated, save, session, enqueue, refresh])
  const action = useCallback((operation: () => Promise<void>) => {
    setBusy(true)
    return enqueue(operation).catch(error => {
      if (error instanceof ProjectConflict) blocked.current = true
      setStatus(error instanceof ProjectConflict ? 'conflict' : 'unavailable')
    }).finally(() => setBusy(false))
  }, [enqueue])
  return {
    status, retry: save, recovery: getWorkspaceRecovery(), projects, current, checkpoints, busy,
    refresh: () => enqueue(refresh).catch(error => {
      setStatus(error instanceof ProjectConflict ? 'conflict' : 'unavailable')
    }),
    open: (id: string) => action(async () => {
      const target = await projectStore.read(id)
      if (!target) throw new ProjectConflict()
      if (!await saveCurrent()) return
      if (!await saveCurrent()) return
      install(await projectStore.activate(id)); await refresh()
    }),
    create: (name: string, duplicate = false) => action(async () => {
      if (!await saveCurrent()) return
      const snapshot = session.getPersistentSnapshot()
      const id = crypto.randomUUID()
      const next = duplicate ? snapshot : { plan: { ...snapshot.plan, id, title: name, bricks: [], steps: [], prompt: '' }, world: createEmptyWorldState(id), prompt: '' }
      const created = await projectStore.create(next, name)
      if (!await saveCurrent()) return
      install(await projectStore.activate(created.id)); await refresh()
    }),
    rename: (name: string) => action(async () => {
      if (!await saveCurrent() || !active.current) return
      const saved = await projectStore.save(active.current.id, active.current.revision, session.getPersistentSnapshot(), name)
      active.current = saved; setCurrent(saved); await refresh()
    }),
    remove: () => action(async () => {
      if (!await saveCurrent() || !active.current) return
      const old = active.current
      const others = (await projectStore.list()).filter(item => item.id !== old.id)
      // Keep a formal project available so a legacy backup is never re-migrated.
      const id = crypto.randomUUID()
      const target = others[0] ?? await projectStore.create({ ...old.snapshot, plan: { ...old.snapshot.plan, id, bricks: [], steps: [], prompt: '', title: 'Untitled' }, prompt: '', world: createEmptyWorldState(id) }, 'Untitled')
      const selected = await projectStore.removeAndActivate(old.id, old.revision, target.id)
      clearProjectAnalysis(old.id)
      install(selected); histories.current.delete(old.id); await refresh()
    }),
    checkpoint: (name: string) => action(async () => {
      if (!await saveCurrent() || !active.current) return
      await projectStore.checkpoint(active.current.id, active.current.revision, session.getPersistentSnapshot(), name); await refresh()
    }),
    restore: (id: string) => action(async () => {
      if (!await saveCurrent() || !active.current) return
      install(await projectStore.restore(active.current.id, active.current.revision, id, session.getPersistentSnapshot()), true); await refresh()
    }),
    reload: () => action(async () => {
      if (!active.current) return
      const found = await projectStore.read(active.current.id)
      const target = found?.id ?? (await projectStore.list())[0]?.id
      if (!target) throw new ProjectConflict()
      install(await projectStore.activate(target), true); await refresh()
    }),
    saveAs: (name: string) => action(async () => {
      const project = await projectStore.create(session.getPersistentSnapshot(), name)
      install(await projectStore.activate(project.id)); await refresh()
    }),
  }
}
