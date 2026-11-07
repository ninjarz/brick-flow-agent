import { Box3, PerspectiveCamera, Vector3 } from 'three'

/** Keep the current orientation; only pan (and, for oversized steps, dolly out). */
export const getManualCameraMove = (camera: PerspectiveCamera, target: Vector3, bounds: Box3) => {
  if (bounds.isEmpty()) return
  camera.updateMatrixWorld()
  const corners: Vector3[] = []
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) corners.push(new Vector3(x, y, z))
  if (corners.every(point => {
    const ndc = point.clone().project(camera)
    return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z >= -1 && ndc.z <= 1
  })) return
  const center = bounds.getCenter(new Vector3())
  const forward = camera.getWorldDirection(new Vector3())
  const centerView = center.clone().applyMatrix4(camera.matrixWorldInverse)
  const tanY = Math.tan(camera.getEffectiveFOV() * Math.PI / 360) * .86
  const tanX = tanY * camera.aspect
  let distance = Math.max(camera.position.distanceTo(target), camera.near * 2)
  for (const point of corners) {
    const local = point.clone().applyMatrix4(camera.matrixWorldInverse).sub(centerView)
    distance = Math.max(distance, Math.abs(local.x) / tanX + local.z, Math.abs(local.y) / tanY + local.z)
  }
  return { target: center, position: center.clone().addScaledVector(forward, -distance) }
}
