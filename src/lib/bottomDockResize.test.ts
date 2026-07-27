import { describe, expect, it } from 'vitest'
import { resizeBottomDockHeight, resizeBottomDockWidth } from './bottomDockResize'

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

describe('resizeBottomDockWidth', () => {
  const widthBase = {
    initialWidth: 760,
    viewportWidth: 1200,
    minimumWidth: 420,
  }

  it('expands symmetrically when the right edge moves outward', () => {
    expect(resizeBottomDockWidth({
      ...widthBase,
      side: 'right',
      deltaX: 50,
    })).toBe(860)
  })

  it('expands symmetrically when the left edge moves outward', () => {
    expect(resizeBottomDockWidth({
      ...widthBase,
      side: 'left',
      deltaX: -50,
    })).toBe(860)
  })

  it('clamps to the viewport and readable minimum', () => {
    expect(resizeBottomDockWidth({
      ...widthBase,
      side: 'right',
      deltaX: 400,
    })).toBe(1176)
    expect(resizeBottomDockWidth({
      ...widthBase,
      side: 'right',
      deltaX: -400,
    })).toBe(420)
  })
})
