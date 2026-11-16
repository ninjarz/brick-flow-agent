/// <reference lib="dom" />
import type { LDrawGeneratedVisualChunk } from './ldrawGeneratedVisual'
import { decodeLDrawBinary } from './ldrawBinaryFormat'

let worker: Worker | undefined
let nextRequest = 0
let retirement: ReturnType<typeof setTimeout> | undefined
const pending = new Map<number, { resolve: (buffer: ArrayBuffer) => void; reject: (error: Error) => void }>()

const release = () => {
  worker?.terminate()
  worker = undefined
  for (const request of pending.values()) request.reject(new Error('LDRAW_BINARY_WORKER_FAILED'))
  pending.clear()
}
const loadBuffer = (url: string) => new Promise<ArrayBuffer>((resolve, reject) => {
  clearTimeout(retirement)
  if (!worker) {
    worker = new Worker(new URL('../workers/ldrawBinaryWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<{ requestId: number; buffer?: ArrayBuffer; error?: string }>) => {
      const request = pending.get(data.requestId)
      if (!request) return
      pending.delete(data.requestId)
      if (data.buffer) request.resolve(data.buffer)
      else request.reject(new Error(data.error ?? 'LDRAW_BINARY_LOAD'))
      if (!pending.size) retirement = setTimeout(release, 1000)
    }
    worker.onerror = worker.onmessageerror = release
  }
  const requestId = ++nextRequest
  pending.set(requestId, { resolve, reject })
  try { worker.postMessage({ requestId, url }) } catch (error) {
    pending.delete(requestId)
    reject(error)
    if (!pending.size) release()
  }
})

/** Legacy modules keep Node tools and browsers without decompression support working. */
export const loadBinaryLDrawVisualChunk = async (url: string, fallback: () => Promise<LDrawGeneratedVisualChunk>): Promise<LDrawGeneratedVisualChunk> => {
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || typeof DecompressionStream === 'undefined') return fallback()
  try { return decodeLDrawBinary(await loadBuffer(url)) } catch { return fallback() }
}
