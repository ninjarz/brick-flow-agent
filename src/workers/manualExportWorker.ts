/// <reference lib="webworker" />
import { formatBuildManualHtml } from '../lib/manualSerializer'
import { formatLDrawPlan } from '../lib/ldrawPlan'
import type { ManualExportRequest, ManualExportResponse } from '../lib/manualExportClient'

const scope = self as unknown as DedicatedWorkerGlobalScope
scope.onmessage = ({ data }: MessageEvent<ManualExportRequest>) => {
  try {
    const blob = 'plan' in data
      ? new Blob([formatLDrawPlan(data.plan)], { type: 'text/plain' })
      : new Blob([formatBuildManualHtml(data.manual, data.locale)], { type: 'text/html' })
    scope.postMessage({ blob } satisfies ManualExportResponse)
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : 'MANUAL_EXPORT_FAILED' } satisfies ManualExportResponse)
  }
}
