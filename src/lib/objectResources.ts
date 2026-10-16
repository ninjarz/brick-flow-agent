import { BufferGeometry, Material, Object3D, Texture } from 'three'

const disposedRoots = new WeakSet<Object3D>()
/** Call only for model trees whose geometry, materials and textures are owned here. */
export const disposeOwnedObjectResources = (root: Object3D) => {
  if (disposedRoots.has(root)) return
  disposedRoots.add(root)
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    const renderable = object as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] }
    if (renderable.geometry) geometries.add(renderable.geometry)
    for (const material of Array.isArray(renderable.material) ? renderable.material : renderable.material ? [renderable.material] : []) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  for (const texture of textures) texture.dispose()
  root.removeFromParent()
  root.clear()
}
