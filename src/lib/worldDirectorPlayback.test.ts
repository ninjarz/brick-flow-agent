import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import type { WorldScenarioRuntime } from '../types/world'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import {
  applyWorldDirectorPlaybackEvent,
  beginWorldDirectorPlayback,
  executeWorldDirectorPlaybackEvent,
  finishWorldDirectorPlayback,
  getWorldDirectorPlaybackEntityIds,
  getWorldDirectorPlaybackOutcomeDetail,
  getWorldDirectorDialoguePlaybackPhase,
  isWorldDirectorDialogueVisible,
  isWorldDirectorCommandConfirmed,
  isWorldDirectorPlaybackSettled,
  isWorldDirectorPlaybackSettledIgnoringSpeech,
  prepareWorldForDirectorPlayback,
  shouldStartWorldDirectorPlayback,
  waitForWorldDirectorDialoguePlayback,
  waitForWorldDirectorEventPlayback,
} from './worldDirectorPlayback'

const createWorld = () => {
  const world = createEmptyWorldState('plan')
  const knight = worldEntityDefinitionById.get('knight')!
  const archer = worldEntityDefinitionById.get('archer')!
  return {
    ...world,
    entities: [
      createWorldEntity(knight, { id: 'roland', name: '罗兰', transform: { x: 0, y: 0, z: 0 } }),
      createWorldEntity(archer, { id: 'erin', name: '艾琳', transform: { x: 8, y: 0, z: 0 } }),
    ],
  }
}

describe('world director playback', () => {
  it('starts simulation only for accepted event kinds that need world time', () => {
    expect(shouldStartWorldDirectorPlayback({
      type: 'dialogue',
      speakerId: 'speaker',
      listenerId: 'listener',
      text: '走吧。',
    })).toBe(true)
    expect(shouldStartWorldDirectorPlayback({
      type: 'command',
      entityId: 'speaker',
      command: { type: 'wander' },
    })).toBe(true)
    expect(shouldStartWorldDirectorPlayback({ type: 'narration', text: '风吹过酒馆。' })).toBe(false)
    expect(shouldStartWorldDirectorPlayback({ type: 'end', summary: '思考结束。' })).toBe(false)
    expect(shouldStartWorldDirectorPlayback({
      type: 'command',
      entityId: 'speaker',
      command: { type: 'stop' },
    })).toBe(false)
  })

  it('applies accepted events through one playback transition and starts time only when needed', () => {
    const pausedWorld = { ...createWorld(), paused: true }
    const narration = applyWorldDirectorPlaybackEvent({
      world: pausedWorld,
      event: { type: 'narration', text: '风吹过酒馆。' },
      simulationStarted: false,
      bricks: [],
      structures: [],
    })
    expect(narration.world.paused).toBe(true)
    expect(narration.simulationStarted).toBe(false)
    expect(narration.entityIds).toEqual([])

    const dialogue = applyWorldDirectorPlaybackEvent({
      world: pausedWorld,
      event: {
        type: 'dialogue',
        speakerId: 'roland',
        listenerId: 'erin',
        text: '等等。',
      },
      simulationStarted: false,
      bricks: [],
      structures: [],
    })
    expect(dialogue.status).toBe('accepted')
    expect(dialogue.detail).toBe('WAITING_FOR_PROXIMITY')
    expect(dialogue.world.paused).toBe(false)
    expect(dialogue.simulationStarted).toBe(true)
    expect(dialogue.entityIds).toEqual(['roland', 'erin'])
    expect(dialogue.world.entities.find((entity) => entity.id === 'roland')?.commandQueue[0]).toMatchObject({
      type: 'interact',
      target: { kind: 'entity', id: 'erin' },
      speechText: '等等。',
    })
  })

  it('does not start or mutate playback for a rejected event', () => {
    const pausedWorld = { ...createWorld(), paused: true }
    const rejected = applyWorldDirectorPlaybackEvent({
      world: pausedWorld,
      event: { type: 'dialogue', speakerId: 'missing', text: '有人吗？' },
      simulationStarted: false,
      bricks: [],
      structures: [],
    })

    expect(rejected.status).toBe('rejected')
    expect(rejected.world).toBe(pausedWorld)
    expect(rejected.simulationStarted).toBe(false)
    expect(rejected.entityIds).toEqual([])
  })

  it('pauses while the director is thinking and restores the prior world playback state', () => {
    const world = createWorld()
    const dialogue = [{
      id: 'line-1',
      speakerId: 'roland',
      text: '先等我说完。',
      durationSeconds: 3,
    }]
    const scenario: WorldScenarioRuntime = {
      id: 'active-story',
      assetId: 'test',
      title: 'Active story',
      description: 'Active story',
      castEntityIds: ['roland'],
      processedEventIds: [],
      stages: [{
        id: 'stage-1',
        title: 'Stage',
        description: 'Stage',
        status: 'active',
        trigger: { eventType: 'interaction', actorId: 'roland', targetId: 'erin' },
        dialogue,
      }],
      activeDialogue: {
        stageId: 'stage-1',
        eventId: 'event-1',
        lineIndex: 0,
        lineEndsAtSeconds: 8,
      },
    }
    const playing = {
      ...world,
      paused: false,
      elapsedSeconds: 5,
      scenarios: [scenario],
      entities: world.entities.map((entity) => entity.id === 'roland'
        ? { ...entity, speech: { message: 'scenario-dialogue' as const, text: dialogue[0].text, expiresAtSeconds: 8 } }
        : entity),
    }

    const started = beginWorldDirectorPlayback(playing)
    expect(started.world.paused).toBe(true)
    expect(started.world.entities.find((entity) => entity.id === 'roland')?.speech).toBeUndefined()
    expect(started.session).toMatchObject({
      restorePaused: false,
      suspendedAtSeconds: 5,
      suspendedScenarioIds: ['active-story'],
    })

    const restored = finishWorldDirectorPlayback({
      ...started.world,
      paused: false,
      elapsedSeconds: 9,
    }, started.session)
    expect(restored.paused).toBe(false)
    expect(restored.scenarios[0].activeDialogue?.lineEndsAtSeconds).toBe(12)
    expect(restored.entities.find((entity) => entity.id === 'roland')?.speech).toMatchObject({
      text: dialogue[0].text,
      expiresAtSeconds: 12,
    })
  })

  it('waits for a finite command before allowing the next director event', async () => {
    let current = { ...createWorld(), paused: true }
    const phases: string[] = []
    const result = await executeWorldDirectorPlaybackEvent({
      getWorld: () => current,
      setWorld: (world) => { current = world },
      event: {
        type: 'command',
        entityId: 'roland',
        command: { type: 'move', target: { kind: 'entity', id: 'erin' } },
      },
      simulationStarted: false,
      bricks: [],
      structures: [],
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      now: () => 0,
      sleep: async () => {
        current = {
          ...current,
          events: [...current.events, {
            id: 'move-complete',
            timeSeconds: current.elapsedSeconds,
            type: 'command-complete',
            actorId: 'roland',
            targetId: 'erin',
          }],
          entities: current.entities.map((entity) => entity.id === 'roland' ? {
            ...entity,
            activeCommand: undefined,
            commandQueue: [],
            behaviorState: 'idle',
            navigation: { status: 'idle', path: [], pathIndex: 0 },
          } : entity),
        }
      },
      onPhaseChange: (phase) => phases.push(phase),
    })

    expect(result.outcome).toBe('played')
    expect(result.simulationStarted).toBe(true)
    expect(current.paused).toBe(false)
    expect(phases).toEqual(['acting', 'completed'])
  })

  it('does not confirm a finite action merely because its command disappeared', () => {
    const world = createWorld()
    const move = {
      type: 'command' as const,
      entityId: 'roland',
      command: { type: 'move' as const, target: { kind: 'entity' as const, id: 'erin' } },
    }
    expect(isWorldDirectorCommandConfirmed(world, move, world.elapsedSeconds)).toBe(false)
    expect(isWorldDirectorCommandConfirmed({
      ...world,
      events: [{
        id: 'complete',
        timeSeconds: world.elapsedSeconds + 0.1,
        type: 'command-complete',
        actorId: 'roland',
        targetId: 'erin',
      }],
    }, move, world.elapsedSeconds)).toBe(true)
  })

  it('reports a vanished unconfirmed command as missed so later narration can be blocked', async () => {
    const world = createWorld()
    const outcome = await waitForWorldDirectorEventPlayback({
      getWorld: () => world,
      event: {
        type: 'command',
        entityId: 'roland',
        command: { type: 'move', target: { kind: 'entity', id: 'erin' } },
      },
      entityIds: new Set(['roland']),
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      commandStartedAtSeconds: world.elapsedSeconds,
    })
    expect(outcome).toBe('missed')
  })

  it('reports an interrupted finite command as a blocking playback outcome', async () => {
    const world = {
      ...createWorld(),
      paused: true,
      entities: createWorld().entities.map((entity) => entity.id === 'roland'
        ? {
            ...entity,
            activeCommand: { type: 'move' as const, target: { kind: 'entity' as const, id: 'erin' } },
          }
        : entity),
    }
    const outcome = await waitForWorldDirectorEventPlayback({
      getWorld: () => world,
      event: {
        type: 'command',
        entityId: 'roland',
        command: { type: 'move', target: { kind: 'entity', id: 'erin' } },
      },
      entityIds: new Set(['roland']),
      signal: new AbortController().signal,
      timeoutMs: 1_000,
    })
    expect(outcome).toBe('paused')
  })

  it('tracks an approaching dialogue through speaking and completion', async () => {
    const world = createWorld()
    const event = {
      type: 'dialogue' as const,
      speakerId: 'roland',
      listenerId: 'erin',
      text: '北边的路不好走。',
    }
    const entityIds = new Set(['roland', 'erin'])
    const approaching = {
      ...world,
      entities: world.entities.map((entity) => entity.id === 'roland'
        ? {
            ...entity,
            activeCommand: {
              type: 'interact' as const,
              target: { kind: 'entity' as const, id: 'erin' },
              speechText: event.text,
            },
          }
        : entity),
    }
    const speaking = {
      ...world,
      entities: world.entities.map((entity) => entity.id === 'roland'
        ? {
            ...entity,
            speech: {
              message: 'scenario-dialogue' as const,
              text: event.text,
              expiresAtSeconds: 8,
            },
          }
        : entity),
    }
    const phases: string[] = []
    const states = [approaching, speaking]
    let stateIndex = 0
    const outcome = await waitForWorldDirectorDialoguePlayback({
      getWorld: () => states[stateIndex],
      event,
      entityIds,
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      finishWhenVisible: () => true,
      onPhaseChange: (phase) => phases.push(phase),
      now: () => 0,
      sleep: async () => { stateIndex += 1 },
    })

    expect(phases).toEqual(['approaching', 'speaking'])
    expect(outcome).toBe('played')
    expect(getWorldDirectorDialoguePlaybackPhase({
      world,
      event,
      entityIds,
      dialogueWasVisible: true,
    })).toBe('completed')
  })

  it('reports a missing or timed-out dialogue instead of leaving it queued forever', async () => {
    const world = createWorld()
    const event = {
      type: 'dialogue' as const,
      speakerId: 'roland',
      listenerId: 'erin',
      text: '等等。',
    }
    const entityIds = new Set(['roland', 'erin'])
    const missed = await waitForWorldDirectorDialoguePlayback({
      getWorld: () => world,
      event,
      entityIds,
      signal: new AbortController().signal,
      timeoutMs: 1_000,
    })
    expect(missed).toBe('missed')

    const approaching = {
      ...world,
      entities: world.entities.map((entity) => entity.id === 'roland'
        ? {
            ...entity,
            activeCommand: {
              type: 'interact' as const,
              target: { kind: 'entity' as const, id: 'erin' },
              speechText: event.text,
            },
          }
        : entity),
    }
    let clock = 0
    const timedOut = await waitForWorldDirectorDialoguePlayback({
      getWorld: () => approaching,
      event,
      entityIds,
      signal: new AbortController().signal,
      timeoutMs: 200,
      now: () => clock,
      sleep: async (delayMs) => { clock += delayMs },
    })
    expect(timedOut).toBe('timed-out')
    expect(getWorldDirectorPlaybackOutcomeDetail(timedOut)).toBe('PLAYBACK_TIMEOUT')
    expect(getWorldDirectorPlaybackOutcomeDetail('aborted')).toBe('PLAYBACK_STOPPED')
  })

  it('tracks command actors and both dialogue participants', () => {
    expect(getWorldDirectorPlaybackEntityIds({
      type: 'command',
      entityId: 'roland',
      command: { type: 'move', target: { kind: 'entity', id: 'erin' } },
    })).toEqual(['roland'])
    expect(getWorldDirectorPlaybackEntityIds({
      type: 'dialogue',
      speakerId: 'roland',
      listenerId: 'erin',
      text: '等等。',
    })).toEqual(['roland', 'erin'])
  })

  it('clears autonomous work but preserves player orders before a directed scene', () => {
    const world = createWorld()
    const prepared = prepareWorldForDirectorPlayback({
      ...world,
      entities: world.entities.map((entity, index) => ({
        ...entity,
        controller: index === 0 ? 'rule' as const : 'player' as const,
        activeCommand: { type: 'wander' as const },
        commandQueue: [{ type: 'stop' as const }],
        behaviorState: 'moving' as const,
        navigation: {
          status: 'moving' as const,
          path: [{ x: 1, y: 0, z: 1 }],
          pathIndex: 0,
        },
        combat: {
          ...entity.combat,
          attackTargetId: 'target',
        },
      })),
    })

    expect(prepared.entities[0]).toMatchObject({
      activeCommand: undefined,
      commandQueue: [],
      behaviorState: 'idle',
      navigation: { status: 'idle', path: [] },
      combat: { attackTargetId: undefined },
    })
    expect(prepared.entities[1].activeCommand).toEqual({ type: 'wander' })
  })

  it('waits for finite commands and speech, but not persistent guard behavior', () => {
    const world = createWorld()
    const entityIds = new Set(['roland'])
    const moving = {
      ...world,
      entities: world.entities.map((entity) => entity.id === 'roland'
        ? { ...entity, activeCommand: { type: 'move' as const, target: { kind: 'entity' as const, id: 'erin' } } }
        : entity),
    }
    expect(isWorldDirectorPlaybackSettled(moving, entityIds)).toBe(false)

    const speaking = {
      ...world,
      entities: world.entities.map((entity) => entity.id === 'roland'
        ? { ...entity, speech: { message: 'scenario-dialogue' as const, text: '等等。', expiresAtSeconds: 3 } }
        : entity),
    }
    expect(isWorldDirectorPlaybackSettled(speaking, entityIds)).toBe(false)
    expect(isWorldDirectorPlaybackSettled({ ...speaking, elapsedSeconds: 3 }, entityIds)).toBe(true)

    const guarding = {
      ...world,
      entities: world.entities.map((entity) => entity.id === 'roland'
        ? { ...entity, activeCommand: { type: 'guard' as const, target: { kind: 'entity' as const, id: 'erin' } } }
        : entity),
    }
    expect(isWorldDirectorPlaybackSettled(guarding, entityIds)).toBe(true)
  })

  it('can finish playback while preserving the visible final dialogue bubble', () => {
    const world = createWorld()
    const entityIds = new Set(['roland', 'erin'])
    const speaking = {
      ...world,
      elapsedSeconds: 2,
      entities: world.entities.map((entity) => entity.id === 'roland'
        ? { ...entity, speech: { message: 'scenario-dialogue' as const, text: '北边的路不好走。', expiresAtSeconds: 8 } }
        : entity),
    }

    expect(isWorldDirectorDialogueVisible(speaking, 'roland', '北边的路不好走。')).toBe(true)
    expect(isWorldDirectorDialogueVisible(speaking, 'roland', '另一句话。')).toBe(false)
    expect(isWorldDirectorPlaybackSettled(speaking, entityIds)).toBe(false)
    expect(isWorldDirectorPlaybackSettledIgnoringSpeech(
      speaking,
      entityIds,
      new Set(['roland']),
    )).toBe(true)

    const stillMoving = {
      ...speaking,
      entities: speaking.entities.map((entity) => entity.id === 'roland'
        ? {
            ...entity,
            activeCommand: {
              type: 'move' as const,
              target: { kind: 'entity' as const, id: 'erin' },
            },
          }
        : entity),
    }
    expect(isWorldDirectorPlaybackSettledIgnoringSpeech(
      stillMoving,
      entityIds,
      new Set(['roland']),
    )).toBe(false)
  })
})
