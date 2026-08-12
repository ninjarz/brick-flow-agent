import { describe, expect, it } from 'vitest'
import { getWorldDirectorExecutionFailureReason, getWorldDirectorExecutionPresentation } from './worldDirectorExecution'

describe('world director execution presentation', () => {
  it('uses durable execution metadata instead of transport detail strings', () => {
    const result = getWorldDirectorExecutionPresentation({
      id: 'line', type: 'dialogue', speakerId: 'hero', text: 'Hello', detail: 'PLAYING',
      execution: { phase: 'failed', attempt: 2, startedAtSeconds: 2, finishedAtSeconds: 3.25, retryable: true },
    })
    expect(result).toMatchObject({ tone: 'error', retryable: true, durationSeconds: 1.25 })
    expect(result?.label.zh).toBe('执行失败')
  })

  it('keeps the machine-readable failure reason available', () => {
    expect(getWorldDirectorExecutionFailureReason({
      id: 'command', type: 'command', entityId: 'hero', command: { type: 'stop' },
      detail: 'PLAYBACK_TIMEOUT', execution: { phase: 'failed', attempt: 1 },
    })).toBe('PLAYBACK_TIMEOUT')
  })
})
