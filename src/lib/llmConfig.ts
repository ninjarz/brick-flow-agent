import type { LlmConfig } from '../types/bricks'

const storageKey = 'brick-flow-agent:llm-config'

export const defaultLlmConfig: LlmConfig = {
  modelName: '',
  endpoint: '',
  apiKey: '',
  requestMode: 'direct',
  enableThinking: false,
}

const isLlmRequestMode = (value: unknown): value is LlmConfig['requestMode'] =>
  value === 'direct' || value === 'proxy'

export const loadLlmConfig = (): LlmConfig => {
  if (typeof window === 'undefined') return defaultLlmConfig

  const stored = window.localStorage.getItem(storageKey)
  if (!stored) return defaultLlmConfig

  try {
    const parsed = JSON.parse(stored) as Partial<LlmConfig>
    return {
      modelName: parsed.modelName ?? '',
      endpoint: parsed.endpoint ?? '',
      apiKey: parsed.apiKey ?? '',
      requestMode: isLlmRequestMode(parsed.requestMode) ? parsed.requestMode : defaultLlmConfig.requestMode,
      enableThinking: parsed.enableThinking === true,
    }
  } catch {
    return defaultLlmConfig
  }
}

export const saveLlmConfig = (config: LlmConfig) => {
  window.localStorage.setItem(storageKey, JSON.stringify(config))
}
