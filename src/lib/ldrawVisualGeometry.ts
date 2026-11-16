import { seedLDrawEdgePoints } from './ldrawEdgePoints'
import { BufferGeometry, BufferAttribute } from 'three'
import type { BrickFootprint } from '../types/bricks'
import {
  getLoadedLDrawGeneratedVisualTriangles,
  getLoadedLDrawPrintLayers,
  loadLDrawGeneratedVisual,
  getLoadedLDrawGeneratedVisualValues,
  getLoadedLDrawGeneratedEdgePoints,
} from './ldrawGeneratedVisualLoader'
import { normalizeLDrawPartNumber } from './ldrawPartNumbers'
import type { MeshTriangle } from './structuralVoxelizer'

const geometryCache = new Map<string, BufferGeometry>()
const geometryLoadCache = new Map<string, Promise<BufferGeometry | undefined>>()

const makeCacheKey = (partNumber: string, footprint: BrickFootprint) =>
  `${normalizeLDrawPartNumber(partNumber)}:${footprint.widthStuds}x${footprint.depthStuds}x${footprint.heightStuds}`

const createGeometryFromTriangles = (
  cacheKey: string,
  footprint: BrickFootprint,
  triangles: MeshTriangle[],
) => {
  const width = footprint.widthStuds
  const height = footprint.heightStuds
  const depth = footprint.depthStuds
  // Large printed replicas contain millions of vertices. Fill the typed
  // buffer directly instead of allocating nested arrays for every triangle.
  const vertices = new Float32Array(triangles.length * 9)
  let offset = 0
  for (const triangle of triangles) {
    for (const point of triangle) {
      vertices[offset++] = point.x - width / 2
      vertices[offset++] = point.y - height / 2
      vertices[offset++] = point.z - depth / 2
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  geometryCache.set(cacheKey, geometry)
  return geometry
}

const createGeometryFromValues = (cacheKey: string, footprint: BrickFootprint, values: ArrayLike<number>, indices?: number[]) => {
  const count = indices?.length ?? values.length / 9
  const vertices = new Float32Array(count * 9)
  let offset = 0
  for (let triangle = 0; triangle < count; triangle++) {
    const start = (indices?.[triangle] ?? triangle) * 9
    for (let vertex = 0; vertex < 9; vertex += 3) {
      vertices[offset++] = values[start + vertex] - footprint.widthStuds / 2
      vertices[offset++] = values[start + vertex + 1] - footprint.heightStuds / 2
      vertices[offset++] = values[start + vertex + 2] - footprint.depthStuds / 2
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  geometryCache.set(cacheKey, geometry)
  return geometry
}

export const createLoadedLDrawPartGeometry = (partNumber: string, footprint: BrickFootprint) => {
  const cacheKey = makeCacheKey(partNumber, footprint)
  const cached = geometryCache.get(cacheKey)
  if (cached) return cached

  const values = getLoadedLDrawGeneratedVisualValues(partNumber)
  if (values) return createGeometryFromValues(cacheKey, footprint, values)
  const triangles = getLoadedLDrawGeneratedVisualTriangles(normalizeLDrawPartNumber(partNumber))
  if (!triangles) return undefined

  return createGeometryFromTriangles(cacheKey, footprint, triangles)
}

const seedBodyEdges = (geometry: BufferGeometry, part: string, footprint: BrickFootprint) => {
  const points = getLoadedLDrawGeneratedEdgePoints(part, footprint)
  if (points) seedLDrawEdgePoints(geometry, points)
  return geometry
}

// Fixed-color meshes include both ink and physical colored material, such as a
// transparent flask neck and its molded fluid. Render each triangle only once.
export const createLoadedLDrawBodyGeometry = (partNumber: string, footprint: BrickFootprint) => {
  const part = normalizeLDrawPartNumber(partNumber)
  const fixed = getLoadedLDrawPrintLayers(part) ?? []
  if (!fixed.length) {
    const geometry = createLoadedLDrawPartGeometry(partNumber, footprint)
    return geometry ? seedBodyEdges(geometry, part, footprint) : undefined
  }
  const cacheKey = `body:${makeCacheKey(partNumber, footprint)}`
  const cached = geometryCache.get(cacheKey)
  if (cached) return seedBodyEdges(cached, part, footprint)
  const values = getLoadedLDrawGeneratedVisualValues(part)
  if (values && fixed.every(layer => layer.triangleIndices)) {
    const colored = new Set(fixed.flatMap(layer => layer.triangleIndices))
    const indices = Array.from({ length: values.length / 9 }, (_, index) => index).filter(index => !colored.has(index))
    return seedBodyEdges(createGeometryFromValues(cacheKey, footprint, values, indices), part, footprint)
  }
  const triangles = getLoadedLDrawGeneratedVisualTriangles(part)
  if (!triangles) return undefined
  if (fixed.every(layer => layer.triangleIndices)) {
    const colored = new Set(fixed.flatMap(layer => layer.triangleIndices!))
    return seedBodyEdges(createGeometryFromTriangles(cacheKey, footprint, triangles.filter((_, index) => !colored.has(index))), part, footprint)
  }
  return seedBodyEdges(createLoadedLDrawPartGeometry(partNumber, footprint)!, part, footprint)
}

export const loadLDrawPartGeometry = async (partNumber: string, footprint: BrickFootprint) => {
  const cacheKey = makeCacheKey(partNumber, footprint)
  const cached = geometryCache.get(cacheKey)
  if (cached) return cached

  const pending = geometryLoadCache.get(cacheKey)
  if (pending) return pending

  const loading = loadLDrawGeneratedVisual([normalizeLDrawPartNumber(partNumber)])
    .then(() => createLoadedLDrawPartGeometry(partNumber, footprint))
    .finally(() => {
      geometryLoadCache.delete(cacheKey)
    })
  geometryLoadCache.set(cacheKey, loading)
  return loading
}

// Fixed printed triangles retain the original LDraw pattern instead of a replacement texture.
export const createLDrawPrintGeometries = (partNumber: string, footprint: BrickFootprint) => {
  return (getLoadedLDrawPrintLayers(partNumber) ?? []).map((layer) => {
    const key = `print:${makeCacheKey(partNumber, footprint)}:${layer.color}`
    let geometry = geometryCache.get(key)
    if (!geometry) {
      const values = getLoadedLDrawGeneratedVisualValues(partNumber)
      if (values) {
        const indices = layer.triangleIndices.filter(index => Number.isInteger(index) && index >= 0 && index * 9 < values.length)
        geometry = createGeometryFromValues(key, footprint, values, indices)
      } else {
        const all = getLoadedLDrawGeneratedVisualTriangles(normalizeLDrawPartNumber(partNumber)) ?? []
        const triangles = layer.triangleIndices.map(index => all[index]).filter((t): t is MeshTriangle => Boolean(t))
        geometry = createGeometryFromTriangles(key, footprint, triangles)
      }
    }
    return { color: layer.hex, opacity: layer.opacity ?? 1, geometry }
  })
}
