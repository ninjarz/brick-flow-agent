import { describe, expect, it } from 'vitest'
import { resizeBottomDockHeight } from './bottomDockResize'

const base = {
  initialHeight: 400,
  viewportHeight: 900,
  minimumHeight: 220,
}

describe('resizeBottomDockHeight', () => {
  it('grows upward while the bottom edge stays anchored', () => {
    expect(resizeBottomDockHeight({
      ...base,
      deltaY: -50,
    })).toBe(450)
  })

  it('clamps to the available viewport height', () => {
    expect(resizeBottomDockHeight({
      ...base,
      deltaY: -800,
    })).toBe(876)
  })

  it('does not shrink below the readable minimum', () => {
    expect(resizeBottomDockHeight({
      ...base,
      deltaY: 500,
    })).toBe(220)
  })
})
