import { useLayoutEffect, useMemo, useRef } from 'react'
import { createSceneCanvasGesture } from '../../lib/sceneCanvasGesture'

export const useSceneCanvasGesture = (placementActive: boolean) => {
  const gesture = useRef<ReturnType<typeof createSceneCanvasGesture>>()
  gesture.current ??= createSceneCanvasGesture()
  const tracker = gesture.current
  useLayoutEffect(() => tracker.setPlacement(placementActive), [placementActive, tracker])
  const handlers = useMemo(() => ({
    onPointerDownCapture: tracker.down,
    onPointerMoveCapture: tracker.move,
    onPointerUpCapture: tracker.up,
    onPointerCancelCapture: tracker.cancel,
  }), [tracker])
  return { handlers, canClearSelection: tracker.canClearSelection, canConfirmPlacement: tracker.canConfirmPlacement }
}
