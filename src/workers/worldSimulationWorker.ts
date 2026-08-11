/// <reference lib="webworker" />

import { advanceWorldSimulationSteps } from '../lib/worldSimulationRuntime'
import {
  worldSimulationWorkerProtocolVersion,
  type WorldSimulationWorkerRequest,
  type WorldSimulationWorkerResponse,
} from '../lib/worldSimulationWorkerProtocol'

const workerScope = self as unknown as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<WorldSimulationWorkerRequest>) => {
  if (event.data.protocolVersion !== worldSimulationWorkerProtocolVersion) return
  workerScope.postMessage({
    protocolVersion: worldSimulationWorkerProtocolVersion,
    requestId: event.data.requestId,
    worldId: event.data.world.id,
    world: advanceWorldSimulationSteps(
      event.data.world,
      event.data.plan,
      event.data.stepCount,
      event.data.options,
    ),
  } satisfies WorldSimulationWorkerResponse)
}

export {}
