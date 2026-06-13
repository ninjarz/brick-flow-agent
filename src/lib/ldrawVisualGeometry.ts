import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { BrickFootprint } from '../types/bricks'
import {
  getLoadedLDrawGeneratedVisualTriangles,
  loadLDrawGeneratedVisualTriangles,
} from './ldrawGeneratedVisualLoader'
import { normalizeLDrawPartNumber } from './ldrawPartNumbers'
import type { MeshTriangle } from './structuralVoxelizer'

const geometryCache = new Map<string, BufferGeometry>()

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
  return geometry.clone()
}

export const createLoadedLDrawPartGeometry = (partNumber: string, footprint: BrickFootprint) => {
  const cacheKey = makeCacheKey(partNumber, footprint)
  const cached = geometryCache.get(cacheKey)
  if (cached) return cached.clone()

  const triangles = getLoadedLDrawGeneratedVisualTriangles(normalizeLDrawPartNumber(partNumber))
  if (!triangles) return undefined

  return createGeometryFromTriangles(cacheKey, footprint, triangles)
}

export const loadLDrawPartGeometry = async (partNumber: string, footprint: BrickFootprint) => {
  const cacheKey = makeCacheKey(partNumber, footprint)
  const cached = geometryCache.get(cacheKey)
  if (cached) return cached.clone()

  const triangles = await loadLDrawGeneratedVisualTriangles(normalizeLDrawPartNumber(partNumber))
  if (!triangles) return undefined

  return createGeometryFromTriangles(cacheKey, footprint, triangles)
}
