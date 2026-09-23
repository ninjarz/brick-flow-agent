import { pauseAndDrainStorageWrites, resumeStorageWrites } from './storageCoordinator'

const databaseName = 'brick-flow-agent'
const storagePrefix = 'brick-flow-agent:'

export const clearAllLocalAppData = async () => {
  await pauseAndDrainStorageWrites()
  try {
    if (typeof window !== 'undefined') {
      const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(storagePrefix)))
      keys.forEach((key) => window.localStorage.removeItem(key))
    }
  } catch {
    resumeStorageWrites()
    return false
  }

  if (typeof indexedDB === 'undefined') return true
  return new Promise<boolean>((resolve) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve(true)
    request.onerror = () => { resumeStorageWrites(); resolve(false) }
    // Keep writes paused: a blocked deletion may still complete later.
    request.onblocked = () => resolve(false)
  })
}
