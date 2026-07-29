import type { BuildPlan } from '../types/bricks'
import type { WorldState } from '../types/world'
import { advanceWorldScenarios } from './worldScenarioRuntime'
import { stepWorldSimulation, worldSimulationStepSeconds } from './worldSimulation'

export type WorldSimulationRuntimeOptions = {
  enableAi: boolean
  directorPlaybackActive: boolean
  directorSimulationStarted: boolean
}

export const advanceWorldSimulationSteps = (
  world: WorldState,
  plan: Pick<BuildPlan, 'bricks' | 'structures'>,
  stepCount: number,
  options: WorldSimulationRuntimeOptions,
) => {
  let next = world
  for (let step = 0; step < stepCount; step += 1) {
    next = advanceWorldScenarios(
      stepWorldSimulation(
        next,
        plan.bricks,
        worldSimulationStepSeconds,
        plan.structures ?? [],
        { suspendAutomaticControllers: options.directorSimulationStarted },
      ),
      {
        allowNewStages: !options.directorPlaybackActive,
        enableAi: options.enableAi,
      },
    )
  }
  return next
}
