import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Box3, PerspectiveCamera, Vector3 } from 'three'
import type { OrbitControls } from 'three-stdlib'
import { getManualCameraMove } from '../../lib/manualCamera'

export const ManualCameraFollow = ({ bounds, stepKey, frameKey }: { bounds: Box3; stepKey?: string; frameKey: string }) => {
  const { camera, controls, invalidate } = useThree()
  const orbit = controls as OrbitControls | undefined
  const interacting = useRef(false)
  const previousFrame = useRef<string>()
  const movement = useRef<{ start: number; from: Vector3; fromTarget: Vector3; to: Vector3; toTarget: Vector3 }>()
  useEffect(() => {
    const stop = () => { movement.current = undefined; interacting.current = true }
    const end = () => { interacting.current = false }
    orbit?.addEventListener('start', stop)
    orbit?.addEventListener('end', end)
    return () => { orbit?.removeEventListener('start', stop); orbit?.removeEventListener('end', end) }
  }, [orbit])
  useEffect(() => {
    movement.current = undefined
    if (previousFrame.current !== frameKey) { previousFrame.current = frameKey; return }
    if (interacting.current || !stepKey || !(camera instanceof PerspectiveCamera) || !orbit) return
    const next = getManualCameraMove(camera, orbit.target, bounds)
    if (!next) return
    movement.current = { start: performance.now(), from: camera.position.clone(), fromTarget: orbit.target.clone(), to: next.position, toTarget: next.target }
    camera.far = Math.max(camera.far, camera.position.distanceTo(next.target) * 8, next.position.distanceTo(next.target) * 8)
    camera.updateProjectionMatrix()
    invalidate()
  }, [bounds, camera, frameKey, invalidate, orbit, stepKey])
  useFrame(() => {
    const move = movement.current
    if (!move || !orbit) return
    const progress = Math.min(1, (performance.now() - move.start) / 380)
    const eased = progress * progress * (3 - 2 * progress)
    camera.position.lerpVectors(move.from, move.to, eased)
    orbit.target.lerpVectors(move.fromTarget, move.toTarget, eased)
    orbit.update()
    if (progress === 1) movement.current = undefined
    else invalidate()
  })
  return null
}
