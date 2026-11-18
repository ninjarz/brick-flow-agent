/// <reference lib="webworker" />

import { brickById } from '../data/basicBricks'
import { prepareAnalysisGeometry } from '../lib/prepareAnalysisGeometry'
import type { EditorAnalysisRequest } from '../lib/editorAnalysisProtocol'


import type { DisasterSimulationOptions } from '../lib/disasterSimulation'
import { createReinforcementCandidates, evaluateReinforcementCandidates, type ReinforcementProposal } from '../lib/stabilityReinforcement'
import type { InventoryOverrides } from '../lib/userInventory'
import type { BuildPlan } from '../types/bricks'

type Request = {
  type: 'analyze-reinforcement'
  requestId: number
  plan: BuildPlan
  geometry: EditorAnalysisRequest['geometry']
  inventoryOverrides: InventoryOverrides
  options: DisasterSimulationOptions
}

export type StabilityReinforcementWorkerResponse =
  | { type: 'result'; requestId: number; proposals: ReinforcementProposal[] }
  | { type: 'error'; requestId: number; message: string }

const workerScope = self as unknown as DedicatedWorkerGlobalScope

workerScope.onmessage = async (event: MessageEvent<Request>) => {
  if (event.data.type !== 'analyze-reinforcement') return
  const { requestId, plan, inventoryOverrides, options } = event.data
  try {
    const definitions = [...new Set(plan.bricks.map(brick => brick.brickId))]
      .flatMap(id => brickById.get(id) ?? [])
    await prepareAnalysisGeometry(definitions, event.data.geometry)
    const candidates = createReinforcementCandidates(plan, inventoryOverrides)
    workerScope.postMessage({
      type: 'result',
      requestId,
      proposals: evaluateReinforcementCandidates(plan, candidates, options),
    } satisfies StabilityReinforcementWorkerResponse)
  } catch (error) {
    workerScope.postMessage({ type: 'error', requestId, message: error instanceof Error ? error.message : 'REINFORCEMENT_FAILED' } satisfies StabilityReinforcementWorkerResponse)
  }
}

export {}
