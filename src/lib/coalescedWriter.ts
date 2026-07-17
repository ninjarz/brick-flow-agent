export type CoalescedAsyncWriter<T> = {
  write: (value: T) => Promise<boolean>
}

export const createCoalescedAsyncWriter = <T>(
  persist: (value: T) => Promise<boolean>,
): CoalescedAsyncWriter<T> => {
  let running = false
  let pending: { value: T; resolve: Array<(result: boolean) => void> } | undefined

  const flush = async () => {
    if (running) return
    running = true
    while (pending) {
      const batch = pending
      pending = undefined
      let result = false
      try {
        result = await persist(batch.value)
      } catch {
        result = false
      }
      batch.resolve.forEach((resolve) => resolve(result))
    }
    running = false
  }

  return {
    write: (value) => new Promise<boolean>((resolve) => {
      if (pending) {
        pending.value = value
        pending.resolve.push(resolve)
      } else {
        pending = { value, resolve: [resolve] }
      }
      void flush()
    }),
  }
}
