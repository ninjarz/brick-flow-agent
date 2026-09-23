import { isLlmConfigComplete } from './llmGenerator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmConfig } from '../types/bricks'
import { loadLlmConfig, clearLlmConnection, defaultMaxRepairAttempts, hasPersistedLlmConnection, maxRepairAttemptsCeiling, normalizeMaxRepairAttempts, saveLlmConnection } from './llmConfig'

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
  it.each([123, [], {}, null])('normalizes malformed stored fields: %j', (value) => {
    window.localStorage.setItem('brick-flow-agent:llm-config', JSON.stringify({ modelName: value, endpoint: value, apiKey: value }))
    expect(isLlmConfigComplete(loadLlmConfig())).toBe(false)
  })
})

describe('repair attempt budget', () => {
  it('clamps the repair attempts into the supported range with a sane default', () => {
    expect(normalizeMaxRepairAttempts(undefined)).toBe(defaultMaxRepairAttempts)
    expect(normalizeMaxRepairAttempts(Number.NaN)).toBe(defaultMaxRepairAttempts)
    expect(normalizeMaxRepairAttempts(0)).toBe(1)
    expect(normalizeMaxRepairAttempts(2.6)).toBe(3)
    expect(normalizeMaxRepairAttempts(99)).toBe(maxRepairAttemptsCeiling)
    expect(normalizeMaxRepairAttempts('2')).toBe(2)
  })


})
