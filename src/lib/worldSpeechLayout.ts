export type WorldSpeechLayoutInput = {
  id: string
  anchorX: number
  anchorY: number
  width: number
  height: number
}

export type WorldSpeechLayoutItem = {
  id: string
  offsetX: number
  offsetY: number
  tailOffsetX: number
  tailSide: 'top' | 'bottom'
  rect: { left: number; top: number; right: number; bottom: number }
}

type Viewport = { width: number; height: number }
type PreviousLayout = ReadonlyMap<string, Pick<WorldSpeechLayoutItem, 'offsetX' | 'offsetY' | 'tailSide'>>

const viewportMargin = 10
const bubbleGap = 9
const anchorGap = 15
const slotContinuityTolerance = 2
const slotReturnHysteresis = 24
const horizontalSlots = [0, -1, 1, -2, 2]

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

const makeRect = (centerX: number, centerY: number, width: number, height: number) => ({
  left: centerX - width / 2,
  top: centerY - height / 2,
  right: centerX + width / 2,
  bottom: centerY + height / 2,
})

const overlapArea = (
  left: WorldSpeechLayoutItem['rect'],
  right: WorldSpeechLayoutItem['rect'],
) => Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left) + bubbleGap)
  * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) + bubbleGap)

const actualOverlapArea = (
  left: WorldSpeechLayoutItem['rect'],
  right: WorldSpeechLayoutItem['rect'],
) => Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
  * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))

export const layoutWorldSpeechBubbles = (
  inputs: WorldSpeechLayoutInput[],
  viewport: Viewport,
  previousLayout?: PreviousLayout,
): WorldSpeechLayoutItem[] => {
  const placed: WorldSpeechLayoutItem[] = []
  // Keep placement priority stable while characters move. Sorting by screen Y made
  // nearby speakers continuously exchange slots whenever their anchors crossed.
  const orderedInputs = [...inputs].sort((left, right) => left.id.localeCompare(right.id))

  for (const input of orderedInputs) {
    const previous = previousLayout?.get(input.id)
    const width = Math.max(80, Math.min(input.width, Math.max(80, viewport.width - viewportMargin * 2)))
    const height = Math.max(34, Math.min(input.height, Math.max(34, viewport.height - viewportMargin * 2)))
    const halfWidth = width / 2
    const halfHeight = height / 2
    const preferredCenterY = input.anchorY - halfHeight - anchorGap
    const candidates: Array<{
      centerX: number
      centerY: number
      tailSide: 'top' | 'bottom'
      rect: WorldSpeechLayoutItem['rect']
      overlap: number
      actualOverlap: number
      preferenceCost: number
      continuityDistance: number
      score: number
    }> = []
    for (const tailSide of ['bottom', 'top'] as const) {
      for (let tier = 0; tier < Math.max(4, inputs.length); tier += 1) {
        for (const slot of horizontalSlots) {
          const centerX = clamp(
            input.anchorX + slot * (width + bubbleGap),
            viewportMargin + halfWidth,
            viewport.width - viewportMargin - halfWidth,
          )
          const requestedCenterY = tailSide === 'bottom'
            ? preferredCenterY - tier * (height + bubbleGap)
            : input.anchorY + halfHeight + anchorGap + tier * (height + bubbleGap)
          const centerY = clamp(
            requestedCenterY,
            viewportMargin + halfHeight,
            viewport.height - viewportMargin - halfHeight,
          )
          const rect = makeRect(centerX, centerY, width, height)
          const pointsTowardAnchor = tailSide === 'bottom'
            ? rect.bottom <= input.anchorY - 3
            : rect.top >= input.anchorY + 3
          if (!pointsTowardAnchor) continue
          const overlap = placed.reduce((total, item) => total + overlapArea(rect, item.rect), 0)
          const actualOverlap = placed.reduce((total, item) => total + actualOverlapArea(rect, item.rect), 0)
          const distance = Math.abs(centerX - input.anchorX) + Math.abs(centerY - preferredCenterY) * 0.8
          const sidePenalty = tailSide === 'top' ? 80 : 0
          const continuityDistance = previous
            ? Math.abs(centerX - input.anchorX - previous.offsetX)
              + Math.abs(centerY - input.anchorY - previous.offsetY)
              + (tailSide === previous.tailSide ? 0 : 40)
            : Number.POSITIVE_INFINITY
          const preferenceCost = distance + sidePenalty
          candidates.push({
            centerX,
            centerY,
            tailSide,
            rect,
            overlap,
            actualOverlap,
            preferenceCost,
            continuityDistance,
            score: overlap * 1_000 + preferenceCost,
          })
        }
      }
    }
    const sortedCandidates = candidates.sort((left, right) => left.score - right.score)
    const bestCandidate = sortedCandidates[0]
    const previousCandidate = previous
      ? candidates
        .filter((candidate) => candidate.actualOverlap === 0)
        .sort((left, right) => left.continuityDistance - right.continuityDistance)[0]
      : undefined
    const bestClearCandidate = candidates
      .filter((candidate) => candidate.overlap === 0)
      .sort((left, right) => left.preferenceCost - right.preferenceCost)[0]
    // A sub-pixel anchor movement must not force a whole discrete row jump merely
    // because the preferred 9px gap briefly shrank. Keep the current slot while
    // the actual bubble rectangles remain disjoint; return toward the speaker
    // once a clearly better fully-spaced slot becomes available.
    const keepPreviousSlot = previousCandidate
      && previousCandidate.continuityDistance <= slotContinuityTolerance
      && (
        !bestClearCandidate
        || previousCandidate.preferenceCost <= bestClearCandidate.preferenceCost + slotReturnHysteresis
      )
    const selected = (keepPreviousSlot ? previousCandidate : bestCandidate) ?? {
      centerX: clamp(input.anchorX, viewportMargin + halfWidth, viewport.width - viewportMargin - halfWidth),
      centerY: clamp(preferredCenterY, viewportMargin + halfHeight, viewport.height - viewportMargin - halfHeight),
      tailSide: 'bottom' as const,
      rect: makeRect(
        clamp(input.anchorX, viewportMargin + halfWidth, viewport.width - viewportMargin - halfWidth),
        clamp(preferredCenterY, viewportMargin + halfHeight, viewport.height - viewportMargin - halfHeight),
        width,
        height,
      ),
    }
    const tailOffsetX = clamp(
      input.anchorX - selected.centerX,
      -halfWidth + 16,
      halfWidth - 16,
    )
    placed.push({
      id: input.id,
      offsetX: selected.centerX - input.anchorX,
      offsetY: selected.centerY - input.anchorY,
      tailOffsetX,
      tailSide: selected.tailSide,
      rect: selected.rect,
    })
  }

  return placed
}
