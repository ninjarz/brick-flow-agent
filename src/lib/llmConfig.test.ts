import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmConfig } from '../types/bricks'
import { clearLlmConnection, hasPersistedLlmConnection, saveLlmConnection } from './llmConfig'

const config: LlmConfig = {
  modelName: 'test-model',
  endpoint: 'https://example.test/chat',
  apiKey: 'test-key',
  requestMode: 'direct',
  enableThinking: true,
  autoRepair: true,
}

const createLocalStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('persisted LLM connection status', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: createLocalStorage() })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restores a successful connection only for the tested configuration', () => {
    expect(hasPersistedLlmConnection(config)).toBe(false)

    saveLlmConnection(config)
    expect(hasPersistedLlmConnection(config)).toBe(true)
    expect(hasPersistedLlmConnection({ ...config, modelName: 'another-model' })).toBe(false)
    expect(hasPersistedLlmConnection({ ...config, enableThinking: false })).toBe(false)
  })

  it('normalizes surrounding whitespace and supports explicit invalidation', () => {
    saveLlmConnection(config)
    expect(hasPersistedLlmConnection({
      ...config,
      modelName: ` ${config.modelName} `,
      endpoint: ` ${config.endpoint} `,
      apiKey: ` ${config.apiKey} `,
    })).toBe(true)

    clearLlmConnection()
    expect(hasPersistedLlmConnection(config)).toBe(false)
  })
})
