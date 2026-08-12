import type { WorldDirectorEntry } from '../types/world'

export type WorldDirectorExecutionPresentation = {
  tone: 'pending' | 'active' | 'success' | 'error' | 'muted'
  label: { zh: string; en: string }
  retryable: boolean
  durationSeconds?: number
}

const labels: Record<NonNullable<WorldDirectorEntry['execution']>['phase'], WorldDirectorExecutionPresentation['label']> = {
  queued: { zh: '等待执行', en: 'queued' },
  approaching: { zh: '正在接近', en: 'approaching' },
  acting: { zh: '正在执行', en: 'acting' },
  speaking: { zh: '正在说', en: 'speaking' },
  confirmed: { zh: '已完成', en: 'completed' },
  failed: { zh: '执行失败', en: 'failed' },
  skipped: { zh: '已跳过', en: 'skipped' },
}

export const getWorldDirectorExecutionPresentation = (
  entry: WorldDirectorEntry,
): WorldDirectorExecutionPresentation | undefined => {
  const execution = entry.execution
  if (!execution) return undefined
  const tone = execution.phase === 'queued' || execution.phase === 'approaching'
    ? 'pending'
    : execution.phase === 'acting' || execution.phase === 'speaking'
      ? 'active'
      : execution.phase === 'confirmed'
        ? 'success'
        : execution.phase === 'failed'
          ? 'error'
          : 'muted'
  const durationSeconds = execution.startedAtSeconds !== undefined && execution.finishedAtSeconds !== undefined
    ? Math.max(0, execution.finishedAtSeconds - execution.startedAtSeconds)
    : undefined
  return {
    tone,
    label: labels[execution.phase],
    retryable: execution.phase === 'failed' && execution.retryable === true,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
  }
}

export const getWorldDirectorExecutionFailureReason = (entry: WorldDirectorEntry) => {
  if (entry.execution?.phase !== 'failed') return undefined
  return entry.detail || (entry.status === 'rejected' ? 'EVENT_REJECTED' : 'PLAYBACK_FAILED')
}
