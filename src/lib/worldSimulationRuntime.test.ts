import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { worldSimulationStepSeconds } from './worldSimulation'
import { advanceWorldSimulationSteps } from './worldSimulationRuntime'

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
})
