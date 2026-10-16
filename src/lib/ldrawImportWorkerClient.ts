import type { LDrawImportResult } from './ldrawPlan'
import type { validateBuildPlan } from './planUtils'

export type LDrawWorkerResult = { result: LDrawImportResult | undefined; issues: ReturnType<typeof validateBuildPlan> }
export type LDrawWorkerResponse = { type: 'result'; value: LDrawWorkerResult } | { type: 'error'; message: string }

export const importLDrawInWorker = (text: string, title: string, signal: AbortSignal): Promise<LDrawWorkerResult> => new Promise((resolve, reject) => {
  signal.throwIfAborted()
  const worker = new Worker(new URL('../workers/ldrawImportWorker.ts', import.meta.url), { type: 'module' })
  const finish = (failure?: Error, result?: LDrawWorkerResult) => {
    clearTimeout(timeout)
    signal.removeEventListener('abort', canceled)
    worker.terminate()
    if (failure) reject(failure)
    else resolve(result!)
  }
  const canceled = () => finish(new DOMException('Import canceled', 'AbortError'))
  const timeout = setTimeout(() => finish(new RangeError('LDRAW_IMPORT_LIMIT_EXCEEDED')), 15_000)
  signal.addEventListener('abort', canceled, { once: true })
  worker.onmessage = (event: MessageEvent<LDrawWorkerResponse>) => {
    const response = event.data
    if (response.type === 'error') finish(response.message === 'LDRAW_IMPORT_LIMIT_EXCEEDED' ? new RangeError(response.message) : new Error(response.message))
    else finish(undefined, response.value)
  }
  worker.onerror = () => finish(new Error('LDRAW_IMPORT_WORKER_FAILED'))
  worker.postMessage({ text, title })
})
