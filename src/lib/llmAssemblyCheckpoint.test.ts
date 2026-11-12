import { afterEach, expect, it, vi } from 'vitest'
import { assemblyCheckpointSignature, clearAssemblyCheckpoint, loadAssemblyCheckpoint, saveAssemblyCheckpoint } from './llmAssemblyCheckpoint'
import { defaultLlmConfig } from './llmConfig'

afterEach(() => vi.unstubAllGlobals())

it('stores only assembly programs and clears completed checkpoints', async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('window', { sessionStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } })
  const signature = await assemblyCheckpointSignature({ prompt: 'hall' }, { ...defaultLlmConfig, apiKey: 'test-secret-not-for-storage' })
  const checkpoint = { signature, layout: { title: 'Hall', modules: [{ name: 'Hall', description: 'build', origin: [0, 0, 0] as [number, number, number] }] }, programs: [] }
  saveAssemblyCheckpoint(checkpoint)
  expect(loadAssemblyCheckpoint(signature)).toEqual(checkpoint)
  expect([...storage.values()].join('')).not.toContain('test-secret-not-for-storage')
  expect(loadAssemblyCheckpoint('different-request')).toBeUndefined()
  clearAssemblyCheckpoint('different-request')
  expect(loadAssemblyCheckpoint(signature)).toEqual(checkpoint)
  clearAssemblyCheckpoint(signature)
  expect(loadAssemblyCheckpoint(signature)).toBeUndefined()
})
