import { gzipSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { decodeLDrawBinary, encodeLDrawBinary, packLDrawBinary } from '../lib/ldrawBinaryFormat'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it.each([[false, false], [true, false], [false, true], [true, true]])('handles HTTP decompression and dictionary resources, compressed=%s packed=%s', async (compressed, packed) => {
  const coordinates = Array.from({ length: 90 }, (_, i) => [0, -0, Number('1.2345678912345678')][i % 3])
  const raw = encodeLDrawBinary({ part: coordinates }, {})
  const binary = packed ? packLDrawBinary(raw) : raw
  const bytes = compressed ? new Uint8Array(gzipSync(new Uint8Array(binary))) : new Uint8Array(binary)
  const scope = { postMessage: vi.fn(), onmessage: undefined as ((event: { data: { requestId: number; url: string } }) => Promise<void>) | undefined }
  vi.stubGlobal('self', scope)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes)))
  await import('./ldrawBinaryWorker')
  await scope.onmessage!({ data: { requestId: 1, url: 'https://example.test/geometry.gz' } })
  const result = scope.postMessage.mock.calls[0][0]
  expect(result.requestId).toBe(1)
  expect(Array.from(decodeLDrawBinary(result.buffer).getLDrawGeneratedVisualValues!('part')!)).toEqual(coordinates)
  expect(scope.postMessage.mock.calls[0][1]).toEqual([result.buffer])
})

it('returns an HTTP error so the caller can use the legacy module', async () => {
  const scope = { postMessage: vi.fn(), onmessage: undefined as ((event: { data: { requestId: number; url: string } }) => Promise<void>) | undefined }
  vi.stubGlobal('self', scope)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
  await import('./ldrawBinaryWorker')
  await scope.onmessage!({ data: { requestId: 2, url: 'https://example.test/missing.gz' } })
  expect(scope.postMessage).toHaveBeenCalledWith({ requestId: 2, error: 'LDRAW_BINARY_HTTP_404' })
})
