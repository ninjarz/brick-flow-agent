import { useEffect, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import type { BrickSelectionOptions } from '../BrickScene'

const dragLongPressDelayMs = 420

export const useBrickInteractionHandlers = ({
  resolveBrickId,
  canBeginDrag,
  placementActive,
  onSelect,
  onSelectConnected,
  onBeginDragSelected,
  onConfirmPlacement,
  onCancelPlacement,
}: {
  resolveBrickId: (event: ThreeEvent<MouseEvent>) => string | undefined
  canBeginDrag: (id: string) => boolean
  placementActive: boolean
  onSelect: (id: string, options?: BrickSelectionOptions) => void
  onSelectConnected?: (id: string) => void
  onBeginDragSelected?: (id: string, point: { x: number; z: number }) => void
  onConfirmPlacement?: () => void
  onCancelPlacement?: () => void
}) => {
  const longPressTimerRef = useRef<number>()
  const pointerDownRef = useRef<{ x: number; y: number }>()
  const isPointerDownRef = useRef(false)
  const releaseListenerCleanupRef = useRef<() => void>()
  const suppressNextClickRef = useRef(false)

  const clearLongPress = () => {
    if (longPressTimerRef.current !== undefined) window.clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = undefined
    pointerDownRef.current = undefined
    isPointerDownRef.current = false
    releaseListenerCleanupRef.current?.()
    releaseListenerCleanupRef.current = undefined
  }

  useEffect(() => () => clearLongPress(), [])

  useEffect(() => {
    if (!placementActive) suppressNextClickRef.current = false
  }, [placementActive])

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (placementActive || event.button !== 0) return
    const brickId = resolveBrickId(event as unknown as ThreeEvent<MouseEvent>)
    if (!brickId || !canBeginDrag(brickId) || !onBeginDragSelected) return
    // A press on an already-selected brick belongs to the placement gesture.
    // Keep OrbitControls from consuming the same pointer-down before the
    // long-press timer switches placement mode on.
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
    clearLongPress()
    const point = { x: event.point.x, z: event.point.z }
    pointerDownRef.current = { x: event.clientX, y: event.clientY }
    isPointerDownRef.current = true
    const handleGlobalRelease = () => clearLongPress()
    const handleGlobalMove = (move: PointerEvent) => {
      const start = pointerDownRef.current
      if (start && Math.hypot(move.clientX - start.x, move.clientY - start.y) > 6) clearLongPress()
    }
    window.addEventListener('pointermove', handleGlobalMove, true)
    window.addEventListener('pointerup', handleGlobalRelease, true)
    window.addEventListener('pointercancel', handleGlobalRelease, true)
    window.addEventListener('blur', handleGlobalRelease)
    releaseListenerCleanupRef.current = () => {
      window.removeEventListener('pointermove', handleGlobalMove, true)
      window.removeEventListener('pointerup', handleGlobalRelease, true)
      window.removeEventListener('pointercancel', handleGlobalRelease, true)
      window.removeEventListener('blur', handleGlobalRelease)
    }
    longPressTimerRef.current = window.setTimeout(() => {
      if (!isPointerDownRef.current) {
        clearLongPress()
        return
      }
      suppressNextClickRef.current = true
      longPressTimerRef.current = undefined
      onBeginDragSelected(brickId, point)
    }, dragLongPressDelayMs)
  }

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    clearLongPress()
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }
    if (placementActive) {
      onConfirmPlacement?.()
      return
    }
    const brickId = resolveBrickId(event)
    const toggleSelection = event.metaKey || event.ctrlKey || event.nativeEvent.metaKey || event.nativeEvent.ctrlKey
    if (brickId) onSelect(brickId, { toggle: toggleSelection })
  }
  const onDoubleClick = (event: ThreeEvent<MouseEvent>) => {
    if (placementActive) return
    const brickId = resolveBrickId(event)
    if (!brickId) return
    event.stopPropagation()
    onSelectConnected?.(brickId)
  }
  const onContextMenu = (event: ThreeEvent<MouseEvent>) => {
    if (!placementActive) return
    event.stopPropagation()
    event.nativeEvent.preventDefault()
    onCancelPlacement?.()
  }

  return { onPointerDown, onClick, onDoubleClick, onContextMenu }
}
