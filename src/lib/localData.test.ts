import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearAllLocalAppData } from './localData'

describe('local app data', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('clears only Brick Flow localStorage keys', async () => {
    const values = new Map([
      ['brick-flow-agent:workspace-draft:v1', 'draft'],
      ['brick-flow-agent:llm-config', 'secret'],
      ['another-app:data', 'keep'],
    ])
    const localStorage = {
      get length() { return values.size },
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
    }
    vi.stubGlobal('window', { localStorage })
    vi.stubGlobal('indexedDB', undefined)

    await clearAllLocalAppData()

    expect([...values]).toEqual([['another-app:data', 'keep']])
  })
})
