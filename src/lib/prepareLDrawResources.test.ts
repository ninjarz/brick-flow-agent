import { expect, it, vi } from 'vitest'
import { BoxGeometry, Matrix4 } from 'three'
import { prepareLDrawResources, releasePreparedLDrawResources } from './prepareLDrawResources'
import { makeBrick } from './planUtils'

it('prepares adoptable resources and releases unclaimed objects without disposing shared moulds', async () => {
  const geometry = new BoxGeometry(1, 1, 1)
  const disposed = vi.fn()
  geometry.addEventListener('dispose', disposed)
  const brick = makeBrick('brick-1x1', 'red', 0, 0, 0)
  const batch = { key: 'body', geometry, instances: [{ brick, matrix: new Matrix4(), color: '#ff0000' }], print: false, doubleSide: false }
  const scene = { meshBatches: [batch], printBatches: [], printSources: [], individualBricks: [], lineBatches: [{ key: 'line', color: '#000000', points: new Float32Array([0, 0, 0, 1, 1, 1]), sources: [] }] }
  const resources = (await prepareLDrawResources(scene, () => false))!
  expect(resources.bodies.get(batch)!.count).toBe(1)
  expect(resources.lines.size).toBe(1)
  releasePreparedLDrawResources(resources)
  expect(resources.bodies.size).toBe(0)
  expect(resources.lines.size).toBe(0)
  expect(resources.scene).toBeUndefined()
  expect(disposed).not.toHaveBeenCalled()
  let canceled = false
  expect(await prepareLDrawResources(scene, () => canceled, () => { canceled = true })).toBeUndefined()
  canceled = false
  expect(await prepareLDrawResources({ ...scene, lineBatches: [] }, () => canceled, () => { canceled = true })).toBeUndefined()
  expect(await prepareLDrawResources({ ...scene, meshBatches: [], lineBatches: [] }, () => false)).toBeUndefined()
  geometry.dispose()
})
