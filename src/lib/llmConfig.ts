import type { LlmConfig } from '../types/bricks'

const storageKey = 'brick-flow-agent:llm-config'
const connectionStorageKey = 'brick-flow-agent:llm-connection:v1'

export const defaultMaxRepairAttempts = 2
export const maxRepairAttemptsCeiling = 4

export const normalizeMaxRepairAttempts = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return defaultMaxRepairAttempts
  return Math.max(1, Math.min(maxRepairAttemptsCeiling, Math.round(parsed)))
}

export const defaultLlmConfig: LlmConfig = {
  modelName: '',
  endpoint: '',
  apiKey: '',
  requestMode: 'direct',
  enableThinking: false,
  autoRepair: true,
  maxRepairAttempts: defaultMaxRepairAttempts,
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
      autoRepair: parsed.autoRepair !== false,
      maxRepairAttempts: normalizeMaxRepairAttempts(parsed.maxRepairAttempts),
    }
  } catch {
    return defaultLlmConfig
  }
}

export const saveLlmConfig = (config: LlmConfig) => {
  window.localStorage.setItem(storageKey, JSON.stringify(config))
}

const createLlmConfigFingerprint = (config: LlmConfig) => {
  const serialized = JSON.stringify({
    modelName: config.modelName.trim(),
    endpoint: config.endpoint.trim(),
    apiKey: config.apiKey.trim(),
    requestMode: config.requestMode,
    enableThinking: config.enableThinking,
    autoRepair: config.autoRepair,
  })
  let hash = 2_166_136_261
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `${serialized.length}:${(hash >>> 0).toString(36)}`
}

export const hasPersistedLlmConnection = (config: LlmConfig) => {
  if (typeof window === 'undefined') return false
  try {
    const stored = JSON.parse(window.localStorage.getItem(connectionStorageKey) ?? '') as {
      configFingerprint?: string
    }
    return stored.configFingerprint === createLlmConfigFingerprint(config)
  } catch {
    return false
  }
}

export const saveLlmConnection = (config: LlmConfig) => {
  window.localStorage.setItem(connectionStorageKey, JSON.stringify({
    configFingerprint: createLlmConfigFingerprint(config),
    testedAt: new Date().toISOString(),
  }))
}

export const clearLlmConnection = () => {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(connectionStorageKey)
}
