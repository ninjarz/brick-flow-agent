import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Color, DirectionalLight, Light, Scene, SpotLight, Vector4, WebGLRenderTarget, type Object3D } from 'three'
import { LineMaterial, LineSegments2 } from 'three-stdlib'
import type { PreparedLDrawResources } from '../../lib/prepareLDrawResources'
import { yieldToBrowser } from '../../lib/yieldToBrowser'

export type SceneUploadRequest = {
  resources: PreparedLDrawResources
  canceled: () => boolean
  progress: (fraction: number) => void
  complete: () => void
}

/** Upload to the owning renderer in short slices while its current scene stays visible. */
export const PreparedSceneUpload = ({ request }: { request?: SceneUploadRequest }) => {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    if (!request) return
    let stopped = false
    const upload = async () => {
      const target = new WebGLRenderTarget(1, 1)
      const staging = new Scene()
      staging.environment = scene.environment
      staging.fog = scene.fog
      scene.traverse(object => {
        if (!(object instanceof Light)) return
        const light = object.clone()
        light.matrixAutoUpdate = false
        light.matrix.copy(object.matrixWorld)
        staging.add(light)
        if ((light instanceof DirectionalLight || light instanceof SpotLight)
          && (object instanceof DirectionalLight || object instanceof SpotLight)) {
          light.target.matrixAutoUpdate = false
          light.target.matrix.copy(object.target.matrixWorld)
          staging.add(light.target)
        }
      })
      const { resources } = request
      function* objects(): Generator<{ object: Object3D; dispose?: () => void }> {
        for (const object of resources.bodies.values()) yield { object }
        for (const object of resources.prints.values()) yield { object }
        for (const batch of resources.scene?.lineBatches ?? []) {
          const geometry = resources.lines.get(batch.points)
          if (!geometry) continue
          const material = new LineMaterial({ color: new Color(batch.color).getHex(), linewidth: 1 })
          const object = new LineSegments2(geometry, material)
          if (batch.transform) { object.matrix.copy(batch.transform); object.matrixAutoUpdate = false }
          yield { object, dispose: () => material.dispose() }
        }
      }
      const total = resources.bodies.size + resources.prints.size + resources.lines.size
      let completed = 0
      let sliceStart = performance.now()
      try {
        for (const item of objects()) {
          if (stopped || request.canceled()) { item.dispose?.(); break }
          const previousTarget = gl.getRenderTarget()
          const cubeFace = gl.getActiveCubeFace()
          const mipmapLevel = gl.getActiveMipmapLevel()
          const viewport = gl.getViewport(new Vector4())
          const scissor = gl.getScissor(new Vector4())
          const scissorTest = gl.getScissorTest()
          const culled = item.object.frustumCulled
          try {
            item.object.frustumCulled = false
            staging.add(item.object)
            gl.setRenderTarget(target)
            gl.setScissorTest(false)
            gl.render(staging, camera)
          } finally {
            staging.remove(item.object)
            item.object.frustumCulled = culled
            gl.setRenderTarget(previousTarget, cubeFace, mipmapLevel)
            gl.setViewport(viewport)
            gl.setScissor(scissor)
            gl.setScissorTest(scissorTest)
            item.dispose?.()
          }
          request.progress(++completed / Math.max(1, total))
          if (performance.now() - sliceStart >= 8) { await yieldToBrowser(); sliceStart = performance.now() }
        }
      } catch { /* A restored renderer can upload these resources through its regular draw path. */ }
      finally { target.dispose(); staging.clear(); request.complete() }
    }
    void upload()
    return () => { stopped = true }
  }, [request, gl, scene, camera])
  return null
}
