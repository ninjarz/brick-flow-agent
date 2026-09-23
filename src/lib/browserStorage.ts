const databaseName = 'brick-flow-agent'
const databaseVersion = 2
const storeName = 'large-values'

export const indexedDbStorageMarker = '__brick_flow_agent_indexeddb__'
export const localStorageComfortLimit = 2_500_000

export const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('INDEXED_DB_UNAVAILABLE'))
    return
  }

  const request = indexedDB.open(databaseName, databaseVersion)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName)
    for (const name of ['projects', 'project-content', 'project-checkpoints', 'project-meta']) {
      if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name)
    }
  }
  request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
  request.onblocked = () => reject(new Error('INDEXED_DB_UPGRADE_BLOCKED'))
  request.onerror = () => reject(request.error ?? new Error('INDEXED_DB_OPEN_FAILED'))
})

export const readLargeStoredValue = async <T>(key: string): Promise<T | undefined> => {
  const database = await openDatabase()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key)
      request.onsuccess = () => resolve(request.result as T | undefined)
      request.onerror = () => reject(request.error ?? new Error('INDEXED_DB_READ_FAILED'))
    })
  } finally {
    database.close()
  }
}

export const writeLargeStoredValue = async (key: string, value: unknown) => {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).put(value, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('INDEXED_DB_WRITE_FAILED'))
      transaction.onabort = () => reject(transaction.error ?? new Error('INDEXED_DB_WRITE_ABORTED'))
    })
  } finally {
    database.close()
  }
}

export const removeLargeStoredValue = async (key: string) => {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).delete(key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('INDEXED_DB_DELETE_FAILED'))
      transaction.onabort = () => reject(transaction.error ?? new Error('INDEXED_DB_DELETE_ABORTED'))
    })
  } finally {
    database.close()
  }
}

export const isIndexedDbStorageMarker = (value: string | null) => value === indexedDbStorageMarker
