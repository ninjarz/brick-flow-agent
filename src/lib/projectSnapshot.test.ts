import { describe, expect, it } from 'vitest'
import { normalizeProjectSnapshot } from './projectSnapshot'
import { createEmptyWorldState } from './worldEntity'
import { makeBrick } from './planUtils'
import type { WorkspaceSnapshot } from './workspaceSession'

const initial = (): WorkspaceSnapshot => ({
  plan: { id: 'plan', title: 'Stored', prompt: '', source: 'template-local', steps: [], bricks: [makeBrick('minecraft-stone-block', 'gray', 0, 0, 0)] },
  world: createEmptyWorldState('plan'), prompt: '',
})
describe('formal project and checkpoint recovery', () => {
  it('rejects out-of-range stored bricks before they reach spatial indexing', () => {
    const snapshot = initial()
    snapshot.plan.bricks[0].pose.xStud = 1e18
    expect(() => normalizeProjectSnapshot(snapshot)).toThrow('PROJECT_CONTENT_INVALID')
  })
  it('cleans damaged optional world event fields in formal project content', () => {
    const snapshot = initial()
    snapshot.world.events = [{ id: 'bad-name', type: 'interaction', actorId: 'actor', actorName: 17, timeSeconds: 0 }] as unknown as typeof snapshot.world.events
    const restored = normalizeProjectSnapshot(snapshot)
    expect(restored.world.events[0].actorName).toBeUndefined()
    expect(restored.plan.id).toBe('plan')
  })
})
