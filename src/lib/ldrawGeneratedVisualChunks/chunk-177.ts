import type { MeshTriangle } from '../structuralVoxelizer'

const ldrawGeneratedVisualTriangleValues: Record<string, number[]> = JSON.parse("{}")

const visualTriangleCache = new Map<string, MeshTriangle[]>()

export const getLDrawGeneratedVisualTriangles = (partNumber: string) => {
  const cached = visualTriangleCache.get(partNumber)
  if (cached) return cached

  const values = ldrawGeneratedVisualTriangleValues[partNumber]
  if (!values) return undefined

  const triangles: MeshTriangle[] = []
  for (let index = 0; index < values.length; index += 9) {
    triangles.push([
      { x: values[index], y: values[index + 1], z: values[index + 2] },
      { x: values[index + 3], y: values[index + 4], z: values[index + 5] },
      { x: values[index + 6], y: values[index + 7], z: values[index + 8] },
    ])
  }

  visualTriangleCache.set(partNumber, triangles)
  return triangles
}

import type { LDrawFixedColorLayer } from '../ldrawGeneratedVisual'
const printLayers: Record<string, LDrawFixedColorLayer[]> = JSON.parse("{}")
export const getLDrawGeneratedPrintLayers = (partNumber: string) => printLayers[partNumber]
