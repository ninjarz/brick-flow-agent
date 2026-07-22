import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmConfig } from '../types/bricks'
import { requestLlmJsonContent, resetLlmThinkingCompatibility, testLlmConnection } from './llmGenerator'

const config: LlmConfig = {
  modelName: 'test-model',
  endpoint: 'https://example.test/chat',
  apiKey: 'test-key',
  requestMode: 'direct',
  enableThinking: true,
  autoRepair: true,
}

const successResponse = () => new Response(JSON.stringify({
  choices: [{ message: { content: '{"ok":true}' } }],
}), { status: 200 })

const unsupportedThinkingResponse = () => new Response(JSON.stringify({
  error: { message: 'Unsupported parameter(s): `thinking`, `enable_thinking`' },
}), { status: 400 })

const request = () => requestLlmJsonContent({
  config,
  systemPrompt: 'Return JSON.',
  userPrompt: 'Return {"ok":true}.',
})

const payloadAt = (fetchMock: ReturnType<typeof vi.fn>, index: number) => {
  const init = fetchMock.mock.calls[index][1] as RequestInit
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

describe('LLM thinking parameter compatibility', () => {
  beforeEach(() => {
    resetLlmThinkingCompatibility()
    vi.stubGlobal('window', { setTimeout, clearTimeout })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries without unsupported fields and remembers the downgrade', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unsupportedThinkingResponse())
      .mockImplementation(() => Promise.resolve(successResponse()))
    vi.stubGlobal('fetch', fetchMock)

    await expect(request()).resolves.toBe('{"ok":true}')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(payloadAt(fetchMock, 0)).toMatchObject({ enable_thinking: true, thinking: { type: 'enabled' } })
    expect(payloadAt(fetchMock, 1)).not.toHaveProperty('enable_thinking')
    expect(payloadAt(fetchMock, 1)).not.toHaveProperty('thinking')

    await expect(request()).resolves.toBe('{"ok":true}')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(payloadAt(fetchMock, 2)).not.toHaveProperty('enable_thinking')
    expect(payloadAt(fetchMock, 2)).not.toHaveProperty('thinking')
  })

  it('tests thinking fields again when connection testing is requested', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unsupportedThinkingResponse())
      .mockImplementation(() => Promise.resolve(successResponse()))
    vi.stubGlobal('fetch', fetchMock)

    await request()
    await testLlmConnection(config)

    expect(payloadAt(fetchMock, 2)).toMatchObject({ enable_thinking: false, thinking: { type: 'disabled' } })
  })
})
