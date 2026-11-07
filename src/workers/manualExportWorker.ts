/// <reference lib="webworker" />
import { formatBuildManualHtml, type BuildManual, type ManualLocale } from '../lib/manualSerializer'
import type { ManualExportResponse } from '../lib/manualExportClient'

const scope = self as unknown as DedicatedWorkerGlobalScope
scope.onmessage = ({ data }: MessageEvent<{ manual: BuildManual; locale: ManualLocale }>) => {
  try {
    const blob = new Blob([formatBuildManualHtml(data.manual, data.locale)], { type: 'text/html' })
    scope.postMessage({ blob } satisfies ManualExportResponse)
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : 'MANUAL_EXPORT_FAILED' } satisfies ManualExportResponse)
  }
}
