import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmConfig } from '../types/bricks'
import { buildLlmUserPrompt, generateLlmBuildPlan, getLlmEmptyResponseRetryTokens, requestLlmJsonContent, requestLlmTextStream, resetLlmThinkingCompatibility, testLlmConnection } from './llmGenerator'

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

it.each([
  'data: {"error":{"code":429,"message":"Quota exhausted"}}\n\n',
  '[{\n  "error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "Resource exhausted"}\n}]',
])('propagates provider errors appended after HTTP 200 and partial SSE content', async errorTail => {
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  const body = 'data: {"choices":[{"delta":{"content":"{\\"commands\\":["}}]}\n\n' + errorTail
  const fetchMock = vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
  vi.stubGlobal('fetch', fetchMock)
  try {
    await expect(requestLlmJsonContent({ config, systemPrompt: 'JSON', userPrompt: 'Build', stream: true })).rejects.toMatchObject({ name: 'LlmServiceError', status: 429 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  } finally { vi.unstubAllGlobals() }
})

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

describe('pack-aware build plan generation', () => {
  beforeEach(() => {
    resetLlmThinkingCompatibility()
    vi.stubGlobal('window', { setTimeout, clearTimeout })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds a voxel-specific prompt for the minecraft pack and keeps lego as the default', () => {
    const voxelPrompt = buildLlmUserPrompt({ prompt: '一座小屋', pack: 'minecraft' })
    expect(voxelPrompt).toContain('voxel block build plans')
    expect(voxelPrompt).toContain('minecraft-oak-log')
    expect(voxelPrompt).toContain('0.25 increments')
    expect(voxelPrompt).toContain('minecraft-oak-door: Oak Door, shape cube, size 1x0.1875x2 blocks')
    expect(voxelPrompt).toContain('Small Oak Tree')
    expect(voxelPrompt).not.toContain('brick-1x1')

    const legoPrompt = buildLlmUserPrompt({ prompt: '一座小屋' })
    expect(legoPrompt).toContain('brick build plans')
    expect(legoPrompt).toContain('brick-1x1')
    expect(legoPrompt).not.toContain('minecraft-oak-log')
  })

  it('normalizes a minecraft plan returned by the LLM', async () => {
    const planResponse = () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            title: 'Flower Patch',
            bricks: [
              { brickId: 'minecraft-grass-block', color: 'green', xStud: 0, yStud: 0, zStud: 0 },
              { brickId: 'minecraft-red-flower', color: 'red', xStud: 0, yStud: 1, zStud: 0 },
              { brickId: 'minecraft-grass-block', color: 'green', xStud: 1.4, yStud: 0, zStud: 0 },
              { brickId: 'brick-1x1', color: 'red', xStud: 2, yStud: 0, zStud: 0 },
              { brickId: 'minecraft-oak-door', color: 'brown', xStud: 2.4, yStud: 0.12, zStud: 0 },
            ],
          }),
        },
      }],
    }), { status: 200 })
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(planResponse()))
    vi.stubGlobal('fetch', fetchMock)

    const plan = await generateLlmBuildPlan({ prompt: '一朵花', pack: 'minecraft', config })

    expect(plan.bricks.map((brick) => brick.brickId)).toEqual([
      'minecraft-grass-block',
      'minecraft-red-flower',
      'minecraft-grass-block',
      'minecraft-oak-door',
    ])
    const flower = plan.bricks[1]
    expect(flower.pose.yStud).toBe(1)
    expect(flower.pose.verticalQuarterTurns).toBe(0)
    expect(plan.bricks.every((brick) => Number.isInteger(brick.pose.xStud) && Number.isInteger(brick.pose.zStud))).toBe(true)
    expect(plan.bricks.every((brick) => Number.isInteger(brick.pose.yStud * 4))).toBe(true)
    expect(plan.bricks.some((brick) => brick.brickId === 'brick-1x1')).toBe(false)

    const requestPayload = payloadAt(fetchMock, 0)
    const userMessage = (requestPayload.messages as Array<{ role: string; content: string }>)
      .find((message) => message.role === 'user')!
    expect(userMessage.content).toContain('minecraft-grass-block')
    expect(userMessage.content).toContain('plant: must sit on a solid cube top')
  })
})

describe('streamed generation JSON', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('reads JSON across SSE chunks and accepts a versioned base URL', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    const chunks = ['{"ok":', 'true}'].map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
    const fetchMock = vi.fn().mockResolvedValue(new Response(chunks, { headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestLlmJsonContent({ config: { ...config, endpoint: 'https://example.test/v1' }, systemPrompt: 'Return JSON', userPrompt: 'test', stream: true })).resolves.toBe('{"ok":true}')
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/v1/chat/completions')
  })
})

describe('generation output budget recovery', () => {
  afterEach(() => vi.unstubAllGlobals())
  const response = (content: string, finishReason = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }), { headers: { 'Content-Type': 'application/json' } })

  it('automatically retries a truncated initial answer as compact modules', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    const layout = { title: 'Blue cat', modules: [{ name: 'Body', description: 'A blue base', origin: [0, 0, 0], tool: 'parts' }] }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response('{"bricks":[', 'length'))
      .mockResolvedValueOnce(response(JSON.stringify(layout)))
      .mockResolvedValueOnce(response('{"commands":[{"brickId":"brick-1x1","color":"blue","at":[0,0,0]}]}'))
    vi.stubGlobal('fetch', fetchMock)
    const plan = await generateLlmBuildPlan({ prompt: '一只叮当猫', config: { ...config, enableThinking: false } })
    expect(plan.bricks).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(payloadAt(fetchMock, 0).max_tokens).toBe(4096)
    expect(payloadAt(fetchMock, 1).max_tokens).toBe(8192)
    expect(JSON.stringify(payloadAt(fetchMock, 1).messages)).toContain('compact layout')
    expect(plan.prompt).toBe('一只叮当猫')
  })

  it('accepts complete JSON even if the provider reports a length finish', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('{"ok":true}', 'length')))
    await expect(requestLlmJsonContent({ config, systemPrompt: 'JSON', userPrompt: 'test' })).resolves.toBe('{"ok":true}')
  })

  it('bounds recovery when reasoning consumes the second output budget too', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '', reasoning_content: 'thinking' }, finish_reason: 'length' }] }), { headers: { 'Content-Type': 'application/json' } })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateLlmBuildPlan({ prompt: 'cat', config })).rejects.toThrow('耗尽')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(payloadAt(fetchMock, 1).enable_thinking).toBe(false)
  })
})

describe('provider quota failures', () => {
  afterEach(() => vi.unstubAllGlobals())
  it.each([429, 502])('recognizes direct or proxy quota errors with HTTP %i', async status => {
    const body = status === 429 ? [{ error: { code: 429, message: 'TPM quota exhausted' } }] : { error: 'Upstream LLM request failed', upstreamStatus: 429, upstreamBody: 'TPM quota exhausted' }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Retry-After': '60' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestLlmJsonContent({ config, systemPrompt: 'JSON', userPrompt: 'test' })).rejects.toThrow('60 秒')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the planning prompt small without enumerating the full catalogue', () => {
    const prompt = buildLlmUserPrompt({ prompt: '一只叮当猫' })
    expect(prompt.length).toBeLessThan(6000)
    expect(prompt).toContain('compact module layout')
    expect(prompt).not.toContain('inventory unlimited')
  })
})

it('ignores OpenRouter heartbeat comments and identifies reasoning-only truncation', async () => {
  const data = { choices: [{ delta: { reasoning: 'thinking', content: '' }, finish_reason: 'length' }] }
  const body = `: OPENROUTER PROCESSING\n\ndata: ${JSON.stringify(data)}\n\n: OPENROUTER PROCESSING\n\ndata: [DONE]\n\n`
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })))
  try {
    await expect(requestLlmJsonContent({ config, systemPrompt: 'JSON', userPrompt: 'cat', stream: true })).rejects.toMatchObject({ name: 'LlmOutputLimitError', reasoningOnly: true })
  } finally { vi.unstubAllGlobals() }
})

it('renders complete streamed commands before a module response finishes', async () => {
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  const layout = { title: 'Cat', modules: [{ name: 'Body', description: 'blue body', origin: [0, 0, 0], tool: 'parts' }] }
  const encoder = new TextEncoder()
  const event = (content: string) => encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
  let writer!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({ start(controller) { writer = controller } })
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(layout) } }] })))
    .mockResolvedValueOnce(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })))
  const draft = vi.fn(), accepted = vi.fn()
  const done = generateLlmBuildPlan({ prompt: 'cat', config, onDraft: draft, onProgress: accepted })
  writer.enqueue(event('{"commands":[{"brickId":"brick-1x1","color":"blue","at":[0,0,0]}'))
  await vi.waitFor(() => expect(draft).toHaveBeenCalled())
  expect(accepted).not.toHaveBeenCalled()
  expect(draft.mock.calls[0][0].bricks).toHaveLength(1)
  writer.enqueue(event(',{"brickId":"brick-1x1","color":"blue","at":[0,1.2,0]}]}'))
  writer.enqueue(encoder.encode('data: [DONE]\n\n'))
  writer.close()
  try {
    const plan = await done
    expect(plan.bricks).toHaveLength(2)
    expect(accepted).toHaveBeenCalledTimes(1)
  } finally { vi.unstubAllGlobals() }
})

it('uses OpenRouter native controls when thinking is disabled', async () => {
  resetLlmThinkingCompatibility()
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"choices":[{"message":{"content":"{\\"ok\\":true}"}}]}'))
  vi.stubGlobal('fetch', fetchMock)
  try {
    await requestLlmJsonContent({ config: { ...config, endpoint: 'https://openrouter.ai/api/v1', enableThinking: false }, systemPrompt: 'JSON', userPrompt: 'test' })
    expect(payloadAt(fetchMock, 0).reasoning).toEqual({ enabled: false })
    expect(payloadAt(fetchMock, 0)).not.toHaveProperty('thinking')
  } finally { vi.unstubAllGlobals() }
})

it('retries mandatory reasoning models with low effort and scopes the fallback to that model', async () => {
  resetLlmThinkingCompatibility()
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Reasoning is mandatory for this endpoint and cannot be disabled.' } }), { status: 400 }))
    .mockImplementation(() => Promise.resolve(successResponse()))
  vi.stubGlobal('fetch', fetchMock)
  const input = { config: { ...config, endpoint: 'https://openrouter.ai/api/v1', enableThinking: false }, systemPrompt: 'JSON', userPrompt: 'test' }
  try {
    await requestLlmJsonContent(input)
    expect(payloadAt(fetchMock, 0).reasoning).toEqual({ enabled: false })
    expect(payloadAt(fetchMock, 1).reasoning).toEqual({ enabled: true, effort: 'low' })
    expect(payloadAt(fetchMock, 1).max_tokens).toBe(32_768)
    await requestLlmJsonContent(input)
    expect(payloadAt(fetchMock, 2).reasoning).toEqual({ enabled: true, effort: 'low' })
    await requestLlmJsonContent({ ...input, config: { ...input.config, modelName: 'another-model' } })
    expect(payloadAt(fetchMock, 3).reasoning).toEqual({ enabled: false })
  } finally {
    resetLlmThinkingCompatibility()
    vi.unstubAllGlobals()
  }
})
