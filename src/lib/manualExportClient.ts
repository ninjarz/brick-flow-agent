import type { BuildPlan } from '../types/bricks'
import { formatLDrawPlan } from './ldrawPlan'
import { formatBuildManualHtml, type BuildManual, type ManualLocale } from './manualSerializer'

export type ManualExportResponse = { blob: Blob } | { error: string }

export type ManualExportRequest = { manual: BuildManual; locale: ManualLocale } | { plan: BuildPlan }

/** Build the large string and Blob off the UI thread; Blob cloning shares its bytes. */
const requestExport = (request: ManualExportRequest): Promise<Blob> => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('../workers/manualExportWorker.ts', import.meta.url), { type: 'module' })
  const finish = (error?: Error, blob?: Blob) => {
    clearTimeout(timeout)
    worker.terminate()
    if (error) reject(error)
    else resolve(blob!)
  }
  const timeout = setTimeout(() => finish(new Error('MANUAL_EXPORT_TIMEOUT')), 60_000)
  worker.onmessage = ({ data }: MessageEvent<ManualExportResponse>) => {
    if ('error' in data) finish(new Error(data.error))
    else finish(undefined, data.blob)
  }
  worker.onerror = worker.onmessageerror = () => finish(new Error('MANUAL_EXPORT_FAILED'))
  try { worker.postMessage(request) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
})

export const createManualHtmlBlob = (manual: BuildManual, locale: ManualLocale): Promise<Blob> => {
  if (manual.totalPieces <= 500 || typeof Worker === 'undefined') {
    return Promise.resolve(new Blob([formatBuildManualHtml(manual, locale)], { type: 'text/html' }))
  }
  return requestExport({ manual, locale })
}

export const createLDrawBlob = (plan: BuildPlan): Promise<Blob> => {
  if (plan.bricks.length <= 500 || typeof Worker === 'undefined') {
    return Promise.resolve(new Blob([formatLDrawPlan(plan)], { type: 'text/plain' }))
  }
  return requestExport({ plan })
}
