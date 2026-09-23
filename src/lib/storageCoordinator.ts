// A deletion barrier prevents autosave from resurrecting data while clearing.
let writesPaused = false
const activeWrites = new Set<Promise<boolean>>()

export const areStorageWritesPaused = () => writesPaused

export const coordinateStorageWrite = (persist: () => Promise<boolean>) => {
  if (writesPaused) return Promise.resolve(false)
  const operation = persist().catch(() => false)
  activeWrites.add(operation)
  void operation.finally(() => activeWrites.delete(operation))
  return operation
}

export const pauseAndDrainStorageWrites = async () => {
  writesPaused = true
  await Promise.allSettled([...activeWrites])
}

export const resumeStorageWrites = () => { writesPaused = false }
