import type { BuildPlan } from '../types/bricks'
import type { WorldState } from '../types/world'
import { advanceWorldScenarios } from './worldScenarioRuntime'
import { stepWorldSimulation, worldSimulationStepSeconds } from './worldSimulation'

export type WorldSimulationRuntimeOptions = {
  enableAi: boolean
  directorPlaybackActive: boolean
  directorSimulationStarted: boolean
  suspendAutomaticControllers?: boolean
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
        {
          suspendAutomaticControllers: (
            options.directorSimulationStarted
            || options.suspendAutomaticControllers === true
          ),
        },
      ),
      {
        plan,
        allowNewStages: !options.directorPlaybackActive,
        enableAi: options.enableAi,
        suspendActivePlayback: options.directorPlaybackActive,
      },
    )
  }
  return next
}
