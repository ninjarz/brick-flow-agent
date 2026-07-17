import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

const llmProxyTimeoutMs = 45_000

const readRequestBody = (request: import('node:http').IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })

const handleLlmProxyRequest = async (
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
) => {
  if (request.method !== 'POST') {
    response.statusCode = 405
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    const body = JSON.parse(await readRequestBody(request)) as {
      endpoint?: string
      apiKey?: string
      payload?: unknown
    }
    const endpoint = body.endpoint?.trim()
    const apiKey = body.apiKey?.trim()

    if (!endpoint || !apiKey || !body.payload) {
      response.statusCode = 400
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ error: 'Missing endpoint, apiKey, or payload' }))
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), llmProxyTimeoutMs)
    let upstream: Response

    try {
      upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body.payload),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    const text = await upstream.text()

    if (!upstream.ok) {
      response.statusCode = 502
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({
          error: 'Upstream LLM request failed',
          endpoint,
          upstreamStatus: upstream.status,
          upstreamBody: text.slice(0, 500),
        }),
      )
      return
    }

    response.statusCode = upstream.status
    response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
    response.end(text)
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError'
    response.statusCode = isTimeout ? 504 : 500
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        error: isTimeout ? 'Upstream LLM request timed out' : error instanceof Error ? error.message : 'LLM proxy failed',
        timeoutMs: isTimeout ? llmProxyTimeoutMs : undefined,
      }),
    )
  }
}

const llmProxyPlugin = () => ({
  name: 'llm-proxy',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use('/api/llm/chat', handleLlmProxyRequest)
  },
  configurePreviewServer(server: import('vite').PreviewServer) {
    server.middlewares.use('/api/llm/chat', handleLlmProxyRequest)
  },
})

// https://vite.dev/config/
export default defineConfig({
  base: '/brick-flow-agent/',
  plugins: [react(), llmProxyPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor'
          if (id.includes('/lucide-react/')) return 'icons-vendor'
          return undefined
        },
      },
    },
  },
})
