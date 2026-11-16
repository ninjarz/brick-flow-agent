import { afterEach, expect, it, vi } from 'vitest'
import { loadBinaryLDrawVisualChunk } from './ldrawBinaryVisual'
import { encodeLDrawBinary } from './ldrawBinaryFormat'

class FakeWorker {
  static last: FakeWorker
  terminate = vi.fn()
  postMessage = vi.fn()
  onmessage?: (event: { data: { requestId: number; buffer?: ArrayBuffer; error?: string } }) => void
  onerror?: () => void
  constructor() { FakeWorker.last = this }
}
const fallback = () => Promise.resolve({ getLDrawGeneratedVisualTriangles: () => undefined, getLDrawGeneratedPrintLayers: () => undefined })
afterEach(async () => { await vi.runAllTimersAsync(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('loads without a browser through the existing module path', async () => {
  vi.useFakeTimers()
  const legacy = await fallback()
  expect(await loadBinaryLDrawVisualChunk('unused', async () => legacy)).toBe(legacy)
})

it('shares a decoder worker across requests and retires it after the burst', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', {})
  vi.stubGlobal('Worker', FakeWorker)
  const first = loadBinaryLDrawVisualChunk('first.gz', fallback)
  const worker = FakeWorker.last
  const second = loadBinaryLDrawVisualChunk('second.gz', fallback)
  expect(FakeWorker.last).toBe(worker)
  for (const [request] of worker.postMessage.mock.calls) {
    worker.onmessage!({ data: { requestId: request.requestId, buffer: encodeLDrawBinary({ part: [0, 0, 0, 1, 0, 0, 0, 1, 0] }, {}) } })
  }
  expect((await first).getLDrawGeneratedVisualValues!('part')).toHaveLength(9)
  expect((await second).getLDrawGeneratedVisualValues!('part')).toHaveLength(9)
  expect(worker.terminate).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  expect(worker.terminate).toHaveBeenCalledOnce()
})

it('falls back to reviewed modules after worker or decoding failure', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', {})
  vi.stubGlobal('Worker', FakeWorker)
  const legacy = await fallback()
  const pending = loadBinaryLDrawVisualChunk('failed.gz', async () => legacy)
  FakeWorker.last.onerror!()
  expect(await pending).toBe(legacy)
  expect(FakeWorker.last.terminate).toHaveBeenCalledOnce()
})
