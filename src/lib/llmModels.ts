import { modelListEndpoint } from './llmEndpoint'
import type { LlmConfig } from '../types/bricks'
import { createRequestLifetime, withAbortSignal } from './requestLifetime'

export { modelListEndpoint } from './llmEndpoint'

export const listLlmModels = async (config: Pick<LlmConfig, 'endpoint' | 'apiKey' | 'requestMode'>, signal?: AbortSignal): Promise<string[]> => {
  const endpoint = modelListEndpoint(config.endpoint)
  const { controller, dispose } = createRequestLifetime(signal, 15_000)
  try {
    const response = await fetch(config.requestMode === 'proxy' ? '/api/llm/chat' : endpoint, config.requestMode === 'proxy' ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ endpoint, apiKey: config.apiKey.trim(), operation: 'models' }),
    } : {
      headers: { Authorization: `Bearer ${config.apiKey.trim()}` }, signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Model list HTTP ${response.status}`)
    const result: unknown = await withAbortSignal(controller.signal, () => response.json())
    if (!result || typeof result !== 'object' || !('data' in result) || !Array.isArray(result.data)) throw new Error('Invalid model list')
    const models = result.data.flatMap(item => typeof item?.id === 'string' && item.id.trim() ? [item.id.trim()] : [])
    return [...new Set<string>(models)].sort((a, b) => a.localeCompare(b))
  } finally {
    dispose()
  }
}
