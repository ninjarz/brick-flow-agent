import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { BrickFootprint } from '../types/bricks'
import {
  getLoadedLDrawGeneratedVisualTriangles,
  getLoadedLDrawPrintLayers,
  loadLDrawGeneratedVisualTriangles,
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
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  geometryCache.set(cacheKey, geometry)
  return geometry
}

export const createLoadedLDrawPartGeometry = (partNumber: string, footprint: BrickFootprint) => {
  const cacheKey = makeCacheKey(partNumber, footprint)
  const cached = geometryCache.get(cacheKey)
  if (cached) return cached

  const triangles = getLoadedLDrawGeneratedVisualTriangles(normalizeLDrawPartNumber(partNumber))
  if (!triangles) return undefined

  return createGeometryFromTriangles(cacheKey, footprint, triangles)
}

// Fixed-color meshes include both ink and physical colored material, such as a
// transparent flask neck and its molded fluid. Render each triangle only once.
export const createLoadedLDrawBodyGeometry = (partNumber: string, footprint: BrickFootprint) => {
  const part = normalizeLDrawPartNumber(partNumber)
  const fixed = getLoadedLDrawPrintLayers(part) ?? []
  if (!fixed.length) return createLoadedLDrawPartGeometry(partNumber, footprint)
  const cacheKey = `body:${makeCacheKey(partNumber, footprint)}`
  const cached = geometryCache.get(cacheKey)
  if (cached) return cached
  const triangles = getLoadedLDrawGeneratedVisualTriangles(part)
  if (!triangles) return undefined
  if (fixed.every(layer => layer.triangleIndices)) {
    const colored = new Set(fixed.flatMap(layer => layer.triangleIndices!))
    return createGeometryFromTriangles(cacheKey, footprint, triangles.filter((_, index) => !colored.has(index)))
  }
  return createLoadedLDrawPartGeometry(partNumber, footprint)
}

export const loadLDrawPartGeometry = async (partNumber: string, footprint: BrickFootprint) => {
  const cacheKey = makeCacheKey(partNumber, footprint)
  const cached = geometryCache.get(cacheKey)
  if (cached) return cached

  const pending = geometryLoadCache.get(cacheKey)
  if (pending) return pending

  const loading = loadLDrawGeneratedVisualTriangles(normalizeLDrawPartNumber(partNumber))
    .then((triangles) => {
      const loaded = geometryCache.get(cacheKey)
      if (loaded || !triangles) return loaded
      return createGeometryFromTriangles(cacheKey, footprint, triangles)
    })
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
      const all = getLoadedLDrawGeneratedVisualTriangles(normalizeLDrawPartNumber(partNumber)) ?? []
      const triangles = layer.triangleIndices.map(index => all[index]).filter((t): t is MeshTriangle => Boolean(t))
      geometry = createGeometryFromTriangles(key, footprint, triangles)
    }
    return { color: layer.hex, opacity: layer.opacity ?? 1, geometry }
  })
}
