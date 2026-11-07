import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManualHtmlBlob, type ManualExportResponse } from './manualExportClient'
import { formatBuildManualHtml, serializeBuildManual } from './manualSerializer'
import { makeBrick } from './planUtils'

const manual = serializeBuildManual({ id: 'test', title: 'Manual', prompt: '', source: 'template-local', bricks: [makeBrick('brick-1x1', 'gray', 0, 0, 0)], steps: [] })
class FakeWorker {
  static last: FakeWorker
  terminate = vi.fn()
  postMessage = vi.fn()
  onmessage?: (event: { data: ManualExportResponse }) => void
  onerror?: () => void
  constructor() { FakeWorker.last = this }
}
afterEach(() => vi.unstubAllGlobals())

describe('manual HTML export', () => {
  it('keeps small manual output identical', async () => {
    const blob = await createManualHtmlBlob(manual, 'zh-CN')
    expect(await blob.text()).toBe(formatBuildManualHtml(manual, 'zh-CN'))
  })
  it('builds large manuals in a worker and releases it after completion', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const large = { ...manual, totalPieces: 501 }
    const pending = createManualHtmlBlob(large, 'en-US')
    const worker = FakeWorker.last
    expect(worker.postMessage).toHaveBeenCalledWith({ manual: large, locale: 'en-US' })
    const blob = new Blob(['export'], { type: 'text/html' })
    worker.onmessage!({ data: { blob } })
    expect(await pending).toBe(blob)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it('releases failed workers and reports failure', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const pending = createManualHtmlBlob({ ...manual, totalPieces: 501 }, 'en-US')
    FakeWorker.last.onerror!()
    await expect(pending).rejects.toThrow('MANUAL_EXPORT_FAILED')
    expect(FakeWorker.last.terminate).toHaveBeenCalledOnce()
  })
})
