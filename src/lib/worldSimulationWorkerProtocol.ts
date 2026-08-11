import type { BuildPlan } from '../types/bricks'
import type { WorldState } from '../types/world'
import type { WorldSimulationRuntimeOptions } from './worldSimulationRuntime'

export const worldSimulationWorkerProtocolVersion = 1
export const maxWorldSimulationBacklogSteps = 3

export type WorldSimulationWorkerRequest = {
  protocolVersion: typeof worldSimulationWorkerProtocolVersion
  requestId: number
  world: WorldState
  plan: Pick<BuildPlan, 'bricks' | 'structures'>
  stepCount: number
  options: WorldSimulationRuntimeOptions
}

export type WorldSimulationWorkerResponse = {
  protocolVersion: typeof worldSimulationWorkerProtocolVersion
  requestId: number
  worldId: string
  world: WorldState
}

export const appendWorldSimulationBacklog = (
  currentSteps: number,
  incomingSteps: number,
  maximumSteps = maxWorldSimulationBacklogSteps,
) => Math.min(
  Math.max(0, Math.floor(maximumSteps)),
  Math.max(0, Math.floor(currentSteps)) + Math.max(0, Math.floor(incomingSteps)),
)

export const isExpectedWorldSimulationWorkerResponse = (
  response: WorldSimulationWorkerResponse,
  requestId: number,
  worldId: string,
) => response.protocolVersion === worldSimulationWorkerProtocolVersion
  && response.requestId === requestId
  && response.worldId === worldId
  && response.world.id === worldId
