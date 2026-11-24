import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequestLifetime, trackResponseActivity } from './requestLifetime'

afterEach(() => { vi.useRealTimers() })

describe('request lifetime', () => {
  it('stays alive while data keeps arriving and aborts after an idle gap', () => {
    vi.useFakeTimers()
    const { controller, touch, dispose } = createRequestLifetime(undefined, 1_000)
    for (let index = 0; index < 5; index++) { vi.advanceTimersByTime(900); touch() }
    expect(controller.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1_000)
    expect(controller.signal.aborted).toBe(true)
    dispose()
  })

  it('caps the total duration regardless of activity', () => {
    vi.useFakeTimers()
    const { controller, touch, dispose } = createRequestLifetime(undefined, 1_000, 3_000)
    for (let index = 0; index < 4; index++) { vi.advanceTimersByTime(900); touch() }
    expect(controller.signal.aborted).toBe(true)
    dispose()
  })

  it('follows the caller and stops timing once disposed', () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const first = createRequestLifetime(caller.signal, 1_000)
    caller.abort()
    expect(first.controller.signal.aborted).toBe(true)
    const second = createRequestLifetime(undefined, 1_000)
    second.dispose()
    vi.advanceTimersByTime(5_000)
    expect(second.controller.signal.aborted).toBe(false)
  })

  it('reports body chunks and preserves the response', async () => {
    const touch = vi.fn()
    const original = new Response('data: one\n\ndata: two\n\n', { status: 201, headers: { 'content-type': 'text/event-stream' } })
    const tracked = trackResponseActivity(original, touch)
    expect(tracked.status).toBe(201)
    expect(tracked.headers.get('content-type')).toBe('text/event-stream')
    expect(await tracked.text()).toBe('data: one\n\ndata: two\n\n')
    expect(touch.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
