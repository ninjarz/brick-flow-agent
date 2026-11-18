import { beforeAll, describe, expect, it } from 'vitest'
import { Box3, Mesh, MeshStandardMaterial } from 'three'
import { createWorldEntityVisual, loadMinifigureMoulds } from './worldEntityVisual'

beforeAll(async () => { await loadMinifigureMoulds() })

describe('native minifigure actors', () => {
  it.each(['knight', 'archer', 'priest'])('assembles grounded %s figures at the existing actor scale', id => {
    const model = createWorldEntityVisual(id)
    const bounds = new Box3().setFromObject(model)
    expect(bounds.min.y).toBeCloseTo(0, 5)
    expect(bounds.max.y).toBeLessThan(5.1)
    expect(bounds.max.y).toBeGreaterThan(4.7)
    for (const name of ['left-leg', 'right-leg', 'left-arm', 'right-arm']) expect(model.getObjectByName(name)).toBeDefined()
  })
  it('shares immutable moulds while keeping joint transforms independent', () => {
    const first = createWorldEntityVisual('knight')
    const second = createWorldEntityVisual('knight')
    first.getObjectByName('left-arm')!.rotation.x = 1
    expect(second.getObjectByName('left-arm')!.rotation.x).toBeCloseTo(0)
    const meshes: Mesh[] = []
    first.traverse(object => { if (object instanceof Mesh) meshes.push(object) })
    expect(meshes.some(mesh => mesh.geometry.getAttribute('position').count > 1000)).toBe(true)
  })
  it('keeps placement ghost materials separate from solid actor materials', () => {
    const ghost = createWorldEntityVisual('priest', 'red', true)
    ghost.traverse(object => {
      if (object instanceof Mesh) {
        expect((object.material as MeshStandardMaterial).transparent).toBe(true)
        expect((object.material as MeshStandardMaterial).depthWrite).toBe(false)
      }
    })
  })
})
