/** Cancellation covers response headers, the body and consumers, not just fetch(). */
export const createRequestLifetime = (caller: AbortSignal | undefined, timeoutMs: number) => {
  const controller = new AbortController()
  const abort = () => controller.abort()
  caller?.addEventListener('abort', abort)
  if (caller?.aborted) abort()
  const timeout = setTimeout(abort, timeoutMs)
  return {
    controller,
    dispose: () => { clearTimeout(timeout); caller?.removeEventListener('abort', abort) },
  }
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
