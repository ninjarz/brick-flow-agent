import { describe, expect, it } from 'vitest'
import { createWorkspaceSession } from './workspaceSession'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { makeBrick } from './planUtils'
import { parseImportedProject } from './planFileIO'
import type { WorldDirectorTurn } from '../types/world'
import type { BuildPlan } from '../types/bricks'

const plan: BuildPlan = { id: 'a', title: 'A', prompt: 'A prompt', source: 'template-local', bricks: [makeBrick('minecraft-chest', 'brown', 0, 0, 0)], steps: [] }
const initial = () => ({ plan, prompt: 'custom prompt', world: { ...createEmptyWorldState(plan.id), entities: [createWorldEntity(worldEntityDefinitionById.get('knight')!)] } })

describe('workspace transactions', () => {
  it('undoes and redoes a same-id project replacement with its complete world and prompt', () => {
    const a = initial()
    const session = createWorkspaceSession(a)
    const b = { plan: { ...plan, title: 'B' }, prompt: 'B prompt', world: createEmptyWorldState(plan.id) }
    session.replace(b)
    session.undo()
    expect(session.getSnapshot()).toEqual(a)
    session.redo()
    expect(session.getSnapshot()).toEqual(b)
    expect(session.getEpoch()).toBe(3)
  })

  it('does not rewind simulation when undoing a model edit', () => {
    const session = createWorkspaceSession(initial())
    session.setPlan({ ...plan, title: 'Edited' })
    session.setWorld((world) => ({ ...world, elapsedSeconds: 42 }))
    session.undo()
    expect(session.getSnapshot().plan.title).toBe('A')
    expect(session.getSnapshot().world.elapsedSeconds).toBe(42)
    expect(session.getHistory().past).toHaveLength(0)
  })

  it('records explicit NPC edits without adding simulation ticks to history', () => {
    const a = initial()
    const session = createWorkspaceSession(a)
    session.editWorld((world) => ({ ...world, entities: [] }))
    session.setWorld((world) => ({ ...world, elapsedSeconds: 3 }))
    expect(session.getHistory().past).toHaveLength(1)
    session.undo()
    expect(session.getSnapshot().world).toEqual(a.world)
    session.redo()
    expect(session.getSnapshot().world.entities).toHaveLength(0)
  })

  it('discards playtest edits and restores both history branches and the persisted checkpoint', () => {
    const a = initial()
    const session = createWorkspaceSession(a)
    session.setPlan({ ...plan, title: 'Pre-test edit' })
    session.setPlan({ ...plan, title: 'Future edit' })
    session.undo()
    const formal = session.getSnapshot()
    session.beginPlaytest({ ...formal.world, paused: true })
    session.setPlan((current) => ({ ...current, bricks: current.bricks.map((brick) => ({ ...brick, voxelState: { open: true } })) }))
    session.setPlan((current) => ({ ...current, title: 'Disposable' }))
    session.setWorld((world) => ({ ...world, entities: [] }))
    expect(session.getPersistentSnapshot()).toBe(formal)
    session.restorePlaytest()
    expect(session.getSnapshot()).toBe(formal)
    session.redo()
    expect(session.getSnapshot().plan.title).toBe('Future edit')
    session.undo()
    session.undo()
    expect(session.getSnapshot()).toEqual(a)
  })

  it('invalidates in-flight consumers on replace, undo, and playtest transitions', () => {
    const session = createWorkspaceSession(initial())
    const controller = new AbortController()
    session.onInvalidate(() => controller.abort())
    const epoch = session.getEpoch()
    session.replace(initial())
    expect(controller.signal.aborted).toBe(true)
    expect(session.getEpoch()).not.toBe(epoch)
  })

  it('persists object toggles and their consumption marker in the same snapshot', () => {
    const session = createWorkspaceSession(initial())
    const targetId = plan.bricks[0].id
    const commits: ReturnType<typeof session.getSnapshot>[] = []
    session.subscribe(() => commits.push(session.getSnapshot()))
    session.setWorld((world) => ({ ...world, events: [{ id: 'toggle', timeSeconds: 1, type: 'object-interaction', actorId: 'hero', targetId, objectAction: 'toggle' }] }))
    expect(commits).toHaveLength(1)
    expect(commits[0].plan.bricks[0].voxelState?.open).toBe(true)
    expect(commits[0].world.appliedObjectEventIds).toEqual(['toggle'])
    const file = parseImportedProject(JSON.parse(JSON.stringify(commits[0])))!
    const restored = createWorkspaceSession({ ...file, world: file.world!, prompt: '' })
    expect(restored.getSnapshot().plan.bricks[0].voxelState?.open).toBe(true)
    restored.setWorld((world) => ({ ...world, elapsedSeconds: 2 }))
    expect(restored.getSnapshot().plan.bricks[0].voxelState?.open).toBe(true)
  })

  it('applies explicitly pending events during restore, while migrating legacy history without replay', () => {
    const a = initial()
    a.world.events = [{ id: 'toggle', timeSeconds: 1, type: 'object-interaction', actorId: 'hero', targetId: a.plan.bricks[0].id, objectAction: 'toggle' }]
    expect(createWorkspaceSession(a).getSnapshot().plan.bricks[0].voxelState?.open).toBe(true)
    const legacy = { ...a, plan: { ...a.plan, bricks: [{ ...a.plan.bricks[0], voxelState: { open: true } }] }, world: { ...a.world, appliedObjectEventIds: undefined } }
    const migrated = createWorkspaceSession(legacy).getSnapshot()
    expect(migrated.plan.bricks[0].voxelState?.open).toBe(true)
    expect(migrated.world.appliedObjectEventIds).toEqual(['toggle'])
  })

  it('rejects manual and autonomous final AI commits after a workspace replacement, even for identical IDs', () => {
    const session = createWorkspaceSession(initial())
    const epoch = session.getEpoch()
    const turn = { id: 'old-turn', playerText: 'old project', entries: [], createdAtSeconds: 0, status: 'stopped' } as WorldDirectorTurn
    expect(session.commitDirectorTurn(epoch, turn)).toBe(true)
    session.replace(initial())
    expect(session.commitDirectorTurn(epoch, turn)).toBe(false)
    expect(session.commitDirectorTurn(epoch, { ...turn, origin: 'autonomous' })).toBe(false)
    expect(session.getSnapshot().world.narrative.directorTurns).toEqual([])
  })

})
