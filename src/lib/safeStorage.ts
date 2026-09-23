import { areStorageWritesPaused } from './storageCoordinator'

// Preferences must never prevent the editor from opening or accepting edits.
export const safeStorage = {
  getItem(key: string): string | null {
    try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key) } catch { return null }
  },
  setItem(key: string, value: string): boolean {
    if (areStorageWritesPaused()) return false
    try {
      if (typeof window === 'undefined') return false
      window.localStorage.setItem(key, value)
      return true
    } catch { return false }
  },
  removeItem(key: string): boolean {
    if (areStorageWritesPaused()) return false
    try {
      if (typeof window === 'undefined') return false
      window.localStorage.removeItem(key)
      return true
    } catch { return false }
  },
}
