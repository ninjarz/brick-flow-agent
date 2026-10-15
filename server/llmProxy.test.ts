import { afterEach, describe, expect, it, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { handleLlmProxyRequest, llmProxyTimeoutMs } from './llmProxy'

const fixture = () => {
  const request = new IncomingMessage(new Socket())
  request.method = 'POST'
  const response = new ServerResponse(request)
  const write = response.write.bind(response)
  // No client socket is attached; forward writes without waiting for its drain.
  vi.spyOn(response, 'write').mockImplementation(chunk => { write(chunk); return true })
  const end = vi.spyOn(response, 'end')
  const run = () => {
    const done = handleLlmProxyRequest(request, response)
    request.emit('data', Buffer.from(JSON.stringify({ endpoint: 'https://fixture.invalid/chat', apiKey: 'fixture', payload: {} })))
    request.emit('end')
    return done
  }
  return { request, response, end, run }
}
const readerFixture = () => ({ read: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn() })
const mockUpstream = (reader: ReturnType<typeof readerFixture>) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: { getReader: () => reader } }) as unknown as Response
const chunk = { done: false, value: new TextEncoder().encode('data: first\n\n') }
const waitForAbort = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
  signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
})

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('LLM proxy streaming lifetime', () => {
  it('forwards a complete stream and releases its reader', async () => {
    const reader = readerFixture()
    reader.read.mockResolvedValueOnce(chunk).mockResolvedValueOnce({ done: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockUpstream(reader)))
    const { response, run } = fixture()
    await run()
    expect(response.statusCode).toBe(200)
    expect(response.writableEnded).toBe(true)
    expect(reader.cancel).toHaveBeenCalledOnce()
    expect(reader.releaseLock).toHaveBeenCalledOnce()
  })

  it('returns JSON for a failure before sending any stream data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Upstream unavailable')))
    const { response, end, run } = fixture()
    await expect(run()).resolves.toBeUndefined()
    expect(response.statusCode).toBe(500)
    expect(JSON.parse(String(end.mock.calls[0][0])).error).toBe('Upstream unavailable')
  })

  it('closes a partially sent response on upstream failure without rewriting headers', async () => {
    const reader = readerFixture()
    reader.read.mockResolvedValueOnce(chunk).mockRejectedValueOnce(new Error('Upstream disconnected'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockUpstream(reader)))
    const { response, run } = fixture()
    await expect(run()).resolves.toBeUndefined()
    expect(response.headersSent).toBe(true)
    expect(response.destroyed).toBe(true)
    expect(reader.releaseLock).toHaveBeenCalledOnce()
    // The same handler remains usable after a failed stream.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    const next = fixture()
    await next.run()
    expect(next.response.writableEnded).toBe(true)
  })

  for (const firstChunk of [false, true]) it(`handles a timeout ${firstChunk ? 'after' : 'before'} the first chunk`, async () => {
    vi.useFakeTimers()
    const reader = readerFixture()
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init: RequestInit) => {
      if (firstChunk) reader.read.mockResolvedValueOnce(chunk)
      reader.read.mockImplementation(() => waitForAbort(init.signal!))
      return mockUpstream(reader)
    }))
    const { response, run } = fixture()
    const done = run()
    await vi.advanceTimersByTimeAsync(llmProxyTimeoutMs)
    await expect(done).resolves.toBeUndefined()
    expect(firstChunk ? response.destroyed : response.statusCode === 504).toBe(true)
    expect(reader.releaseLock).toHaveBeenCalledOnce()
  })

  it('aborts the upstream and releases the reader when the client disconnects', async () => {
    const reader = readerFixture()
    let upstreamSignal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init: RequestInit) => {
      upstreamSignal = init.signal!
      reader.read.mockResolvedValueOnce(chunk).mockImplementation(() => waitForAbort(upstreamSignal))
      return mockUpstream(reader)
    }))
    const { response, run } = fixture()
    const done = run()
    await vi.waitFor(() => expect(response.headersSent).toBe(true))
    response.emit('close')
    await expect(done).resolves.toBeUndefined()
    expect(upstreamSignal.aborted).toBe(true)
    expect(reader.cancel).toHaveBeenCalledOnce()
  })
})
