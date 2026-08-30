/// <reference lib="webworker" />

import type { DisasterSimulationOptions } from '../lib/disasterSimulation'
import { createReinforcementCandidates, evaluateReinforcementCandidates, type ReinforcementProposal } from '../lib/stabilityReinforcement'
import type { InventoryOverrides } from '../lib/userInventory'
import type { BuildPlan } from '../types/bricks'

type Request = {
  type: 'analyze-reinforcement'
  requestId: number
  plan: BuildPlan
  inventoryOverrides: InventoryOverrides
  options: DisasterSimulationOptions
}

export type StabilityReinforcementWorkerResponse =
  | { type: 'result'; requestId: number; proposals: ReinforcementProposal[] }
  | { type: 'error'; requestId: number; message: string }

const workerScope = self as unknown as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<Request>) => {
  if (event.data.type !== 'analyze-reinforcement') return
  const { requestId, plan, inventoryOverrides, options } = event.data
  try {
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
