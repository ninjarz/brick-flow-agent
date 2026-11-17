import { Box3, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three'

/** Change orbit depth along the existing sight line, preserving the entire view. */
export const getLocalOrbitTarget = (
  camera: PerspectiveCamera,
  pointer: Vector2,
  bounds: readonly Box3[],
): Vector3 | undefined => {
  camera.updateMatrixWorld()
  const raycaster = new Raycaster()
  raycaster.setFromCamera(pointer, camera)
  const hit = new Vector3()
  let nearest = Infinity
  for (const box of bounds) {
    if (!raycaster.ray.intersectBox(box, hit)) continue
    const distance = camera.position.distanceToSquared(hit)
    if (distance < nearest) nearest = distance
  }
  if (!Number.isFinite(nearest)) return
  const point = raycaster.ray.at(Math.sqrt(nearest), hit)
  const forward = camera.getWorldDirection(new Vector3())
  const depth = point.sub(camera.position).dot(forward)
  if (depth <= camera.near * 2) return
  return camera.position.clone().addScaledVector(forward, depth)
}
