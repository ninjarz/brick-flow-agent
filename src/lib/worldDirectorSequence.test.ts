import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { createWorldDirectorSequenceRunner } from './worldDirectorSequence'

const createWorld = () => ({
  ...createEmptyWorldState('sequence-test'),
  paused: true,
  entities: [createWorldEntity(worldEntityDefinitionById.get('knight')!, {
    id: 'roland',
    name: '罗兰',
  })],
})

describe('world director sequence runner', () => {
  it('blocks later entries after a required event is rejected', async () => {
    let world = createWorld()
    const entries: string[] = []
    const runner = createWorldDirectorSequenceRunner({
      getWorld: () => world,
      setWorld: (next) => { world = next },
      readPlan: () => ({ bricks: [], structures: [] }),
      signal: new AbortController().signal,
      timeoutMs: 1_000,
    })

    const rejected = runner.enqueue({
      type: 'command',
      entityId: 'missing',
      command: { type: 'stop' },
    }, {
      id: 'entry-1',
      onEntry: (entry) => entries.push(`${entry.id}:${entry.detail}`),
    })
    const skipped = runner.enqueue({
      type: 'narration',
      text: '这段叙事不应当被应用。',
    }, {
      id: 'entry-2',
      onEntry: (entry) => entries.push(`${entry.id}:${entry.detail}`),
    })

    expect((await rejected)?.status).toBe('rejected')
    expect((await skipped)).toMatchObject({
      detail: 'BLOCKED_BY_PREVIOUS_EVENT',
      execution: { phase: 'skipped', attempt: 1, retryable: false },
    })
    expect(runner.isBlocked()).toBe(true)
    expect(entries).toEqual([
      'entry-1:ENTITY_NOT_AVAILABLE',
      'entry-2:BLOCKED_BY_PREVIOUS_EVENT',
    ])
  })

  it('keeps entity ownership and simulation state across queued events', async () => {
    let world = createWorld()
    const runner = createWorldDirectorSequenceRunner({
      getWorld: () => world,
      setWorld: (next) => { world = next },
      readPlan: () => ({ bricks: [], structures: [] }),
      signal: new AbortController().signal,
      timeoutMs: 1_000,
    })

    const entry = await runner.enqueue({
      type: 'command',
      entityId: 'roland',
      command: { type: 'wander' },
    }, { id: 'entry-1' })

    expect(entry?.status).toBe('accepted')
    expect(entry?.execution).toMatchObject({ phase: 'confirmed', attempt: 1 })
    expect(runner.hasStartedSimulation()).toBe(true)
    expect([...runner.getEntityIds()]).toEqual(['roland'])
    expect(world.paused).toBe(false)
  })

  it('records retry attempts as durable execution metadata', async () => {
    let world = createWorld()
    const runner = createWorldDirectorSequenceRunner({
      getWorld: () => world,
      setWorld: (next) => { world = next },
      readPlan: () => ({ bricks: [], structures: [] }),
      signal: new AbortController().signal,
      timeoutMs: 1_000,
    })
    const entry = await runner.enqueue({ type: 'command', entityId: 'missing', command: { type: 'stop' } }, {
      id: 'retry-entry',
      attempt: 2,
    })
    expect(entry?.execution).toEqual(expect.objectContaining({ phase: 'failed', attempt: 2, retryable: true }))
  })
})
