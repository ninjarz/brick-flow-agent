/// <reference lib="webworker" />

import { brickById } from '../data/basicBricks'
import { prepareAnalysisGeometry } from '../lib/prepareAnalysisGeometry'


import {
  runDisasterSimulation,
  type DisasterSimulationWorkerRequest,
  type DisasterSimulationWorkerResponse,
} from '../lib/disasterSimulation'

const workerScope = self as unknown as DedicatedWorkerGlobalScope
let preparedBricks: DisasterSimulationWorkerRequest['bricks']

workerScope.onmessage = async (event: MessageEvent<DisasterSimulationWorkerRequest>) => {
  if (event.data.type !== 'simulate') return

  try {
    if (event.data.bricks) {
      const definitions = [...new Set(event.data.bricks.map(brick => brick.brickId))]
        .flatMap(id => brickById.get(id) ?? [])
      await prepareAnalysisGeometry(definitions, event.data.geometry)
      preparedBricks = event.data.bricks
    }
    if (!preparedBricks) throw new Error('STABILITY_SIMULATION_GEOMETRY_MISSING')
    workerScope.postMessage({
      type: 'result',
      requestId: event.data.requestId,
      result: runDisasterSimulation(preparedBricks, event.data.options),
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
