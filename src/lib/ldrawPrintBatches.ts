import { BufferGeometry, Color, Float32BufferAttribute, Matrix3, Mesh, MeshStandardMaterial, Vector3, type Intersection, type Raycaster } from 'three'
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh'
import type { LDrawMeshBatch } from './ldrawSceneBatches'

export type LDrawPrintBatch = { key: string; geometry: BufferGeometry; brickIds: string[]; triangleBrickIndices: Uint32Array; sources: { batch: LDrawMeshBatch; index: number }[] }

/** Opaque artwork shares one material. Vertex colours retain each original ink. */
// Smaller spatial chunks keep a single selection change from rebuilding a
// large merged print mesh (a 16-unit chunk cost ~230 ms on the 6k-piece castle).
const PRINT_CHUNK_SIZE = 8

export const mergeLDrawPrintBatches = (batches: LDrawMeshBatch[], previous: LDrawPrintBatch[] = []) => {
  const chunks = new Map<string, { batch: LDrawMeshBatch; index: number }[]>()
  for (const batch of batches) batch.instances.forEach((instance, index) => {
    const e = instance.matrix.elements
    const key = `${Math.floor(e[12] / PRINT_CHUNK_SIZE)}:${Math.floor(e[14] / PRINT_CHUNK_SIZE)}`
    const items = chunks.get(key) ?? []; items.push({ batch, index }); chunks.set(key, items)
  })
  const previousByKey = new Map(previous.map(batch => [batch.key, batch]))
  const point = new Vector3(), normal = new Vector3(), normalMatrix = new Matrix3(), color = new Color()
  return [...chunks].map(([key, items]): LDrawPrintBatch => {
    const cached = previousByKey.get(key)
    if (cached?.sources.length === items.length && items.every((item, i) => item.batch.geometry === cached.sources[i].batch.geometry &&
      item.batch.instances[item.index].brick === cached.sources[i].batch.instances[cached.sources[i].index].brick &&
      item.batch.instances[item.index].color === cached.sources[i].batch.instances[cached.sources[i].index].color)) return cached
    const count = items.reduce((n, item) => n + (item.batch.geometry.index?.count ?? item.batch.geometry.getAttribute('position').count), 0)
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 3)
    const triangleBrickIndices = new Uint32Array(count / 3), brickIds: string[] = [], ids = new Map<string, number>()
    let offset = 0
    for (const { batch, index } of items) {
      const instance = batch.instances[index], source = batch.geometry
      const position = source.getAttribute('position'), sourceNormal = source.getAttribute('normal')
      let brickIndex = ids.get(instance.brick.id)
      if (brickIndex === undefined) { brickIndex = brickIds.length; ids.set(instance.brick.id, brickIndex); brickIds.push(instance.brick.id) }
      normalMatrix.getNormalMatrix(instance.matrix); color.set(instance.color)
      const vertexCount = source.index?.count ?? position.count
      for (let i = 0; i < vertexCount; i++) {
        const vertex = source.index?.getX(i) ?? i
        point.fromBufferAttribute(position, vertex).applyMatrix4(instance.matrix).toArray(positions, offset * 3)
        normal.fromBufferAttribute(sourceNormal, vertex).applyNormalMatrix(normalMatrix).toArray(normals, offset * 3)
        color.toArray(colors, offset * 3)
        triangleBrickIndices[Math.floor(offset / 3)] = brickIndex
        offset++
      }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
    // Indirect BVH preserves faceIndex -> original editable piece mapping.
    const options = { indirect: true, maxLeafTris: 10 }
    geometry.boundsTree = new MeshBVH(geometry, options)
    geometry.computeBoundingSphere()
    return { key, geometry, brickIds, triangleBrickIndices, sources: items }
  })
}

export const createLDrawPrintBatchMesh = (batch: LDrawPrintBatch) => {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: .4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  const mesh = new Mesh(batch.geometry, material)
  mesh.renderOrder = 1
  mesh.raycast = (raycaster: Raycaster, hits: Intersection[]) => {
    const previous = raycaster.firstHitOnly
    raycaster.firstHitOnly = true
    try { acceleratedRaycast.call(mesh, raycaster, hits) } finally { raycaster.firstHitOnly = previous }
  }
  return mesh
}
