import type { BrickDefinition, BrickPose } from '../types/bricks'
import { getLoadedLDrawGeneratedVisualTriangles } from './ldrawGeneratedVisualLoader'
import { normalizeLDrawPartNumber } from './ldrawPartNumbers'
import { transformBrickLocalPoint } from './brickUnits'
import type { MeshTriangle } from './structuralVoxelizer'

export type BrickBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export type BrickBoundsFrame = {
  x: number
  y: number
  z: number
  width: number
  height: number
  depth: number
  widthStuds: number
  depthStuds: number
}

const localBoundsCache = new Map<string, BrickBounds>()

export const getTriangleBounds = (triangles: MeshTriangle[]): BrickBounds | undefined => {
  if (triangles.length === 0) return undefined

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (const triangle of triangles) {
    for (const point of triangle) {
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y)
      maxY = Math.max(maxY, point.y)
      minZ = Math.min(minZ, point.z)
      maxZ = Math.max(maxZ, point.z)
    }
  }

  return { minX, maxX, minY, maxY, minZ, maxZ }
}

export const getFootprintLocalBounds = (definition: BrickDefinition): BrickBounds => ({
  minX: 0,
  maxX: definition.footprint.widthStuds,
  minY: 0,
  maxY: definition.footprint.heightStuds,
  minZ: 0,
  maxZ: definition.footprint.depthStuds,
})

export const getLoadedLDrawLocalBounds = (partNumber: string) => {
  const normalizedPartNumber = normalizeLDrawPartNumber(partNumber)
  const cached = localBoundsCache.get(normalizedPartNumber)
  if (cached) return cached

  const triangles = getLoadedLDrawGeneratedVisualTriangles(normalizedPartNumber)
  if (!triangles) return undefined

  const bounds = getTriangleBounds(triangles)
  if (bounds) localBoundsCache.set(normalizedPartNumber, bounds)
  return bounds
}

export const getBrickLocalBounds = (definition: BrickDefinition) =>
  getLoadedLDrawLocalBounds(definition.partNumber) ?? getFootprintLocalBounds(definition)

const getBoundsCorners = (bounds: BrickBounds) => [
  { x: bounds.minX, y: bounds.minY, z: bounds.minZ },
  { x: bounds.minX, y: bounds.minY, z: bounds.maxZ },
  { x: bounds.minX, y: bounds.maxY, z: bounds.minZ },
  { x: bounds.minX, y: bounds.maxY, z: bounds.maxZ },
  { x: bounds.maxX, y: bounds.minY, z: bounds.minZ },
  { x: bounds.maxX, y: bounds.minY, z: bounds.maxZ },
  { x: bounds.maxX, y: bounds.maxY, z: bounds.minZ },
  { x: bounds.maxX, y: bounds.maxY, z: bounds.maxZ },
]

export const transformBrickLocalBounds = (
  definition: BrickDefinition,
  pose: BrickPose,
  bounds: BrickBounds,
): BrickBounds => {
  const corners = getBoundsCorners(bounds).map((corner) => transformBrickLocalPoint(definition, pose, corner))

  return {
    minX: Math.min(...corners.map((corner) => corner.x)),
    maxX: Math.max(...corners.map((corner) => corner.x)),
    minY: Math.min(...corners.map((corner) => corner.y)),
    maxY: Math.max(...corners.map((corner) => corner.y)),
    minZ: Math.min(...corners.map((corner) => corner.z)),
    maxZ: Math.max(...corners.map((corner) => corner.z)),
  }
}

export const getBrickWorldBounds = (definition: BrickDefinition, pose: BrickPose) =>
  transformBrickLocalBounds(definition, pose, getBrickLocalBounds(definition))

export const getBrickFootprintWorldBounds = (definition: BrickDefinition, pose: BrickPose) =>
  transformBrickLocalBounds(definition, pose, getFootprintLocalBounds(definition))

export const boundsToFrame = (bounds: BrickBounds): BrickBoundsFrame => ({
  x: (bounds.minX + bounds.maxX) / 2,
  y: (bounds.minY + bounds.maxY) / 2,
  z: (bounds.minZ + bounds.maxZ) / 2,
  width: bounds.maxX - bounds.minX,
  height: bounds.maxY - bounds.minY,
  depth: bounds.maxZ - bounds.minZ,
  widthStuds: bounds.maxX - bounds.minX,
  depthStuds: bounds.maxZ - bounds.minZ,
})

export const getBrickWorldBoundsFrame = (definition: BrickDefinition, pose: BrickPose) =>
  boundsToFrame(getBrickWorldBounds(definition, pose))
