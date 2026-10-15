import { once } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'

export const llmProxyTimeoutMs = 45_000

const readRequestBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = ''
    const cleanup = () => {
      request.off('data', data)
      request.off('end', end)
      request.off('error', error)
      request.off('aborted', aborted)
    }
    const data = (chunk: Buffer) => { body += chunk }
    const end = () => { cleanup(); resolve(body) }
    const error = (failure: Error) => { cleanup(); reject(failure) }
    const aborted = () => error(new Error('Client disconnected'))
    request.on('data', data)
    request.once('end', end)
    request.once('error', error)
    request.once('aborted', aborted)
  })

export const handleLlmProxyRequest = async (request: IncomingMessage, response: ServerResponse) => {
  const controller = new AbortController()
  const disconnect = () => { if (!response.writableEnded) controller.abort() }
  response.once('close', disconnect)
  request.once('aborted', disconnect)
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const json = (status: number, body: unknown) => {
    response.statusCode = status
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(body))
  }

  try {
    if (request.method !== 'POST') {
      json(405, { error: 'Method not allowed' })
      return
    }
    const body = JSON.parse(await readRequestBody(request)) as {
      endpoint?: unknown
      apiKey?: unknown
      payload?: unknown
    } | null
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : ''
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    if (!endpoint || !apiKey || !body?.payload) {
      json(400, { error: 'Missing endpoint, apiKey, or payload' })
      return
    }
    controller.signal.throwIfAborted()
    timeout = setTimeout(() => { timedOut = true; controller.abort() }, llmProxyTimeoutMs)
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body.payload),
      signal: controller.signal,
    })
    if (!upstream.ok) {
      const text = await upstream.text()
      json(502, { error: 'Upstream LLM request failed', endpoint, upstreamStatus: upstream.status, upstreamBody: text.slice(0, 500) })
      return
    }

    response.statusCode = upstream.status
    response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    if (!upstream.body) {
      response.end(await upstream.text())
      return
    }
    reader = upstream.body.getReader()
    while (true) {
      const chunk = await reader.read()
      controller.signal.throwIfAborted()
      if (chunk.done) break
      if (!response.write(Buffer.from(chunk.value))) await once(response, 'drain', { signal: controller.signal })
    }
    response.end()
  } catch (error) {
    // Once a stream has started, an HTTP error response cannot replace it.
    if (response.destroyed || response.writableEnded) return
    if (response.headersSent || (controller.signal.aborted && !timedOut)) {
      response.destroy()
      return
    }
    json(timedOut ? 504 : error instanceof SyntaxError ? 400 : 500, {
      error: timedOut ? 'Upstream LLM request timed out' : error instanceof Error ? error.message : 'LLM proxy failed',
      timeoutMs: timedOut ? llmProxyTimeoutMs : undefined,
    })
  } finally {
    clearTimeout(timeout)
    response.off('close', disconnect)
    request.off('aborted', disconnect)
    controller.abort()
    if (reader) {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }
}

export const llmProxyPlugin = (): Plugin => {
  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    void handleLlmProxyRequest(request, response).catch(next)
  }
  return {
    name: 'llm-proxy',
    configureServer(server) { server.middlewares.use('/api/llm/chat', middleware) },
    configurePreviewServer(server) { server.middlewares.use('/api/llm/chat', middleware) },
  }
}
