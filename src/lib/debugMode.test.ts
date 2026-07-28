import { describe, expect, it } from 'vitest'
import { isDebugModeEnabled } from './debugMode'

describe('isDebugModeEnabled', () => {
  it('enables diagnostics only for explicit debug values', () => {
    expect(isDebugModeEnabled('?debug=true')).toBe(true)
    expect(isDebugModeEnabled('?debug=TRUE')).toBe(true)
    expect(isDebugModeEnabled('?debug=1')).toBe(true)
    expect(isDebugModeEnabled('?debug=false')).toBe(false)
    expect(isDebugModeEnabled('')).toBe(false)
  })
})
