import { safeStorage } from './safeStorage'
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

  const stored = safeStorage.getItem(storageKey)
  if (!stored) return defaultLlmConfig

  try {
    const value: unknown = JSON.parse(stored)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultLlmConfig
    const parsed = value as Partial<LlmConfig>
    return {
      modelName: typeof parsed.modelName === 'string' ? parsed.modelName : '',
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
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
  safeStorage.setItem(storageKey, JSON.stringify(config))
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
    const stored = JSON.parse(safeStorage.getItem(connectionStorageKey) ?? '') as {
      configFingerprint?: string
    }
    return stored.configFingerprint === createLlmConfigFingerprint(config)
  } catch {
    return false
  }
}

export const saveLlmConnection = (config: LlmConfig) => {
  safeStorage.setItem(connectionStorageKey, JSON.stringify({
    configFingerprint: createLlmConfigFingerprint(config),
    testedAt: new Date().toISOString(),
  }))
}

export const clearLlmConnection = () => {
  if (typeof window === 'undefined') return
  safeStorage.removeItem(connectionStorageKey)
}
