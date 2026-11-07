import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls } from 'three-stdlib'
import { getCameraNavigationDelta } from '../../lib/cameraNavigation'

export const CameraKeyboardNavigation = ({ enabled }: { enabled: boolean }) => {
  const { camera, controls, gl, invalidate } = useThree()
  const orbit = controls as OrbitControls | undefined
  const held = useRef(new Set<string>())
  const lastPanTime = useRef(0)
  useEffect(() => {
    held.current.clear()
    if (!enabled || !orbit) return
    const keys = held.current
    const canNavigate = () => {
      const target = document.activeElement as HTMLElement | null
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return false
      const modal = Array.from(document.querySelectorAll('[aria-modal="true"]')).at(-1)
      return !modal || modal.contains(gl.domElement)
    }
    const keyOf = (event: KeyboardEvent) => /^Key[WASD]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase()
    const clear = () => {
      const wasActive = keys.size > 0
      keys.clear()
      if (wasActive) orbit.dispatchEvent({ type: 'end', target: orbit })
    }
    const down = (event: KeyboardEvent) => {
      const key = keyOf(event)
      if (!['w', 'a', 's', 'd'].includes(key) || event.ctrlKey || event.metaKey || event.altKey || !canNavigate()) return
      event.preventDefault()
      if (keys.has(key)) return
      const first = keys.size === 0
      keys.add(key)
      if (first) { lastPanTime.current = performance.now(); orbit.dispatchEvent({ type: 'start', target: orbit }) }
      // A quick tap still moves even if keyup arrives before the next frame.
      const delta = getCameraNavigationDelta(camera, orbit.target, keys, first ? .025 : 0)
      camera.position.add(delta); orbit.target.add(delta); orbit.update(); invalidate()
    }
    const up = (event: KeyboardEvent) => { if (keys.delete(keyOf(event)) && !keys.size) orbit.dispatchEvent({ type: 'end', target: orbit }) }
    const visibility = () => { if (document.hidden) clear() }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    window.addEventListener('blur', clear); window.addEventListener('pointerdown', clear)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      clear(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear); window.removeEventListener('pointerdown', clear)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [enabled, orbit, camera, gl, invalidate])
  useFrame(() => {
    if (!enabled || !orbit || !held.current.size) return
    const active = document.activeElement as HTMLElement | null
    const modal = Array.from(document.querySelectorAll('[aria-modal="true"]')).at(-1)
    if (active?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName ?? '') || (modal && !modal.contains(gl.domElement))) { held.current.clear(); orbit.dispatchEvent({ type: 'end', target: orbit }); return }
    const now = performance.now()
    const elapsed = Math.min((now - lastPanTime.current) / 1000, .05)
    lastPanTime.current = now
    const movement = getCameraNavigationDelta(camera, orbit.target, held.current, elapsed)
    camera.position.add(movement); orbit.target.add(movement); orbit.update(); invalidate()
  })
  return null
}
