/// <reference lib="webworker" />

import { runDisasterSimulation } from '../lib/disasterSimulation'
import { createStabilitySuiteResult, getStabilitySuiteCases, summarizeStabilitySuiteCase, type StabilitySuitePreset, type StabilitySuiteResult } from '../lib/stabilitySuite'
import type { DisasterPhysicsProfile } from '../lib/disasterSimulation'
import type { PlacedBrick } from '../types/bricks'

type Request = {
  type: 'run-suite'
  requestId: number
  bricks: PlacedBrick[]
  plan: StabilitySuiteResult['plan']
  preset: StabilitySuitePreset
  physicsProfile: DisasterPhysicsProfile
}

export type StabilitySuiteWorkerResponse =
  | { type: 'progress'; requestId: number; completed: number; total: number }
  | { type: 'result'; requestId: number; result: StabilitySuiteResult }
  | { type: 'error'; requestId: number; message: string }

const workerScope = self as unknown as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<Request>) => {
  if (event.data.type !== 'run-suite') return
  const { requestId, bricks, plan, preset, physicsProfile } = event.data
  try {
    const cases = getStabilitySuiteCases(preset, physicsProfile)
    const summaries = cases.map((testCase, index) => {
      const summary = summarizeStabilitySuiteCase(testCase, runDisasterSimulation(bricks, testCase))
      workerScope.postMessage({ type: 'progress', requestId, completed: index + 1, total: cases.length } satisfies StabilitySuiteWorkerResponse)
      return summary
    })
    workerScope.postMessage({ type: 'result', requestId, result: createStabilitySuiteResult(plan, preset, physicsProfile, summaries) } satisfies StabilitySuiteWorkerResponse)
  } catch (error) {
    workerScope.postMessage({ type: 'error', requestId, message: error instanceof Error ? error.message : 'STABILITY_SUITE_FAILED' } satisfies StabilitySuiteWorkerResponse)
  }
}

export {}
