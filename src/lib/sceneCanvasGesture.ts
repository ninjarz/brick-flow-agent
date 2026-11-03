type Point = { pointerId: number; clientX: number; clientY: number; button?: number }

/** Click intent is independent of ray hits and camera drag endpoints. */
export const createSceneCanvasGesture = () => {
  let placement = false
  let current: { id: number; x: number; y: number; dragged: boolean; released: boolean; placement: boolean } | undefined
  const move = (event: Point) => {
    if (current?.id === event.pointerId && !current.released && Math.hypot(event.clientX-current.x,event.clientY-current.y) > 6) current.dragged = true
  }
  const wasClick = () => Boolean(current?.released && !current.dragged)
  return {
    setPlacement: (active: boolean) => {
      placement = active
      if (current && !current.released && current.placement !== active) current.dragged = true
    },
    down: (event: Point) => {
      current = event.button === 0 ? { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false, released: false, placement } : undefined
    },
    move,
    up: (event: Point) => {
      move(event)
      if (current?.id === event.pointerId) current.released = true
    },
    cancel: () => { current = undefined },
    canClearSelection: () => wasClick() && !current?.placement && !placement,
    canConfirmPlacement: () => wasClick() && Boolean(current?.placement && placement),
  }
}
