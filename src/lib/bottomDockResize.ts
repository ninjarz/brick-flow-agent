export type BottomDockResizeInput = {
  initialHeight: number
  deltaY: number
  viewportHeight: number
  minimumHeight: number
  viewportMargin?: number
}

export type BottomDockWidthResizeInput = {
  initialWidth: number
  deltaX: number
  side: 'left' | 'right'
  viewportWidth: number
  minimumWidth: number
  viewportMargin?: number
}

const clamp = (value: number, minimum: number, maximum: number) => (
  Math.max(minimum, Math.min(maximum, value))
)

export const resizeBottomDockHeight = ({
  initialHeight,
  deltaY,
  viewportHeight,
  minimumHeight,
  viewportMargin = 24,
}: BottomDockResizeInput) => {
  const maximumHeight = Math.max(0, viewportHeight - viewportMargin)
  return clamp(initialHeight - deltaY, Math.min(minimumHeight, maximumHeight), maximumHeight)
}

export const resizeBottomDockWidth = ({
  initialWidth,
  deltaX,
  side,
  viewportWidth,
  minimumWidth,
  viewportMargin = 24,
}: BottomDockWidthResizeInput) => {
  const maximumWidth = Math.max(0, viewportWidth - viewportMargin)
  const direction = side === 'left' ? -1 : 1
  const symmetricDelta = deltaX * direction * 2
  return clamp(initialWidth + symmetricDelta, Math.min(minimumWidth, maximumWidth), maximumWidth)
}
