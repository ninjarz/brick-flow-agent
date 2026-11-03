import { describe, expect, it } from 'vitest'
import { createSceneCanvasGesture } from './sceneCanvasGesture'
const point = (x=10,y=10) => ({ pointerId: 1, clientX:x, clientY:y, button:0 })

describe('canvas background click intent', () => {
  it('clears on a left click with small pointer jitter', () => {
    const gesture=createSceneCanvasGesture();gesture.down(point());gesture.up(point(14,13))
    expect(gesture.canClearSelection()).toBe(true)
    expect(gesture.canConfirmPlacement()).toBe(false)
  })
  it('preserves selection after a drag, including a drag returning to its start', () => {
    const gesture=createSceneCanvasGesture();gesture.down(point());gesture.move(point(30));gesture.up(point())
    expect(gesture.canClearSelection()).toBe(false)
  })
  it('ignores right clicks and canceled pointers', () => {
    const gesture=createSceneCanvasGesture();gesture.down({...point(),button:2});gesture.up(point())
    expect(gesture.canClearSelection()).toBe(false)
    gesture.down(point());gesture.cancel();gesture.up(point())
    expect(gesture.canClearSelection()).toBe(false)
  })
  it('does not confirm or deselect on the release that began a long-press placement', () => {
    const gesture=createSceneCanvasGesture();gesture.down(point());gesture.setPlacement(true);gesture.up(point())
    expect(gesture.canConfirmPlacement()).toBe(false)
    gesture.setPlacement(false)
    expect(gesture.canClearSelection()).toBe(false)
  })
  it('confirms placement only on a new click started in placement mode', () => {
    const gesture=createSceneCanvasGesture();gesture.setPlacement(true);gesture.down(point());gesture.up(point())
    expect(gesture.canConfirmPlacement()).toBe(true)
    expect(gesture.canClearSelection()).toBe(false)
  })
})
