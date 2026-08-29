const databaseName = 'brick-flow-agent'
const storagePrefix = 'brick-flow-agent:'

export const clearAllLocalAppData = async () => {
  if (typeof window !== 'undefined') {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(storagePrefix)))
    keys.forEach((key) => window.localStorage.removeItem(key))
  }

  if (typeof indexedDB === 'undefined') return true
  return new Promise<boolean>((resolve) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve(true)
    request.onerror = () => resolve(false)
    request.onblocked = () => resolve(false)
  })
}
