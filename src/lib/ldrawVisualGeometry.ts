import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { BrickFootprint } from '../types/bricks'
import {
  getLoadedLDrawGeneratedVisualTriangles,
  loadLDrawGeneratedVisualTriangles,
} from './ldrawGeneratedVisualLoader'
import { normalizeLDrawPartNumber } from './ldrawPartNumbers'
import printedParts from '../data/ldrawPrintedParts.json'
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
  const vertices = new Float32Array(triangles.flatMap((triangle) =>
    triangle.flatMap((point) => [
      point.x - width / 2,
      point.y - height / 2,
      point.z - depth / 2,
    ]),
  ))
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
  const patterns = printedParts as Record<string, Array<{ color: number; hex: string; positions: number[] }>>
  return (patterns[normalizeLDrawPartNumber(partNumber)] ?? []).map((layer) => {
    const key = `print:${makeCacheKey(partNumber, footprint)}:${layer.color}`
    let geometry = geometryCache.get(key)
    if (!geometry) {
      const triangles: MeshTriangle[] = []
      for (let i = 0; i < layer.positions.length; i += 9) {
        const n = layer.positions
        triangles.push([{ x: n[i], y: n[i + 1], z: n[i + 2] }, { x: n[i + 3], y: n[i + 4], z: n[i + 5] }, { x: n[i + 6], y: n[i + 7], z: n[i + 8] }])
      }
      geometry = createGeometryFromTriangles(key, footprint, triangles)
    }
    return { color: layer.hex, geometry }
  })
}
