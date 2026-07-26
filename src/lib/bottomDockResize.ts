export type BottomDockResizeInput = {
  initialHeight: number
  deltaY: number
  viewportHeight: number
  minimumHeight: number
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
