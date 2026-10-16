import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, LineSegments, Mesh, MeshStandardMaterial, Texture } from 'three'
import { disposeOwnedObjectResources } from './objectResources'

describe('owned model resources', () => {
  it('releases shared resources once, including canceled models that never mounted', () => {
    const root = new Group()
    const geometry = new BoxGeometry()
    const texture = new Texture()
    const material = new MeshStandardMaterial({ map: texture })
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const materialDispose = vi.spyOn(material, 'dispose')
    const textureDispose = vi.spyOn(texture, 'dispose')
    root.add(new Mesh(geometry, material), new Mesh(geometry, [material]), new LineSegments(geometry, material))
    disposeOwnedObjectResources(root)
    disposeOwnedObjectResources(root)
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(textureDispose).toHaveBeenCalledTimes(1)
    expect(root.children).toHaveLength(0)
  })
})
