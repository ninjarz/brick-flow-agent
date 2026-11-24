import { afterEach, describe, expect, it, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { handleLlmProxyRequest, llmProxyMaxBodyBytes, llmProxyTimeoutMs, resolveProxyTarget } from './llmProxy'

const jsonHeaders = { 'content-type': 'application/json', host: 'localhost:5173' }
const fixture = (operation?: 'models', options: { endpoint?: string; headers?: Record<string, string> } = {}) => {
  const request = new IncomingMessage(new Socket())
  request.method = 'POST'
  request.headers = { ...jsonHeaders, ...options.headers }
  const response = new ServerResponse(request)
  const write = response.write.bind(response)
  // No client socket is attached; forward writes without waiting for its drain.
  vi.spyOn(response, 'write').mockImplementation(chunk => { write(chunk); return true })
  const end = vi.spyOn(response, 'end')
  const run = () => {
    const done = handleLlmProxyRequest(request, response)
    request.emit('data', Buffer.from(JSON.stringify({ endpoint: options.endpoint ?? 'https://fixture.invalid/chat', apiKey: 'fixture', payload: operation ? undefined : {}, operation })))
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


describe('model listing proxy', () => {
  it('requests models with GET and no upstream body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"data":[{"id":"test-model"}]}', { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { run, response, end } = fixture('models')
    await run()
    expect(response.statusCode).toBe(200)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', body: undefined })
    expect(end).toHaveBeenCalled()
  })
})

it('keeps an active stream alive beyond the original total timeout', async () => {
  vi.useFakeTimers()
  const reader = readerFixture()
  let signal!: AbortSignal
  let nextChunk!: (value: { done: boolean; value: Uint8Array }) => void
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init: RequestInit) => {
    signal = init.signal!
    reader.read.mockResolvedValueOnce(chunk)
      .mockImplementationOnce(() => new Promise(resolve => { nextChunk = resolve }))
      .mockImplementation(() => waitForAbort(signal))
    return mockUpstream(reader)
  }))
  const { run, response } = fixture()
  const done = run()
  await vi.advanceTimersByTimeAsync(llmProxyTimeoutMs * 0.75)
  nextChunk(chunk)
  await vi.advanceTimersByTimeAsync(llmProxyTimeoutMs * 0.75)
  expect(signal.aborted).toBe(false)
  response.emit('close')
  await done
  expect(signal.aborted).toBe(true)
})

it('preserves provider rate limits and Retry-After instead of turning them into 502', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"code":429}}', { status: 429, headers: { 'Retry-After': '60' } })))
  const { run, response } = fixture()
  await run()
  expect(response.statusCode).toBe(429)
  expect(response.getHeader('Retry-After')).toBe('60')
})

it('decodes a UTF-8 character split across request chunks', async () => {
  const reader = readerFixture()
  reader.read.mockResolvedValueOnce({ done: true })
  const fetchMock = vi.fn().mockResolvedValue(mockUpstream(reader))
  vi.stubGlobal('fetch', fetchMock)
  const request = new IncomingMessage(new Socket())
  request.method = 'POST'
  request.headers = { ...jsonHeaders }
  const response = new ServerResponse(request)
  const body = Buffer.from(JSON.stringify({ endpoint: 'https://fixture.invalid/chat', apiKey: 'fixture', payload: { prompt: '城堡' } }))
  const split = body.indexOf(Buffer.from('城')) + 1
  const done = handleLlmProxyRequest(request, response)
  request.emit('data', body.subarray(0, split))
  request.emit('data', body.subarray(split))
  request.emit('end')
  await done
  expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).prompt).toBe('城堡')
})

describe('proxy request hardening', () => {
  const statusOf = async (options: Parameters<typeof fixture>[1]) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const { run, response, end } = fixture(undefined, options)
    await run()
    return { status: response.statusCode, fetchMock, error: JSON.parse(String(end.mock.calls.at(-1)?.[0] ?? '{}')).error }
  }

  it('rejects a cross-site text/plain form post before reading credentials', async () => {
    const result = await statusOf({ headers: { 'content-type': 'text/plain' } })
    expect(result.status).toBe(415)
    expect(result.fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a JSON request from another origin', async () => {
    expect((await statusOf({ headers: { origin: 'https://evil.example' } })).status).toBe(403)
    expect((await statusOf({ headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await statusOf({ headers: { origin: 'null' } })).status).toBe(403)
  })

  it('accepts same-origin browser requests and Origin-less tools', async () => {
    expect((await statusOf({ headers: { origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' } })).status).toBe(200)
    expect((await statusOf({ headers: { 'content-type': 'application/json; charset=utf-8' } })).status).toBe(200)
  })

  it('refuses link-local and cloud metadata endpoints', async () => {
    for (const endpoint of [
      'http://169.254.169.254/latest/meta-data',
      'http://2852039166/v1',
      'http://[fe80::1]/v1',
      'http://[::ffff:169.254.169.254]/v1',
      'http://metadata.google.internal/v1',
      'http://0.0.0.0:11434/v1',
    ]) {
      const result = await statusOf({ endpoint })
      expect(result.status, endpoint).toBe(403)
      expect(result.fetchMock).not.toHaveBeenCalled()
    }
  })

  it('keeps local and private model servers reachable', () => {
    expect(resolveProxyTarget('http://localhost:11434/v1', false)).toBe('http://localhost:11434/v1/chat/completions')
    expect(resolveProxyTarget('http://192.168.1.20:1234/v1', false)).toBe('http://192.168.1.20:1234/v1/chat/completions')
    expect(resolveProxyTarget('http://127.0.0.1:8000/v1/models', true)).toBe('http://127.0.0.1:8000/v1/models')
  })

  it('rejects non-HTTP schemes and embedded credentials for model listing too', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    for (const endpoint of ['file:///etc/passwd', 'http://user:pass@api.example/v1/models']) {
      const { run, response } = fixture('models', { endpoint })
      await run()
      expect(response.statusCode, endpoint).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an oversized body by Content-Length and while streaming', async () => {
    expect((await statusOf({ headers: { 'content-length': String(llmProxyMaxBodyBytes + 1) } })).status).toBe(413)
    vi.stubGlobal('fetch', vi.fn())
    const request = new IncomingMessage(new Socket())
    request.method = 'POST'
    request.headers = { ...jsonHeaders }
    const response = new ServerResponse(request)
    const done = handleLlmProxyRequest(request, response)
    request.emit('data', Buffer.alloc(llmProxyMaxBodyBytes + 1, 32))
    await done
    expect(response.statusCode).toBe(413)
    expect(response.getHeader('Connection')).toBe('close')
  })

  it('reports an upstream redirect instead of following it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/' } })))
    const { run, response, end } = fixture()
    await run()
    expect(response.statusCode).toBe(502)
    expect(JSON.parse(String(end.mock.calls[0][0]))).toMatchObject({ upstreamStatus: 301, location: 'http://169.254.169.254/' })
  })
})
