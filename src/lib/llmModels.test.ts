import { chatCompletionEndpoint } from './llmEndpoint'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listLlmModels, modelListEndpoint } from './llmModels'

afterEach(() => vi.unstubAllGlobals())

describe('model discovery', () => {
  it('keeps provider prefixes when replacing the chat endpoint', () => {
    expect(modelListEndpoint('https://example.test/api/v1/chat/completions')).toBe('https://example.test/api/v1/models')
    expect(modelListEndpoint('https://example.test/v1/')).toBe('https://example.test/v1/models')
    expect(modelListEndpoint('https://example.test/v1/models?region=a')).toBe('https://example.test/v1/models?region=a')
  })

  it('fetches models without requiring a model name and removes duplicates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, {}] })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(listLlmModels({ endpoint: 'https://example.test/v1/chat/completions', apiKey: 'test-key', requestMode: 'direct' })).resolves.toEqual(['a', 'b'])
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer test-key' } })
  })

  it('uses the local proxy for providers without browser CORS support', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"data":[]}'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(listLlmModels({ endpoint: 'https://example.test/v1/chat/completions', apiKey: 'test-key', requestMode: 'proxy' })).resolves.toEqual([])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/llm/chat')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ endpoint: 'https://example.test/v1/models', operation: 'models' })
  })

  it('rejects unsupported responses and canceled requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    await expect(listLlmModels({ endpoint: 'https://example.test/v1', apiKey: 'test-key', requestMode: 'direct' })).rejects.toThrow('Invalid model list')
    const controller = new AbortController()
    controller.abort()
    await expect(listLlmModels({ endpoint: 'https://example.test/v1', apiKey: 'test-key', requestMode: 'direct' }, controller.signal)).rejects.toThrow()
  })
})


it('accepts a versioned base URL for both generation and discovery', () => {
  expect(chatCompletionEndpoint('https://example.test:8443/v1/')).toBe('https://example.test:8443/v1/chat/completions')
  expect(chatCompletionEndpoint('https://example.test/api/v2')).toBe('https://example.test/api/v2/chat/completions')
  expect(chatCompletionEndpoint('https://example.test/custom/chat')).toBe('https://example.test/custom/chat')
  expect(modelListEndpoint('https://example.test:8443/v1')).toBe('https://example.test:8443/v1/models')
})
