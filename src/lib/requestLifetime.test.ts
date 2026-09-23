import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateLlmBuildPlan, requestLlmJsonContent, testLlmConnection } from './llmGenerator'
import { defaultLlmConfig } from './llmConfig'

const config = { ...defaultLlmConfig, modelName: 'mock', apiKey: 'mock', endpoint: 'https://example.invalid' }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('request lifecycle', () => {
  it.each(['generate', 'json', 'test'])('cancels %s after headers even if the body stalls', async (kind) => {
    let bodyStarted!: () => void
    const started = new Promise<void>((resolve) => { bodyStarted = resolve })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: () => { bodyStarted(); return new Promise<string>(() => {}) } })))
    const controller = new AbortController()
    const pending = kind === 'generate' ? generateLlmBuildPlan({ prompt: 'mock', config, signal: controller.signal })
      : kind === 'json' ? requestLlmJsonContent({ config, systemPrompt: '', userPrompt: '', signal: controller.signal })
        : testLlmConnection(config, 'en-US', controller.signal)
    const result = expect(pending).rejects.toThrow()
    await started
    controller.abort()
    await result
  })

  it('does not issue an already canceled request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    controller.abort()
    await expect(generateLlmBuildPlan({ prompt: '', config, signal: controller.signal })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('times out while waiting for the response body', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: () => new Promise<string>(() => {}) })))
    const result = expect(testLlmConnection(config, 'en-US')).rejects.toThrow(/timed out|timeout/i)
    await vi.runAllTimersAsync()
    await result
  })
})
