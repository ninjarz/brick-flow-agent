/// <reference lib="webworker" />
import { expandLDrawBinary } from '../lib/ldrawBinaryFormat'

const scope = self as unknown as DedicatedWorkerGlobalScope
scope.onmessage = async ({ data }: MessageEvent<{ requestId: number; url: string }>) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(data.url, { signal: controller.signal })
    if (!response.ok) throw new Error(`LDRAW_BINARY_HTTP_${response.status}`)
    let buffer = await response.arrayBuffer()
    // Some static servers set Content-Encoding and Fetch decompresses the
    // resource already. Other hosts serve the same gzip file as raw bytes.
    const signature = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength))
    if (signature[0] === 0x1f && signature[1] === 0x8b) {
      const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
      buffer = await new Response(stream).arrayBuffer()
    }
    buffer = expandLDrawBinary(buffer)
    scope.postMessage({ requestId: data.requestId, buffer }, [buffer])
  } catch (error) {
    scope.postMessage({ requestId: data.requestId, error: error instanceof Error ? error.message : 'LDRAW_BINARY_LOAD' })
  } finally { clearTimeout(timeout) }
}
export {}
