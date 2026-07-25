import { describe, expect, it } from 'vitest'
import { getSceneCameraFrameRequestKey } from './sceneCamera'

describe('scene camera framing', () => {
  it('keeps an explicit editing-session frame key stable when bricks change', () => {
    const frameKey = 'plan-1:asset-import-0'

    expect(getSceneCameraFrameRequestKey(frameKey, ['a', 'b', 'c'])).toBe(frameKey)
    expect(getSceneCameraFrameRequestKey(frameKey, ['a'])).toBe(frameKey)
    expect(getSceneCameraFrameRequestKey(frameKey, ['a', 'new-part'])).toBe(frameKey)
  })

  it('tracks brick membership only when a caller has not supplied framing intent', () => {
    expect(getSceneCameraFrameRequestKey(undefined, ['a', 'b'])).toBe('a|b')
    expect(getSceneCameraFrameRequestKey(undefined, ['a'])).toBe('a')
  })
})
