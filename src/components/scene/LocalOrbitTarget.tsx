import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Box3, PerspectiveCamera, Vector2 } from 'three'
import type { OrbitControls } from 'three-stdlib'
import { getLocalOrbitTarget } from '../../lib/localOrbitTarget'

export const LocalOrbitTarget = ({ bounds, enabled }: { bounds: readonly Box3[]; enabled: boolean }) => {
  const { camera, controls, gl } = useThree()
  const orbit = controls as OrbitControls | undefined
  useEffect(() => {
    if (!enabled || !orbit || !(camera instanceof PerspectiveCamera)) return
    const canvas = gl.domElement
    let press: { id: number; x: number; y: number } | undefined
    const down = (event: PointerEvent) => {
      // Match the existing plain-left orbit gesture. Modified left drags pan.
      if (event.pointerType === 'touch' || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || !orbit.enabled) return
      press = { id: event.pointerId, x: event.clientX, y: event.clientY }
    }
    const move = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.id || Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 6) return
      const start = press
      press = undefined
      if (!orbit.enabled) return
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const pointer = new Vector2((start.x - rect.left) / rect.width * 2 - 1, 1 - (start.y - rect.top) / rect.height * 2)
      const target = getLocalOrbitTarget(camera, pointer, bounds)
      if (target) orbit.target.copy(target)
    }
    const release = () => { press = undefined }
    // Capture before OrbitControls consumes movement. One bounds query per drag.
    canvas.addEventListener('pointerdown', down, true)
    canvas.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', release)
    return () => {
      canvas.removeEventListener('pointerdown', down, true)
      canvas.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', release)
    }
  }, [bounds, camera, enabled, gl, orbit])
  return null
}
