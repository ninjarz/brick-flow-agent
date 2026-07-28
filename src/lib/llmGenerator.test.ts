import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmConfig } from '../types/bricks'
import { requestLlmJsonContent, requestLlmTextStream, resetLlmThinkingCompatibility, testLlmConnection } from './llmGenerator'

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

  it('streams reasoning separately from visible content', async () => {
    const response = [
      'data: {"choices":[{"delta":{"reasoning_content":"先观察环境。"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"narration\\",\\"text\\":\\"门外传来脚步声。\\"}\\n"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(response, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })))
    const content: string[] = []
    const reasoning: string[] = []

    await requestLlmTextStream({
      config,
      systemPrompt: 'Direct the scene.',
      userPrompt: 'Continue.',
      onDelta: (delta) => content.push(delta),
      onReasoningDelta: (delta) => reasoning.push(delta),
    })

    expect(reasoning).toEqual(['先观察环境。'])
    expect(content).toEqual(['{"type":"narration","text":"门外传来脚步声。"}\n'])
  })

  it('sends an explicit multi-turn message sequence unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const messages = [
      { role: 'system' as const, content: 'Stable rules.' },
      { role: 'user' as const, content: 'Turn one.' },
      { role: 'assistant' as const, content: 'Result one.' },
      { role: 'user' as const, content: 'Turn two.' },
    ]

    await requestLlmTextStream({ config, messages, onDelta: () => undefined })

    expect(payloadAt(fetchMock, 0).messages).toEqual(messages)
  })

  it('reuses a thinking-parameter downgrade discovered by the connection test', async () => {
    const streamResponse = new Response([
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unsupportedThinkingResponse())
      .mockResolvedValueOnce(successResponse())
      .mockResolvedValueOnce(streamResponse)
    vi.stubGlobal('fetch', fetchMock)

    await testLlmConnection(config)
    await requestLlmTextStream({
      config,
      systemPrompt: 'Direct.',
      userPrompt: 'Continue.',
      onDelta: () => undefined,
    })

    expect(payloadAt(fetchMock, 0)).toMatchObject({
      enable_thinking: false,
      thinking: { type: 'disabled' },
    })
    expect(payloadAt(fetchMock, 1)).not.toHaveProperty('enable_thinking')
    expect(payloadAt(fetchMock, 1)).not.toHaveProperty('thinking')
    expect(payloadAt(fetchMock, 2)).not.toHaveProperty('enable_thinking')
    expect(payloadAt(fetchMock, 2)).not.toHaveProperty('thinking')
  })
})
