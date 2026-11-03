import { useLayoutEffect, useMemo, useRef } from 'react'
import type { BrickSceneProps } from '../BrickScene'

const keys = [
  'onSelect', 'onSelectConnected', 'onSelectWorldEntity', 'onPlacementPointChange',
  'onConfirmPlacement', 'onCancelPlacement', 'onBeginDragSelected',
  'onNudgeSelected', 'onRotateSelected', 'onDeleteSelected', 'onCameraAzimuthChange',
] as const
type Callbacks = Pick<BrickSceneProps, typeof keys[number]>

/** Keep static meshes memoizable while events always see committed callbacks. */
export const useSceneCallbacks = (callbacks: Callbacks): Callbacks => {
  const latest = useRef(callbacks)
  useLayoutEffect(() => { latest.current = callbacks })
  const delegates = useMemo(() => Object.fromEntries(keys.map(key => [key, (...args: unknown[]) => {
    const callback = latest.current[key] as ((...values: unknown[]) => void) | undefined
    callback?.(...args)
  }])) as Callbacks, [])
  return Object.fromEntries(keys.map(key => [key, callbacks[key] ? delegates[key] : undefined])) as Callbacks
}
