import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmConfig } from '../types/bricks'
import { getLlmEmptyResponseRetryTokens, requestLlmJsonContent, requestLlmTextStream, resetLlmThinkingCompatibility, testLlmConnection } from './llmGenerator'

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

    const result = await requestLlmTextStream({
      config,
      systemPrompt: 'Direct the scene.',
      userPrompt: 'Continue.',
      onDelta: (delta) => content.push(delta),
      onReasoningDelta: (delta) => reasoning.push(delta),
    })

    expect(reasoning).toEqual(['先观察环境。'])
    expect(content).toEqual(['{"type":"narration","text":"门外传来脚步声。"}\n'])
    expect(result.content).toBe('{"type":"narration","text":"门外传来脚步声。"}\n')
    expect(result).toMatchObject({ maxTokens: 4096, retryCount: 0 })
  })

  it('retries an empty completed stream once with a larger token budget', async () => {
    const emptyStream = () => new Response('data: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
    const completedStream = () => new Response([
      'data: {"choices":[{"delta":{"content":"继续前进。"},"finish_reason":null}]}',
      '',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => Promise.resolve(emptyStream()))
      .mockImplementationOnce(() => Promise.resolve(completedStream()))
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestLlmTextStream({
      config,
      systemPrompt: 'Direct.',
      userPrompt: 'Continue.',
      maxTokens: 2_400,
      onDelta: () => undefined,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(payloadAt(fetchMock, 0).max_tokens).toBe(2_400)
    expect(payloadAt(fetchMock, 1).max_tokens).toBe(8_192)
    expect(result).toMatchObject({
      content: '继续前进。',
      finishReason: 'stop',
      maxTokens: 8_192,
      retryCount: 1,
    })
  })

  it('caps the automatic empty-response retry budget', () => {
    expect(getLlmEmptyResponseRetryTokens(2_400)).toBe(8_192)
    expect(getLlmEmptyResponseRetryTokens(20_000)).toBe(32_768)
    expect(getLlmEmptyResponseRetryTokens(80_000)).toBe(32_768)
  })

  it('collects cached-token usage from the final stream event', async () => {
    const response = [
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      '',
      'data: {"choices":[],"usage":{"prompt_tokens":1200,"completion_tokens":30,"total_tokens":1230,"prompt_tokens_details":{"cached_tokens":896}}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(response, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })))

    const result = await requestLlmTextStream({
      config,
      systemPrompt: 'Direct.',
      userPrompt: 'Continue.',
      onDelta: () => undefined,
    })

    expect(result.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 30,
      cachedTokens: 896,
      totalTokens: 1230,
    })
  })

  it('retries and remembers when stream usage options are unsupported', async () => {
    const unsupported = new Response(JSON.stringify({
      error: { message: 'Unsupported parameter: stream_options' },
    }), { status: 400 })
    const streamed = () => new Response([
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unsupported)
      .mockImplementation(() => Promise.resolve(streamed()))
    vi.stubGlobal('fetch', fetchMock)

    await requestLlmTextStream({ config, systemPrompt: 'Direct.', userPrompt: 'One.', onDelta: () => undefined })
    await requestLlmTextStream({ config, systemPrompt: 'Direct.', userPrompt: 'Two.', onDelta: () => undefined })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(payloadAt(fetchMock, 0)).toHaveProperty('stream_options')
    expect(payloadAt(fetchMock, 1)).not.toHaveProperty('stream_options')
    expect(payloadAt(fetchMock, 2)).not.toHaveProperty('stream_options')
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
