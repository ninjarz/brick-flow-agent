import type { GeneratorInput, LlmConfig } from '../types/bricks'
import { parseAssemblyLayout } from './llmAssembly'

const storageKey = 'brick-flow-agent:assembly-checkpoint:v1'
export type AssemblyCheckpoint = { signature: string; layout: ReturnType<typeof parseAssemblyLayout>; programs: unknown[] }

export const assemblyCheckpointSignature = async (input: GeneratorInput, config: LlmConfig) => {
  const context = JSON.stringify({ protocol: 7, prompt: input.prompt, image: input.imageDataUrl, inventory: input.inventoryOverrides, model: config.modelName, endpoint: config.endpoint })
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(context)))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export const loadAssemblyCheckpoint = (signature: string): AssemblyCheckpoint | undefined => {
  try {
    const raw = window.sessionStorage?.getItem(storageKey)
    if (!raw) return
    const value = JSON.parse(raw)
    if (value.signature !== signature || !Array.isArray(value.programs)) return
    const layout = parseAssemblyLayout(value.layout)
    if (value.programs.length > layout.modules.length) return
    return { signature, layout, programs: value.programs }
  } catch { return }
}

export const saveAssemblyCheckpoint = (checkpoint: AssemblyCheckpoint) => {
  try { window.sessionStorage?.setItem(storageKey, JSON.stringify(checkpoint)) } catch { /* Generation can continue when session storage is unavailable. */ }
}

export const clearAssemblyCheckpoint = (signature: string) => {
  try {
    if (loadAssemblyCheckpoint(signature)) window.sessionStorage?.removeItem(storageKey)
  } catch { /* Storage cleanup does not affect an accepted build. */ }
}
