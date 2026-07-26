import { describe, expect, it } from 'vitest'
import { layoutWorldSpeechBubbles } from './worldSpeechLayout'

const overlaps = (
  left: ReturnType<typeof layoutWorldSpeechBubbles>[number]['rect'],
  right: ReturnType<typeof layoutWorldSpeechBubbles>[number]['rect'],
) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top

describe('world speech bubble layout', () => {
  it('separates several bubbles sharing nearly the same screen anchor', () => {
    const layout = layoutWorldSpeechBubbles([
      { id: 'a', anchorX: 300, anchorY: 260, width: 180, height: 58 },
      { id: 'b', anchorX: 305, anchorY: 263, width: 180, height: 58 },
      { id: 'c', anchorX: 296, anchorY: 258, width: 180, height: 58 },
    ], { width: 640, height: 420 })

    expect(layout).toHaveLength(3)
    for (let left = 0; left < layout.length; left += 1) {
      for (let right = left + 1; right < layout.length; right += 1) {
        expect(overlaps(layout[left].rect, layout[right].rect)).toBe(false)
      }
    }
  })

  it('keeps bubbles inside the viewport and points the tail back toward the speaker', () => {
    const layout = layoutWorldSpeechBubbles([
      { id: 'left', anchorX: 2, anchorY: 30, width: 220, height: 72 },
      { id: 'right', anchorX: 498, anchorY: 35, width: 220, height: 72 },
    ], { width: 500, height: 300 })

    expect(layout.every((item) => (
      item.rect.left >= 0
      && item.rect.right <= 500
      && item.rect.top >= 0
      && item.rect.bottom <= 300
    ))).toBe(true)
    expect(layout.find((item) => item.id === 'left')!.tailOffsetX).toBeLessThan(0)
    expect(layout.find((item) => item.id === 'right')!.tailOffsetX).toBeGreaterThan(0)
    expect(layout.every((item) => item.tailSide === 'top')).toBe(true)
  })

  it('is deterministic regardless of input order', () => {
    const inputs = [
      { id: 'a', anchorX: 200, anchorY: 160, width: 160, height: 50 },
      { id: 'b', anchorX: 205, anchorY: 160, width: 160, height: 50 },
    ]
    expect(layoutWorldSpeechBubbles(inputs, { width: 500, height: 300 }))
      .toEqual(layoutWorldSpeechBubbles([...inputs].reverse(), { width: 500, height: 300 }))
  })

  it('does not exchange avoidance slots when nearby speakers cross vertically', () => {
    const before = layoutWorldSpeechBubbles([
      { id: 'a', anchorX: 200, anchorY: 160, width: 160, height: 50 },
      { id: 'b', anchorX: 202, anchorY: 161, width: 160, height: 50 },
    ], { width: 500, height: 300 })
    const previous = new Map(before.map((item) => [item.id, item]))
    const after = layoutWorldSpeechBubbles([
      { id: 'a', anchorX: 200, anchorY: 162, width: 160, height: 50 },
      { id: 'b', anchorX: 202, anchorY: 159, width: 160, height: 50 },
    ], { width: 500, height: 300 }, previous)

    expect(after.map((item) => item.id)).toEqual(before.map((item) => item.id))
    expect(Math.abs(after[0].offsetY - before[0].offsetY)).toBeLessThan(3)
    expect(Math.abs(after[1].offsetY - before[1].offsetY)).toBeLessThan(3)
  })

  it('does not jump an entire row when overlapping speakers move by sub-pixels', () => {
    const beforeInputs = [
      { id: 'a', anchorX: 300, anchorY: 220.2, width: 180, height: 58 },
      { id: 'b', anchorX: 300.2, anchorY: 220.05, width: 180, height: 58 },
    ]
    const afterInputs = [
      { id: 'a', anchorX: 300, anchorY: 219.82, width: 180, height: 58 },
      { id: 'b', anchorX: 299.85, anchorY: 219.86, width: 180, height: 58 },
    ]
    const before = layoutWorldSpeechBubbles(beforeInputs, { width: 640, height: 420 })
    const previous = new Map(before.map((item) => [item.id, item]))
    const after = layoutWorldSpeechBubbles(afterInputs, { width: 640, height: 420 }, previous)
    const beforeById = new Map(before.map((item, index) => [
      item.id,
      { centerY: beforeInputs[index].anchorY + item.offsetY },
    ]))

    for (let index = 0; index < after.length; index += 1) {
      const previousPosition = beforeById.get(after[index].id)!
      const nextCenterY = afterInputs[index].anchorY + after[index].offsetY
      expect(Math.abs(nextCenterY - previousPosition.centerY)).toBeLessThan(2)
    }
  })
})
