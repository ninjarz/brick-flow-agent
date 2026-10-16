/// <reference lib="webworker" />
import { parseLDrawPlan } from '../lib/ldrawPlan'
import { validateBuildPlan } from '../lib/planUtils'
import type { LDrawWorkerResponse } from '../lib/ldrawImportWorkerClient'

const workerScope = self as unknown as DedicatedWorkerGlobalScope
workerScope.onmessage = (event: MessageEvent<{ text: string; title: string }>) => {
  try {
    const result = parseLDrawPlan(event.data.text, event.data.title)
    workerScope.postMessage({ type: 'result', value: { result, issues: result ? validateBuildPlan(result.plan) : [] } } satisfies LDrawWorkerResponse)
  } catch (error) {
    workerScope.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'LDRAW_IMPORT_FAILED' } satisfies LDrawWorkerResponse)
  }
}
export {}
