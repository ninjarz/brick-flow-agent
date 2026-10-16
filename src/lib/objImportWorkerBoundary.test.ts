import { afterEach, describe, expect, it, vi } from 'vitest'
import { maxObjFileBytes } from './objImportFiles'

afterEach(() => vi.unstubAllGlobals())
describe('OBJ worker input boundary', () => {
  it('rejects an oversized File before attempting to read its contents', async () => {
    const scope = { postMessage: vi.fn(), onmessage: undefined as undefined | ((event: MessageEvent) => Promise<void>) }
    vi.stubGlobal('self', scope)
    const text = vi.fn(async () => 'v 0 0 0')
    await import('../workers/objImportWorker')
    await scope.onmessage!({ data: { type: 'import', file: { name: 'too-large.obj', size: maxObjFileBytes + 1, text }, options: {} } } as MessageEvent)
    expect(text).not.toHaveBeenCalled()
    expect(scope.postMessage).toHaveBeenCalledWith({ type: 'error', code: 'OBJ_FILE_SIZE' })
  })
})
