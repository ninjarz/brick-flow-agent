import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity, parseStoredWorldState } from './worldEntity'
import { createWorldDirectorCheckpoint, getWorldDirectorReplayEntries, replaceWorldDirectorTurnEntry, restoreWorldDirectorCheckpoint } from './worldDirectorReplay'

describe('world director replay checkpoints', () => {
  it('restores scene state and keeps only turns that preceded the checkpoint', () => {
    const definition = worldEntityDefinitionById.get('knight')!
    const base = createEmptyWorldState('plan')
    const before = {
      ...base,
      elapsedSeconds: 4,
      paused: true,
      entities: [createWorldEntity(definition, { id: 'roland', transform: { x: 1, z: 2 } })],
      narrative: {
        ...base.narrative,
        relationshipsByEntityId: { roland: {} },
        directorTurns: [{
          id: 'first',
          playerText: '第一段',
          entries: [],
          createdAtSeconds: 1,
          status: 'completed' as const,
        }],
      },
    }
    const checkpoint = createWorldDirectorCheckpoint(before)
    const after = {
      ...before,
      elapsedSeconds: 20,
      paused: false,
      entities: [{
        ...before.entities[0],
        health: 1,
        transform: { ...before.entities[0].transform, x: 9 },
      }],
      narrative: {
        ...before.narrative,
        directorTurns: [...before.narrative.directorTurns, {
          id: 'later',
          playerText: '后续段落',
          entries: [],
          createdAtSeconds: 10,
          status: 'completed' as const,
        }],
      },
    }

    const restored = restoreWorldDirectorCheckpoint(after, checkpoint)

    expect(restored.elapsedSeconds).toBe(4)
    expect(restored.paused).toBe(true)
    expect(restored.entities[0].health).toBe(before.entities[0].health)
    expect(restored.entities[0].transform.x).toBe(1)
    expect(restored.narrative.directorTurns.map((turn) => turn.id)).toEqual(['first'])
  })

  it('owns an immutable copy of the captured scene', () => {
    const world = createEmptyWorldState('plan')
    const checkpoint = createWorldDirectorCheckpoint(world)
    world.events.push({ id: 'later', timeSeconds: 1, type: 'interaction', actorId: 'actor' })

    expect(checkpoint.events).toEqual([])
  })

  it('survives workspace serialization without recursively storing earlier turn snapshots', () => {
    const world = createEmptyWorldState('plan')
    const checkpoint = createWorldDirectorCheckpoint(world)
    const stored = {
      ...world,
      narrative: {
        ...world.narrative,
        directorTurns: [{
          id: 'turn',
          playerText: '向守卫问路',
          entries: [{
            id: 'dialogue',
            type: 'dialogue' as const,
            speakerId: 'speaker',
            listenerId: 'listener',
            text: '北门怎么走？',
            status: 'accepted' as const,
            detail: 'PLAYED',
            execution: { phase: 'confirmed' as const, attempt: 2, startedAtSeconds: 0.5, finishedAtSeconds: 1 },
          }],
          createdAtSeconds: 1,
          status: 'completed' as const,
          checkpoint,
        }],
      },
    }

    const restored = parseStoredWorldState(JSON.parse(JSON.stringify(stored)), 'plan')

    expect(restored?.narrative.directorTurns[0].checkpoint).toMatchObject({
      planId: 'plan',
      directorTurnIds: [],
      elapsedSeconds: 0,
    })
    expect(restored?.narrative.directorTurns[0].checkpoint?.narrative).not.toHaveProperty('directorTurns')
    expect(restored?.narrative.directorTurns[0].entries[0]).toMatchObject({
      detail: 'PLAYED',
      execution: { phase: 'confirmed', attempt: 2, startedAtSeconds: 0.5, finishedAtSeconds: 1 },
    })
  })

  it('restores hidden interactive objects through a scene checkpoint', () => {
    const world = createEmptyWorldState('voxel-replay')
    const before = { ...world, hiddenTargets: [{ kind: 'brick' as const, id: 'secret-chest' }] }
    const checkpoint = createWorldDirectorCheckpoint(before)
    const changed = { ...before, hiddenTargets: [] }
    expect(restoreWorldDirectorCheckpoint(changed, checkpoint).hiddenTargets).toEqual(before.hiddenTargets)
  })

  it('rebuilds only through the selected entry and retries that entry even if it failed', () => {
    const world = createEmptyWorldState('plan')
    const turn = {
      id: 'turn',
      playerText: '继续',
      createdAtSeconds: 1,
      status: 'completed' as const,
      entries: [
        { id: 'intro', type: 'narration' as const, text: '门开了。' },
        { id: 'old-failure', type: 'dialogue' as const, speakerId: 'missing', text: '等等。', status: 'rejected' as const },
        { id: 'target', type: 'command' as const, entityId: 'roland', command: { type: 'wander' as const }, status: 'rejected' as const },
        { id: 'later', type: 'narration' as const, text: '后来。' },
      ],
    }

    expect(getWorldDirectorReplayEntries(turn, 'target').map((entry) => entry.id)).toEqual([
      'intro',
      'target',
    ])
    expect(getWorldDirectorReplayEntries(turn, 'missing')).toEqual([])

    const stored = {
      ...world,
      narrative: { ...world.narrative, directorTurns: [turn] },
    }
    const acceptedTarget = { ...turn.entries[2], status: 'accepted' as const, detail: undefined }
    const updated = replaceWorldDirectorTurnEntry(stored, turn.id, acceptedTarget)
    expect(updated.narrative.directorTurns[0].entries[2]).toEqual(acceptedTarget)
    expect(updated.narrative.directorTurns[0].entries[3]).toEqual(turn.entries[3])
  })
})
