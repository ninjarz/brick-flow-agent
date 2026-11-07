import { OrthographicCamera, PerspectiveCamera, Vector3, type Camera } from 'three'

/** World-space size of the current view at the orbit target, including zoom. */
export const getCameraViewHeight = (camera: Camera, target: Vector3) => {
  if (camera instanceof OrthographicCamera) return Math.abs(camera.top - camera.bottom) / camera.zoom
  if (camera instanceof PerspectiveCamera) return 2 * camera.position.distanceTo(target) * Math.tan(camera.getEffectiveFOV() * Math.PI / 360)
  return 0
}

export const getCameraNavigationDelta = (camera: Camera, target: Vector3, keys: ReadonlySet<string>, seconds: number) => {
  const forward = camera.getWorldDirection(new Vector3()); forward.y = 0
  if (forward.lengthSq() < 1e-10) forward.set(0, 1, 0).applyQuaternion(camera.quaternion).setY(0)
  forward.normalize()
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize()
  const direction = new Vector3().addScaledVector(forward, Number(keys.has('w')) - Number(keys.has('s')))
    .addScaledVector(right, Number(keys.has('d')) - Number(keys.has('a')))
  return direction.normalize().multiplyScalar(getCameraViewHeight(camera, target) * .65 * seconds)
}
