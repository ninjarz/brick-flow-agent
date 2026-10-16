import { openDatabase } from './browserStorage'
import { normalizeProjectSnapshot } from './projectSnapshot'
import { coordinateStorageWrite } from './storageCoordinator'
import type { WorkspaceSnapshot } from './workspaceSession'

export type ProjectIndex = { id: string; name: string; revision: number; savedAt: number; schemaVersion: 1 }
export type Project = ProjectIndex & { snapshot: WorkspaceSnapshot }
export type ProjectCheckpoint = { id: string; projectId: string; name: string; savedAt: number; snapshot: WorkspaceSnapshot }
export class ProjectConflict extends Error { constructor() { super('PROJECT_CONFLICT'); this.name = 'ProjectConflict' } }
const stores = ['projects', 'project-content', 'project-checkpoints', 'project-meta']
const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  value.onsuccess = () => resolve(value.result)
  value.onerror = () => reject(value.error)
})
const transact = async <T>(write: boolean, run: (tx: IDBTransaction) => Promise<T>): Promise<T> => {
  const execute = async () => {
    const db = await openDatabase()
    try {
      const tx = db.transaction(stores, write ? 'readwrite' : 'readonly')
      const completed = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('PROJECT_WRITE_FAILED'))
      })
      // Attach a handler immediately: a failed request can abort before run finishes.
      void completed.catch(() => undefined)
      try { const result = await run(tx); await completed; return result }
      catch (error) { try { tx.abort() } catch { /* already completed */ } await completed.catch(() => undefined); throw error }
    } finally { db.close() }
  }
  if (!write) return execute()
  let result!: T
  let failure: unknown
  const saved = await coordinateStorageWrite(async () => {
    try { result = await execute(); return true } catch (error) { failure = error; return false }
  })
  if (!saved) throw failure ?? new Error('STORAGE_PAUSED')
  return result
}
const readProjectRecord = async (tx: IDBTransaction, id: string): Promise<Project | undefined> => {
  const index = await request(tx.objectStore('projects').get(id)) as ProjectIndex | undefined
  if (!index) return undefined
  const snapshot = await request(tx.objectStore('project-content').get(id)) as WorkspaceSnapshot | undefined
  if (!snapshot?.plan || !snapshot.world || index.schemaVersion !== 1) throw new Error('PROJECT_CONTENT_INVALID')
  return { ...index, snapshot }
}
const readProject = async (tx: IDBTransaction, id: string): Promise<Project | undefined> => {
  const project = await readProjectRecord(tx, id)
  return project ? { ...project, snapshot: normalizeProjectSnapshot(project.snapshot) } : undefined
}
const putProject = async (tx: IDBTransaction, project: Project) => {
  const { snapshot, ...index } = project
  await request(tx.objectStore('project-content').put(snapshot, project.id))
  const copy = await request(tx.objectStore('project-content').get(project.id)) as WorkspaceSnapshot
  if (!copy?.plan || copy.plan.id !== snapshot.plan.id || copy.prompt !== snapshot.prompt) throw new Error('PROJECT_VERIFY_FAILED')
  await request(tx.objectStore('projects').put(index, project.id))
}
const makeProject = (snapshot: WorkspaceSnapshot, name: string): Project => ({ id: crypto.randomUUID(), name: name.trim().slice(0, 120) || 'Untitled', revision: 1, schemaVersion: 1, savedAt: Date.now(), snapshot })
const assertRevision = (project: Project | undefined, revision: number): Project => {
  if (!project || project.revision !== revision) throw new ProjectConflict()
  return project
}
// Checkpoints are bounded separately; the sole formal project copy is never evicted.
const checkpoint = async (tx: IDBTransaction, project: Project, name: string) => {
  const store = tx.objectStore('project-checkpoints')
  const value: ProjectCheckpoint = { id: crypto.randomUUID(), projectId: project.id, savedAt: Date.now(), name, snapshot: project.snapshot }
  await request(store.put(value, value.id))
  const all = (await request(store.getAll()) as ProjectCheckpoint[]).sort((a, b) => b.savedAt - a.savedAt)
  let total = 0
  const counts = new Map<string, number>()
  for (const item of all) {
    const count = (counts.get(item.projectId) ?? 0) + 1
    counts.set(item.projectId, count)
    total += JSON.stringify(item).length * 2
    if (count > 5 || total > 50 * 1024 * 1024) await request(store.delete(item.id))
  }
}
export const projectStore = {
  list: () => transact(false, async tx => (await request(tx.objectStore('projects').getAll()) as ProjectIndex[]).sort((a, b) => b.savedAt - a.savedAt)),
  read: (id: string) => transact(false, tx => readProject(tx, id)),
  initialize: (snapshot: WorkspaceSnapshot) => transact(true, async tx => {
    const active = await request(tx.objectStore('project-meta').get('active')) as string | undefined
    if (active) {
      const found = await readProject(tx, active)
      if (found) return found
    }
    const keys = await request(tx.objectStore('projects').getAllKeys())
    if (keys.length) {
      const found = (await readProject(tx, String(keys[0])))!
      await request(tx.objectStore('project-meta').put(found.id, 'active'))
      return found
    }
    const project = makeProject(snapshot, snapshot.plan.title)
    await putProject(tx, project)
    await request(tx.objectStore('project-meta').put(project.id, 'active'))
    return project
  }),
  create: (snapshot: WorkspaceSnapshot, name: string) => transact(true, async tx => {
    const project = makeProject(snapshot, name)
    await putProject(tx, project)
    return project
  }),
  activate: (id: string) => transact(true, async tx => {
    const project = await readProject(tx, id)
    if (!project) throw new ProjectConflict()
    await request(tx.objectStore('project-meta').put(id, 'active'))
    return project
  }),
  save: (id: string, revision: number, snapshot: WorkspaceSnapshot, name?: string) => transact(true, async tx => {
    const old = assertRevision(await readProjectRecord(tx, id), revision)
    const next = { ...old, snapshot, name: name?.trim().slice(0, 120) || old.name, revision: revision + 1, savedAt: Date.now() }
    await putProject(tx, next)
    return next
  }),
  checkpoint: (id: string, revision: number, snapshot: WorkspaceSnapshot, name: string) => transact(true, async tx => {
    const old = assertRevision(await readProjectRecord(tx, id), revision)
    await checkpoint(tx, { ...old, snapshot }, name)
  }),
  checkpoints: (id: string) => transact(false, async tx => (await request(tx.objectStore('project-checkpoints').getAll()) as ProjectCheckpoint[]).filter(item => item.projectId === id).sort((a, b) => b.savedAt - a.savedAt)),
  restore: (id: string, revision: number, checkpointId: string, current: WorkspaceSnapshot) => transact(true, async tx => {
    const old = assertRevision(await readProjectRecord(tx, id), revision)
    const saved = await request(tx.objectStore('project-checkpoints').get(checkpointId)) as ProjectCheckpoint | undefined
    if (!saved || saved.projectId !== id) throw new Error('CHECKPOINT_MISSING')
    await checkpoint(tx, { ...old, snapshot: current }, 'Before restore')
    const next = { ...old, snapshot: normalizeProjectSnapshot(saved.snapshot), revision: revision + 1, savedAt: Date.now() }
    await putProject(tx, next)
    return next
  }),
  remove: (id: string, revision: number) => transact(true, async tx => {
    assertRevision(await readProjectRecord(tx, id), revision)
    await request(tx.objectStore('projects').delete(id))
    await request(tx.objectStore('project-content').delete(id))
    const all = await request(tx.objectStore('project-checkpoints').getAll()) as ProjectCheckpoint[]
    for (const item of all.filter(item => item.projectId === id)) await request(tx.objectStore('project-checkpoints').delete(item.id))
  }),
  removeAndActivate: (id: string, revision: number, targetId: string) => transact(true, async tx => {
    assertRevision(await readProjectRecord(tx, id), revision)
    if (id === targetId) throw new ProjectConflict()
    const target = await readProject(tx, targetId)
    if (!target) throw new ProjectConflict()
    await request(tx.objectStore('projects').delete(id))
    await request(tx.objectStore('project-content').delete(id))
    const all = await request(tx.objectStore('project-checkpoints').getAll()) as ProjectCheckpoint[]
    for (const item of all.filter(item => item.projectId === id)) await request(tx.objectStore('project-checkpoints').delete(item.id))
    await request(tx.objectStore('project-meta').put(targetId, 'active'))
    return target
  }),
}
