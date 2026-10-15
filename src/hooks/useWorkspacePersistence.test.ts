import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceSession, type WorkspaceSnapshot } from '../lib/workspaceSession'
import { createEmptyWorldState } from '../lib/worldEntity'
import type { Project } from '../lib/projectStore'
import { useWorkspacePersistence } from './useWorkspacePersistence'

const mocks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  store: { list: vi.fn(), initialize: vi.fn(), create: vi.fn(), activate: vi.fn(), checkpoints: vi.fn(), save: vi.fn() },
  backup: vi.fn(), draft: vi.fn(),
}))
vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useRef: (current: unknown) => ({ current }),
  useState: () => [false, vi.fn()],
  useEffect: (fn: () => void | (() => void)) => mocks.effects.push(fn),
}))
vi.mock('../lib/projectStore', () => ({ projectStore: mocks.store, ProjectConflict: class extends Error {} }))
vi.mock('../lib/workspaceDraft', () => ({ getWorkspaceRecovery: () => undefined, loadWorkspaceDraftFromIndexedDb: mocks.draft, saveWorkspaceDraft: mocks.backup }))
vi.mock('../lib/projectAnalysisStorage', () => ({ claimLegacyProjectAnalysis: vi.fn(), clearProjectAnalysis: vi.fn() }))

const snapshot = (title: string): WorkspaceSnapshot => ({
  plan: { id: 'plan', title, prompt: '', source: 'template-local', bricks: [], steps: [] },
  prompt: '', world: createEmptyWorldState('plan'),
})
const project = (title: string): Project => ({ id: 'formal', name: title, revision: 1, schemaVersion: 1, savedAt: 1, snapshot: snapshot(title) })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('workspace persistence across asynchronous storage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.effects.length = 0
    mocks.store.list.mockResolvedValue([project('Authoritative')])
    mocks.store.initialize.mockResolvedValue(project('Authoritative'))
    mocks.store.checkpoints.mockResolvedValue([])
    mocks.backup.mockResolvedValue(true)
    mocks.store.create.mockImplementation(async (value: WorkspaceSnapshot, name: string) => ({ ...project(name), id: 'copy', snapshot: value }))
    mocks.store.save.mockImplementation(async (id: string, revision: number, value: WorkspaceSnapshot) => ({ ...project(value.plan.title), id, revision: revision + 1, snapshot: value }))
  })

  it('restores the authoritative project despite a simulation update during hydration', async () => {
    const listed = deferred<Project[]>()
    mocks.store.list.mockReturnValueOnce(listed.promise)
    const session = createWorkspaceSession(snapshot('Stale backup'))
    const persistence = useWorkspacePersistence(session)
    mocks.effects[0]()
    await tick()
    session.setWorld(world => ({ ...world, elapsedSeconds: 0.1 }))
    listed.resolve([project('Authoritative')])
    await persistence.retry()
    expect(session.getSnapshot().plan.title).toBe('Authoritative')
    expect(mocks.store.create).not.toHaveBeenCalled()
    expect(mocks.store.save).not.toHaveBeenCalled()
    expect(mocks.backup.mock.calls[0][0].title).toBe('Authoritative')
  })

  it('migrates the newer IndexedDB draft despite a simulation update', async () => {
    const draft = deferred<WorkspaceSnapshot>()
    mocks.store.list.mockResolvedValue([])
    mocks.draft.mockReturnValueOnce(draft.promise)
    mocks.store.initialize.mockImplementation(async (value: WorkspaceSnapshot) => ({ ...project(value.plan.title), snapshot: value }))
    const session = createWorkspaceSession(snapshot('Stale inline'))
    const persistence = useWorkspacePersistence(session)
    mocks.effects[0]()
    await tick()
    session.setWorld(world => ({ ...world, elapsedSeconds: 0.1 }))
    draft.resolve(snapshot('Newer IndexedDB draft'))
    await persistence.retry()
    expect(session.getSnapshot().plan.title).toBe('Newer IndexedDB draft')
  })

  it('preserves pre-hydration user edits in a separate project without overwriting the formal project', async () => {
    const initialized = deferred<Project>()
    mocks.store.initialize.mockReturnValueOnce(initialized.promise)
    mocks.store.activate.mockImplementation(async () => ({ ...project('Edit'), id: 'copy', snapshot: snapshot('Edit') }))
    const session = createWorkspaceSession(snapshot('Stale backup'))
    const persistence = useWorkspacePersistence(session)
    mocks.effects[0]()
    await tick()
    session.setPlan(plan => ({ ...plan, title: 'Edit' }))
    initialized.resolve(project('Authoritative'))
    await persistence.retry()
    expect(mocks.store.create.mock.calls[0][0].plan.title).toBe('Edit')
    expect(session.getSnapshot().plan.title).toBe('Edit')
    expect(mocks.store.save.mock.calls.every(([id]) => id !== 'formal')).toBe(true)
  })

  it('keeps plan, world and prompt edits made during both save-as creation and activation', async () => {
    const created = deferred<Project>()
    const activated = deferred<Project>()
    mocks.store.create.mockReturnValueOnce(created.promise)
    mocks.store.activate.mockReturnValueOnce(activated.promise)
    const session = createWorkspaceSession(snapshot('Before'))
    const persistence = useWorkspacePersistence(session)
    const saved = persistence.saveAs('Copy')
    await tick()
    session.setPlan(plan => ({ ...plan, title: 'During creation' }))
    created.resolve({ ...project('Before'), id: 'copy' })
    await tick()
    session.editWorld(world => ({ ...world, paused: true }))
    session.setPrompt('During activation')
    activated.resolve({ ...project('Before'), id: 'copy' })
    await saved
    expect(session.getSnapshot()).toMatchObject({ plan: { title: 'During creation' }, world: { paused: true }, prompt: 'During activation' })
    expect(mocks.store.save.mock.calls[0][2]).toEqual(session.getSnapshot())
  })

  it('retries saving when another edit arrives during the catch-up write', async () => {
    const created = deferred<Project>()
    const write = deferred<Project>()
    mocks.store.create.mockReturnValueOnce(created.promise)
    mocks.store.activate.mockResolvedValue({ ...project('Before'), id: 'copy' })
    mocks.store.save.mockReturnValueOnce(write.promise)
    const session = createWorkspaceSession(snapshot('Before'))
    const saved = useWorkspacePersistence(session).saveAs('Copy')
    await tick()
    session.setPrompt('First edit')
    created.resolve({ ...project('Before'), id: 'copy' })
    await tick()
    const written = session.getSnapshot()
    session.setPrompt('Latest edit')
    write.resolve({ ...project('Before'), id: 'copy', revision: 2, snapshot: written })
    await saved
    expect(mocks.store.save).toHaveBeenCalledTimes(2)
    expect(session.getSnapshot().prompt).toBe('Latest edit')
  })

  it('does not install a late restore after the effect has been canceled', async () => {
    const initialized = deferred<Project>()
    mocks.store.initialize.mockReturnValueOnce(initialized.promise)
    const session = createWorkspaceSession(snapshot('Initial'))
    const persistence = useWorkspacePersistence(session)
    const cleanup = mocks.effects[0]()
    await tick()
    if (typeof cleanup === 'function') cleanup()
    initialized.resolve(project('Authoritative'))
    await persistence.refresh()
    expect(session.getSnapshot().plan.title).toBe('Initial')
    expect(mocks.backup).not.toHaveBeenCalled()
  })
})
