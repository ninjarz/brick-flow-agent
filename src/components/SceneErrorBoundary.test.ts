import { describe, expect, it } from 'vitest'
import { SceneErrorBoundary } from './SceneErrorBoundary'

describe('SceneErrorBoundary', () => {
  it('captures render errors and resets when resetKey changes', () => {
    const error = new Error('WebGL context lost')
    const errored = {
      lastResetKey: 'plan-a',
      ...SceneErrorBoundary.getDerivedStateFromError(error),
    }
    expect(errored.error).toBe(error)

    expect(
      SceneErrorBoundary.getDerivedStateFromProps(
        { children: null, locale: 'en-US', resetKey: 'plan-a' },
        errored,
      ),
    ).toBeNull()

    const reset = SceneErrorBoundary.getDerivedStateFromProps(
      { children: null, locale: 'en-US', resetKey: 'plan-b' },
      errored,
    )
    expect(reset).toEqual({ error: undefined, lastResetKey: 'plan-b' })
  })
})
