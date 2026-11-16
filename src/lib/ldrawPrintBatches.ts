import { getSharedBatchTransform, getRigidChunkAssignments } from './sharedBatchTransform'
import { createInstanceBoundsQuery } from './instanceBoundsTree'
import { yieldToBrowser } from './yieldToBrowser'
import { BufferAttribute, BufferGeometry, Color, Matrix3, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Box3, type Intersection, type Raycaster } from 'three'
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh'
import type { LDrawMeshBatch } from './ldrawSceneBatches'

export type LDrawPrintBatch = { key: string; geometry: BufferGeometry; transform?: Matrix4; brickIds: string[]; triangleBrickIndices: Uint32Array; sources: { batch: LDrawMeshBatch; index: number }[] }

/** Opaque artwork shares one material. Vertex colours retain each original ink. */
// Smaller spatial chunks keep a single selection change from rebuilding a
// large merged print mesh (a 16-unit chunk cost ~230 ms on the 6k-piece castle).
const PRINT_CHUNK_SIZE = 8
const sourceSignature = (sources: LDrawPrintBatch['sources']) => JSON.stringify(sources.map(({ batch, index }) => [
  batch.geometry.uuid, batch.instances[index].brick.id, batch.instances[index].color,
]))


function* generatePrintBatches(batches: LDrawMeshBatch[], previous: LDrawPrintBatch[] = []): Generator<LDrawPrintBatch | undefined> {
  let sliceStart = performance.now()
  const chunks = new Map<string, { batch: LDrawMeshBatch; index: number }[]>()
  const identity = (batch: LDrawMeshBatch, index: number) => JSON.stringify([batch.geometry.uuid, batch.instances[index].brick.id, batch.instances[index].color])
  const rigidChunks = getRigidChunkAssignments(
    batches.filter(batch => batch.scope === 'active').flatMap(batch => batch.instances.map((instance, index) => ({ id: identity(batch, index), matrix: instance.matrix }))),
    previous.flatMap(chunk => chunk.sources.filter(item => item.batch.scope === 'active').map(({ batch, index }) => ({ id: identity(batch, index), matrix: batch.instances[index].matrix, chunk: chunk.key }))),
  )
  for (const batch of batches) batch.instances.forEach((instance, index) => {
    const e = instance.matrix.elements
    const spatialKey = `${batch.scope ? 'active:' : ''}${Math.floor(e[12] / PRINT_CHUNK_SIZE)}:${Math.floor(e[14] / PRINT_CHUNK_SIZE)}`
    const key = batch.scope ? rigidChunks?.get(identity(batch, index)) ?? spatialKey : spatialKey
    const items = chunks.get(key) ?? []; items.push({ batch, index }); chunks.set(key, items)
  })
  const previousBySources = new Map(previous.map(batch => [sourceSignature(batch.sources), batch]))
  const point = new Vector3(), normal = new Vector3(), normalMatrix = new Matrix3(), color = new Color()
  for (const [key, items] of chunks) {
    const cached = previousBySources.get(sourceSignature(items))
    if (cached?.sources.length === items.length && items.every((item, i) => item.batch.geometry === cached.sources[i].batch.geometry &&
      item.batch.instances[item.index].brick === cached.sources[i].batch.instances[cached.sources[i].index].brick &&
      item.batch.instances[item.index].color === cached.sources[i].batch.instances[cached.sources[i].index].color)) { yield cached.key === key ? cached : { ...cached, key }; continue }
    if (cached && cached.sources.length === items.length && items.length > 0) {
      const sameSources = items.every((item, i) => {
        const previous = cached.sources[i]
        const instance = item.batch.instances[item.index]
        const oldInstance = previous.batch.instances[previous.index]
        return item.batch.geometry === previous.batch.geometry && instance.brick.id === oldInstance.brick.id && instance.color === oldInstance.color
      })
      const delta = sameSources ? getSharedBatchTransform(
        items.map(item => item.batch.instances[item.index].matrix),
        cached.sources.map(item => item.batch.instances[item.index].matrix),
      ) : undefined
      if (delta) {
        yield { ...cached, key, sources: items, transform: delta.multiply(cached.transform ?? new Matrix4()) }
        continue
      }
    }
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
        if (i % 4096 === 0 && performance.now() - sliceStart >= 8) {
          yield undefined
          sliceStart = performance.now()
        }
      }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(normals, 3))
    geometry.setAttribute('color', new BufferAttribute(colors, 3))
    geometry.computeBoundingSphere()
    yield { key, geometry, brickIds, triangleBrickIndices, sources: items }
  }
}

export const mergeLDrawPrintBatches = (batches: LDrawMeshBatch[], previous: LDrawPrintBatch[] = []) =>
  [...generatePrintBatches(batches, previous)].filter((batch): batch is LDrawPrintBatch => Boolean(batch))

export const prepareLDrawPrintBatches = async (batches: LDrawMeshBatch[], onProgress?: (fraction: number) => void, canceled: () => boolean = () => false) => {
  const result: LDrawPrintBatch[] = []
  const total = batches.reduce((sum, batch) => sum + batch.instances.length * (batch.geometry.index?.count ?? batch.geometry.getAttribute('position').count), 0)
  let completed = 0
  let sliceStart = performance.now()
  for (const batch of generatePrintBatches(batches)) {
    if (canceled()) return []
    if (batch) {
      result.push(batch)
      completed += batch.geometry.getAttribute('position').count
      onProgress?.(completed / Math.max(1, total))
    }
    if (!batch || performance.now() - sliceStart >= 8) { await yieldToBrowser(); sliceStart = performance.now() }
  }
  onProgress?.(1)
  return result
}

type PrintPickingFrame = { geometry: BufferGeometry; matrix: Matrix4; offset: number; normalMatrix: Matrix3; bounds: Box3 }
const pickingFrames = new WeakMap<BufferGeometry, { sources: PrintPickingFrame[]; query: ReturnType<typeof createInstanceBoundsQuery> }>()

/** A reused merged geometry keeps the same local picking frame through rigid edits. */
const getPrintPickingFrames = (batch: LDrawPrintBatch) => {
  const cached = pickingFrames.get(batch.geometry)
  if (cached) return cached
  const inverseTransform = (batch.transform ?? new Matrix4()).clone().invert()
  let triangleOffset = 0
  const sources = batch.sources.map(({ batch: source, index }) => {
    const geometry = source.geometry
    prepareLDrawPickingGeometry(geometry)
    const matrix = new Matrix4().multiplyMatrices(inverseTransform, source.instances[index].matrix)
    const offset = triangleOffset
    triangleOffset += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
    return { geometry, matrix, offset, normalMatrix: new Matrix3().getNormalMatrix(matrix), bounds: geometry.boundingBox!.clone().applyMatrix4(matrix) }
  })
  const frames = { sources, query: createInstanceBoundsQuery(sources.map(source => source.bounds)) }
  pickingFrames.set(batch.geometry, frames)
  return frames
}

export const updateLDrawPrintBatchTransform = (mesh: Mesh, batch: LDrawPrintBatch) => {
  mesh.matrix.copy(batch.transform ?? new Matrix4())
  mesh.matrixAutoUpdate = !batch.transform
  mesh.matrixWorldNeedsUpdate = true
}

export const createLDrawPrintBatchMesh = (batch: LDrawPrintBatch) => {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: .4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  const mesh = new Mesh(batch.geometry, material)
  mesh.renderOrder = 1
  updateLDrawPrintBatchTransform(mesh, batch)
  const { sources, query } = getPrintPickingFrames(batch)
  const proxy = new Mesh(batch.geometry, material)
  const localHits: Intersection[] = []
  mesh.raycast = (raycaster: Raycaster, hits: Intersection[]) => {
    const previous = raycaster.firstHitOnly
    raycaster.firstHitOnly = true
    try {
      let nearest: Intersection | undefined
      for (const index of query(raycaster.ray, mesh.matrixWorld)) {
        const source = sources[index]
        proxy.geometry = source.geometry
        proxy.matrixWorld.multiplyMatrices(mesh.matrixWorld, source.matrix)
        acceleratedRaycast.call(proxy, raycaster, localHits)
        for (const hit of localHits) {
          if (nearest && nearest.distance <= hit.distance) continue
          const faceIndex = source.offset + hit.faceIndex!
          nearest = { ...hit, object: mesh, faceIndex,
            normal: hit.normal?.clone().applyNormalMatrix(source.normalMatrix),
            face: hit.face ? { ...hit.face, normal: hit.face.normal.clone().applyNormalMatrix(source.normalMatrix), a: faceIndex * 3, b: faceIndex * 3 + 1, c: faceIndex * 3 + 2 } : hit.face }
        }
        localHits.length = 0
      }
      if (nearest) hits.push(nearest)
    } finally { raycaster.firstHitOnly = previous }
  }
  return mesh
}

export const prepareLDrawPickingGeometry = (geometry: BufferGeometry) => {
  if (!geometry.getAttribute('position')?.count) return
  const options = { indirect: true, maxLeafTris: 10 }
  if (!geometry.boundsTree) geometry.boundsTree = new MeshBVH(geometry, options)
  if (!geometry.boundingBox) geometry.computeBoundingBox()
}
