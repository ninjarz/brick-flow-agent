import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { worldSimulationStepSeconds } from './worldSimulation'
import { advanceWorldSimulationSteps } from './worldSimulationRuntime'
import type { WorldScenarioRuntime } from '../types/world'

describe('world simulation runtime', () => {
  it('advances exactly the requested number of fixed world steps', () => {
    const actor = createWorldEntity(worldEntityDefinitionById.get('knight')!, {
      id: 'runtime-actor',
      controller: 'player',
    })
    const world = { ...createEmptyWorldState('plan'), entities: [actor] }
    const next = advanceWorldSimulationSteps(world, { bricks: [], structures: [] }, 3, {
      enableAi: false,
      directorPlaybackActive: false,
      directorSimulationStarted: false,
    })

    expect(next.elapsedSeconds).toBeCloseTo(worldSimulationStepSeconds * 3, 10)
    expect(next.entities).toHaveLength(1)
  })

  it('does not mutate world state when no fixed step is due', () => {
    const world = createEmptyWorldState('plan')
    expect(advanceWorldSimulationSteps(world, { bricks: [] }, 0, {
      enableAi: false,
      directorPlaybackActive: false,
      directorSimulationStarted: false,
    })).toBe(world)
  })

  it('suspends rule decisions while continuous direction owns autonomous behavior', () => {
    const actor = createWorldEntity(worldEntityDefinitionById.get('knight')!, {
      id: 'runtime-rule-actor',
      controller: 'rule',
    })
    actor.autonomy.nextDecisionAtSeconds = 0
    const world = {
      ...createEmptyWorldState('continuous-director-plan'),
      paused: false,
      entities: [actor],
    }
    const suspended = advanceWorldSimulationSteps(world, { bricks: [], structures: [] }, 1, {
      enableAi: true,
      directorPlaybackActive: false,
      directorSimulationStarted: false,
      suspendAutomaticControllers: true,
    })
    const localRules = advanceWorldSimulationSteps(world, { bricks: [], structures: [] }, 1, {
      enableAi: true,
      directorPlaybackActive: false,
      directorSimulationStarted: false,
      suspendAutomaticControllers: false,
    })

    expect(suspended.elapsedSeconds).toBeGreaterThan(world.elapsedSeconds)
    expect(suspended.entities[0]?.activeCommand).toBeUndefined()
    expect(suspended.entities[0]?.commandQueue).toHaveLength(0)
    expect(localRules.entities[0]?.activeCommand?.type).toBe('wander')
  })

  it('keeps an authored scene frozen while director playback owns the performance lane', () => {
    const actor = createWorldEntity(worldEntityDefinitionById.get('knight')!, {
      id: 'scene-actor',
      controller: 'rule',
    })
    const scenario: WorldScenarioRuntime = {
      id: 'frozen-scene',
      assetId: 'test',
      title: 'Frozen scene',
      description: 'Frozen scene',
      processedEventIds: [],
      castEntityIds: [actor.id],
      stages: [{
        id: 'scene-stage',
        title: 'Scene stage',
        description: 'Scene stage',
        status: 'active',
        trigger: { eventType: 'interaction', actorId: actor.id, targetId: 'target' },
        dialogue: [
          { id: 'line-1', speakerId: actor.id, text: '第一句', durationSeconds: 0.05 },
          { id: 'line-2', speakerId: actor.id, text: '第二句', durationSeconds: 2 },
        ],
      }],
      activeDialogue: {
        stageId: 'scene-stage',
        eventId: 'scene-event',
        lineIndex: 0,
        lineEndsAtSeconds: 0.05,
      },
    }
    const world = {
      ...createEmptyWorldState('frozen-scene-plan'),
      paused: false,
      entities: [actor],
      scenarios: [scenario],
    }
    const next = advanceWorldSimulationSteps(world, { bricks: [], structures: [] }, 2, {
      enableAi: false,
      directorPlaybackActive: true,
      directorSimulationStarted: true,
    })

    expect(next.elapsedSeconds).toBeCloseTo(0.2, 10)
    expect(next.scenarios[0].activeDialogue?.lineIndex).toBe(0)
    expect(next.scenarios[0].activeDialogue?.lineEndsAtSeconds).toBe(0.05)
  })
})
