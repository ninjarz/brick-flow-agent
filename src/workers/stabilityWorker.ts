/// <reference lib="webworker" />

import {
  runDisasterSimulation,
  type DisasterSimulationWorkerRequest,
  type DisasterSimulationWorkerResponse,
} from '../lib/disasterSimulation'

const workerScope = self as unknown as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<DisasterSimulationWorkerRequest>) => {
  if (event.data.type !== 'simulate') return

  try {
    workerScope.postMessage({
      type: 'result',
      requestId: event.data.requestId,
      result: runDisasterSimulation(event.data.bricks, event.data.options),
    } satisfies DisasterSimulationWorkerResponse)
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      requestId: event.data.requestId,
      message: error instanceof Error ? error.message : 'STABILITY_SIMULATION_FAILED',
    } satisfies DisasterSimulationWorkerResponse)
  }
}

export {}
