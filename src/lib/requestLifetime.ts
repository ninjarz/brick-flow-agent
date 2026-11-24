/**
 * Cancellation covers response headers, the body and consumers, not just fetch().
 *
 * timeoutMs is an idle limit: call touch() whenever data arrives to restart
 * it, so a long but steady stream is not cut off. Without touch() it behaves
 * as a total limit. maxTotalMs caps the whole request regardless of activity.
 */
export const createRequestLifetime = (caller: AbortSignal | undefined, timeoutMs: number, maxTotalMs = Infinity) => {
  const controller = new AbortController()
  const abort = () => controller.abort()
  caller?.addEventListener('abort', abort)
  if (caller?.aborted) abort()
  let idle = setTimeout(abort, timeoutMs)
  const total = Number.isFinite(maxTotalMs) ? setTimeout(abort, maxTotalMs) : undefined
  let disposed = false
  return {
    controller,
    touch: () => {
      if (disposed || controller.signal.aborted) return
      clearTimeout(idle)
      idle = setTimeout(abort, timeoutMs)
    },
    dispose: () => {
      disposed = true
      clearTimeout(idle)
      clearTimeout(total)
      caller?.removeEventListener('abort', abort)
    },
  }
}

/** Calls touch() when the headers arrive and for every body chunk, keeping an idle lifetime alive. */
export const trackResponseActivity = (response: Response, touch: () => void) => {
  touch()
  if (!response.body || typeof TransformStream === 'undefined') return response
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, stream) {
      touch()
      stream.enqueue(chunk)
    },
  }))
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}

export const withAbortSignal = <T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> => {
  if (signal.aborted) return Promise.reject(new DOMException('Request canceled', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Request canceled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation() }).then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}
