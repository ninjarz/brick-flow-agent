import { chatCompletionEndpoint } from '../src/lib/llmEndpoint'
import { once } from 'node:events'
import { isIP } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'

/**
 * Idle timeout: aborts when the upstream sends nothing for this long, and is
 * reset by every streamed chunk. Slow reasoning models can stay silent for
 * minutes before their first byte. Kept just below the browser's 240 s total
 * request limit so a silent upstream still gets a clear 504 back.
 */
export const llmProxyTimeoutMs = 230_000
/** Generous enough for a base64 reference image plus a long prompt. */
export const llmProxyMaxBodyBytes = 32 * 1024 * 1024

class ProxyRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const headerValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

/**
 * Only same-origin browser requests may use the proxy. A cross-site page can
 * still send a "simple" text/plain POST without a CORS preflight, so the
 * JSON content type and the Origin header are both required to match.
 * Non-browser clients (curl, scripts) send no Origin and stay usable.
 */
const assertSameOriginJsonRequest = (request: IncomingMessage) => {
  const contentType = headerValue(request.headers['content-type'])?.split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new ProxyRequestError(415, 'Content-Type must be application/json')
  }
  const fetchSite = headerValue(request.headers['sec-fetch-site'])
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new ProxyRequestError(403, 'Cross-site requests are not allowed')
  }
  const origin = headerValue(request.headers.origin)
  if (origin === undefined) return
  let originHost = ''
  try { originHost = new URL(origin).host } catch { /* "null" or malformed */ }
  if (!originHost || originHost !== headerValue(request.headers.host)) {
    throw new ProxyRequestError(403, 'Cross-origin requests are not allowed')
  }
}

const blockedHostnames = new Set(['metadata', 'metadata.google.internal', 'metadata.goog'])

const isBlockedIPv4 = (address: string) => {
  const [first, second] = address.split('.').map(Number)
  // 0.0.0.0/8 (unspecified) and 169.254.0.0/16 (link-local, cloud metadata).
  return first === 0 || (first === 169 && second === 254)
}

const isBlockedAddress = (address: string) => {
  const kind = isIP(address)
  if (kind === 4) return isBlockedIPv4(address)
  if (kind !== 6) return false
  const normalized = address.toLowerCase()
  // IPv4-mapped IPv6. URL parsing serializes it in hex (::ffff:a9fe:a9fe).
  const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) return isBlockedIPv4(dotted[1])
  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const [high, low] = [parseInt(hex[1], 16), parseInt(hex[2], 16)]
    return isBlockedIPv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
  }
  // ::, fe80::/10 (link-local) and fd00:ec2::254 (AWS IPv6 metadata).
  return normalized === '::' || /^fe[89ab][0-9a-f]:/.test(normalized) || normalized === 'fd00:ec2::254'
}

/**
 * Validates where the proxy may connect. Loopback and private networks stay
 * allowed for local model servers (Ollama, LM Studio, vLLM); link-local and
 * cloud metadata addresses never host an LLM API and are refused.
 * Hostnames are checked as written: names that resolve to a blocked address
 * are not caught here, which the same-origin check above makes unreachable
 * from other websites.
 */
export const resolveProxyTarget = (endpoint: string, listingModels: boolean) => {
  let target: URL
  try {
    target = new URL(listingModels ? endpoint : chatCompletionEndpoint(endpoint))
  } catch {
    throw new ProxyRequestError(400, 'Invalid endpoint')
  }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new ProxyRequestError(400, 'Invalid endpoint')
  }
  const hostname = target.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (blockedHostnames.has(hostname) || isBlockedAddress(hostname)) {
    throw new ProxyRequestError(403, 'Endpoint address is not allowed')
  }
  target.hash = ''
  return target.toString()
}

const readRequestBody = (request: IncomingMessage, maxBytes = llmProxyMaxBodyBytes) =>
  new Promise<string>((resolve, reject) => {
    const declared = Number(headerValue(request.headers['content-length']))
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new ProxyRequestError(413, 'Request body too large'))
      return
    }
    // Decode once at the end: a multi-byte UTF-8 character can be split
    // across two chunks, and decoding each chunk separately corrupts it.
    const chunks: Buffer[] = []
    let size = 0
    const cleanup = () => {
      request.off('data', data)
      request.off('end', end)
      request.off('error', error)
      request.off('aborted', aborted)
    }
    const data = (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buffer.length
      if (size > maxBytes) {
        cleanup()
        chunks.length = 0
        reject(new ProxyRequestError(413, 'Request body too large'))
        return
      }
      chunks.push(buffer)
    }
    const end = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')) }
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
    assertSameOriginJsonRequest(request)
    const body = JSON.parse(await readRequestBody(request)) as {
      endpoint?: unknown
      apiKey?: unknown
      payload?: unknown
      operation?: unknown
    } | null
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : ''
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    const listingModels = body?.operation === 'models'
    if (!endpoint || !apiKey || (!listingModels && !body?.payload)) {
      json(400, { error: 'Missing endpoint, apiKey, or payload' })
      return
    }
    const target = resolveProxyTarget(endpoint, listingModels)
    controller.signal.throwIfAborted()
    const resetIdleTimeout = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => { timedOut = true; controller.abort() }, llmProxyTimeoutMs)
    }
    resetIdleTimeout()
    const upstream = await fetch(target, {
      method: listingModels ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: listingModels ? undefined : JSON.stringify(body?.payload),
      signal: controller.signal,
      // Never follow a redirect into an address the checks above would refuse.
      redirect: 'manual',
    })
    resetIdleTimeout()
    if (upstream.status >= 300 && upstream.status < 400) {
      json(502, {
        error: 'Upstream LLM endpoint redirected; configure the final URL instead',
        endpoint,
        upstreamStatus: upstream.status,
        location: upstream.headers.get('location') ?? undefined,
      })
      return
    }
    if (!upstream.ok) {
      const text = await upstream.text()
      const retryAfter = upstream.headers.get('retry-after')
      if (retryAfter) response.setHeader('Retry-After', retryAfter)
      json(upstream.status === 429 ? 429 : 502, { error: 'Upstream LLM request failed', endpoint, upstreamStatus: upstream.status, upstreamBody: text.slice(0, 500) })
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
      resetIdleTimeout()
      if (!response.write(Buffer.from(chunk.value))) await once(response, 'drain', { signal: controller.signal })
    }
    response.end()
  } catch (error) {
    // Once a stream has started, an HTTP error response cannot replace it.
    if (response.destroyed || response.writableEnded) return
    if (error instanceof ProxyRequestError && !response.headersSent) {
      // An oversized body may still be arriving; do not keep the socket.
      if (error.status === 413) response.setHeader('Connection', 'close')
      json(error.status, { error: error.message })
      return
    }
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
