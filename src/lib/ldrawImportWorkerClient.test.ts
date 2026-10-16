import { afterEach, describe, expect, it, vi } from 'vitest'
import { importLDrawInWorker, type LDrawWorkerResponse } from './ldrawImportWorkerClient'

class ImportWorker {
  static instances: ImportWorker[] = []
  onmessage?: (event: { data: LDrawWorkerResponse }) => void
  onerror?: () => void
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { ImportWorker.instances.push(this) }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); ImportWorker.instances = [] })
describe('LDraw import worker lifetime', () => {
  it('terminates parsing when the requesting workspace is replaced', async () => {
    vi.stubGlobal('Worker', ImportWorker)
    const controller = new AbortController()
    const pending = importLDrawInWorker('0 test', 'test', controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(ImportWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
  })
  it('terminates a worker that exceeds the total parsing and validation budget', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', ImportWorker)
    const pending = importLDrawInWorker('0 test', 'test', new AbortController().signal)
    const rejected = expect(pending).rejects.toThrow('LDRAW_IMPORT_LIMIT_EXCEEDED')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected
    expect(ImportWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
  })
})
