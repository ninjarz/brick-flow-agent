/// <reference lib="webworker" />

import type { BuildPlan } from '../types/bricks'
import type { WorldState } from '../types/world'
import { advanceWorldSimulationSteps, type WorldSimulationRuntimeOptions } from '../lib/worldSimulationRuntime'

export type WorldSimulationWorkerRequest = {
  world: WorldState
  plan: Pick<BuildPlan, 'bricks' | 'structures'>
  stepCount: number
  options: WorldSimulationRuntimeOptions
}

export type WorldSimulationWorkerResponse = {
  world: WorldState
}

const workerScope = self as unknown as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<WorldSimulationWorkerRequest>) => {
  workerScope.postMessage({
    world: advanceWorldSimulationSteps(
      event.data.world,
      event.data.plan,
      event.data.stepCount,
      event.data.options,
    ),
  } satisfies WorldSimulationWorkerResponse)
}

export {}
