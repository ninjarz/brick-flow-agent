import { AmbientLight, Box3, DirectionalLight, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { createWorldEntityVisual, loadMinifigureMoulds } from './worldEntityVisual'

let renderer: WebGLRenderer | undefined
const previews = new Map<string, Promise<string>>()

export const getWorldEntityPreview = (definitionId: string) => {
  const cached = previews.get(definitionId)
  if (cached) return cached
  const ready = definitionId === 'catapult' ? Promise.resolve() : loadMinifigureMoulds()
  const pending = ready.then(() => {
    renderer ??= new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.setSize(160, 180, false)
    renderer.setClearColor(0xffffff, 0)
    const scene = new Scene()
    const model = createWorldEntityVisual(definitionId)
    scene.add(model, new AmbientLight(0xffffff, 2))
    const light = new DirectionalLight(0xffffff, 3)
    light.position.set(4, 8, 6)
    scene.add(light)
    const bounds = new Box3().setFromObject(model)
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const extent = Math.max(size.y, size.x * 1.125, size.z) * .65
    const camera = new OrthographicCamera(-extent / 1.125, extent / 1.125, extent, -extent, .1, 100)
    camera.position.copy(center).add(new Vector3(7, 4, 11))
    camera.lookAt(center)
    renderer.render(scene, camera)
    return renderer.domElement.toDataURL('image/png')
  }).catch(error => { previews.delete(definitionId); throw error })
  previews.set(definitionId, pending)
  return pending
}
