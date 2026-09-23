import type { BuildPlan } from '../types/bricks'
import type { WorldState } from '../types/world'
import type { WorldSimulationRuntimeOptions } from './worldSimulationRuntime'

export const worldSimulationWorkerProtocolVersion = 2
export const maxWorldSimulationBacklogSteps = 3

export type WorldSimulationWorkerRequest = {
  protocolVersion: typeof worldSimulationWorkerProtocolVersion
  requestId: number
  world: WorldState
  planRevision: number
  plan?: Pick<BuildPlan, 'bricks' | 'structures'>
  stepCount: number
  options: WorldSimulationRuntimeOptions
}

export type WorldSimulationWorkerResponse = {
  protocolVersion: typeof worldSimulationWorkerProtocolVersion
  requestId: number
  worldId: string
  planRevision: number
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
  planRevision: number,
) => response.protocolVersion === worldSimulationWorkerProtocolVersion
  && response.requestId === requestId
  && response.worldId === worldId
  && response.planRevision === planRevision
  && response.world.id === worldId

export const isWorldSimulationSnapshotCurrent = (
  sent: { world: WorldState; plan: Pick<BuildPlan, 'bricks' | 'structures'>; options: WorldSimulationRuntimeOptions },
  current: { world: WorldState; plan: Pick<BuildPlan, 'bricks' | 'structures'>; options: WorldSimulationRuntimeOptions },
) => sent.world === current.world && sent.plan.bricks === current.plan.bricks && sent.plan.structures === current.plan.structures
  && sent.options.enableAi === current.options.enableAi
  && sent.options.directorPlaybackActive === current.options.directorPlaybackActive
  && sent.options.directorSimulationStarted === current.options.directorSimulationStarted
  && Boolean(sent.options.suspendAutomaticControllers) === Boolean(current.options.suspendAutomaticControllers)
