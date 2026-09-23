/// <reference lib="webworker" />

import { advanceWorldSimulationSteps } from '../lib/worldSimulationRuntime'
import {
  worldSimulationWorkerProtocolVersion,
  type WorldSimulationWorkerRequest,
  type WorldSimulationWorkerResponse,
} from '../lib/worldSimulationWorkerProtocol'

const workerScope = self as unknown as DedicatedWorkerGlobalScope
let cachedPlan: WorldSimulationWorkerRequest['plan']
let cachedRevision = -1

workerScope.onmessage = (event: MessageEvent<WorldSimulationWorkerRequest>) => {
  if (event.data.protocolVersion !== worldSimulationWorkerProtocolVersion) return
  if (event.data.plan) { cachedPlan = event.data.plan; cachedRevision = event.data.planRevision }
  if (!cachedPlan || cachedRevision !== event.data.planRevision) throw new Error('SIMULATION_PLAN_REVISION_MISSING')
  workerScope.postMessage({
    protocolVersion: worldSimulationWorkerProtocolVersion,
    requestId: event.data.requestId,
    worldId: event.data.world.id,
    planRevision: cachedRevision,
    world: advanceWorldSimulationSteps(
      event.data.world,
      cachedPlan,
      event.data.stepCount,
      event.data.options,
    ),
  } satisfies WorldSimulationWorkerResponse)
}

export {}
