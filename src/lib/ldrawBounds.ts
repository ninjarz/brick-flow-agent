import type { BrickDefinition, BrickPose } from '../types/bricks'
import { getLoadedLDrawGeneratedVisualTriangles, getLoadedLDrawGeneratedVisualValues } from './ldrawVisualRegistry'
import { normalizeLDrawPartNumber } from './ldrawPartNumbers'
import { transformBrickLocalPoint } from './brickUnits'
import { getRigidBrickMatrix } from './rigidBrickTransform'
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
const contactHulls = new Map<string, readonly number[]>()
const contactBoundsCache = new WeakMap<BrickDefinition, WeakMap<object, Map<string, BrickBounds>>>()

export const seedLDrawContactHull = (partNumber: string, points: readonly number[]) => {
  if (!points.length || points.length % 3 || !points.every(Number.isFinite)) throw new Error('INVALID_LDRAW_CONTACT_HULL')
  contactHulls.set(normalizeLDrawPartNumber(partNumber), points)
}

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

/** Analysis workers reuse reviewed bounds without downloading render meshes. */
export const seedLDrawLocalBounds = (partNumber: string, bounds: BrickBounds) => {
  localBoundsCache.set(normalizeLDrawPartNumber(partNumber), bounds)
}

export const getLoadedLDrawLocalBounds = (partNumber: string) => {
  const normalizedPartNumber = normalizeLDrawPartNumber(partNumber)
  const cached = localBoundsCache.get(normalizedPartNumber)
  if (cached) return cached

  const values = contactHulls.get(normalizedPartNumber) ?? getLoadedLDrawGeneratedVisualValues(normalizedPartNumber)
  if (values?.length) {
    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }
    for (let i = 0; i < values.length; i += 3) {
      bounds.minX = Math.min(bounds.minX, values[i]); bounds.maxX = Math.max(bounds.maxX, values[i])
      bounds.minY = Math.min(bounds.minY, values[i + 1]); bounds.maxY = Math.max(bounds.maxY, values[i + 1])
      bounds.minZ = Math.min(bounds.minZ, values[i + 2]); bounds.maxZ = Math.max(bounds.maxZ, values[i + 2])
    }
    localBoundsCache.set(normalizedPartNumber, bounds)
    return bounds
  }
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

const orientedBounds = new WeakMap<BrickDefinition, WeakMap<BrickBounds, Map<string, BrickBounds>>>()

export const transformBrickLocalBounds = (
  definition: BrickDefinition,
  pose: BrickPose,
  bounds: BrickBounds,
): BrickBounds => {
  let byBounds = orientedBounds.get(definition)
  if (!byBounds) { byBounds = new WeakMap(); orientedBounds.set(definition, byBounds) }
  let byOrientation = byBounds.get(bounds)
  if (!byOrientation) { byOrientation = new Map(); byBounds.set(bounds, byOrientation) }
  const key = `${definition.footprint.widthStuds},${definition.footprint.heightStuds},${definition.footprint.depthStuds}:${pose.rotationQuarterTurns},${pose.verticalQuarterTurns ?? 0},${pose.rollQuarterTurns ?? 0}:${pose.orientationMatrix?.join(',') ?? ''}:${bounds.minX},${bounds.maxX},${bounds.minY},${bounds.maxY},${bounds.minZ},${bounds.maxZ}`
  let rotated = byOrientation.get(key)
  if (!rotated) {
    const localPose = { ...pose, xStud: 0, yStud: 0, zStud: 0 }
    const corners = getBoundsCorners(bounds).map(corner => transformBrickLocalPoint(definition, localPose, corner))
    rotated = {
      minX: Math.min(...corners.map(corner => corner.x)), maxX: Math.max(...corners.map(corner => corner.x)),
      minY: Math.min(...corners.map(corner => corner.y)), maxY: Math.max(...corners.map(corner => corner.y)),
      minZ: Math.min(...corners.map(corner => corner.z)), maxZ: Math.max(...corners.map(corner => corner.z)),
    }
    if (byOrientation.size >= 512) byOrientation.clear()
    byOrientation.set(key, rotated)
  }
  // Translation is the final operation in transformBrickLocalPoint, so this
  // reuses the identical rotated extrema without re-transforming eight corners.
  return {
    minX: pose.xStud + rotated.minX, maxX: pose.xStud + rotated.maxX,
    minY: pose.yStud + rotated.minY, maxY: pose.yStud + rotated.maxY,
    minZ: pose.zStud + rotated.minZ, maxZ: pose.zStud + rotated.maxZ,
  }
}

/** Support extrema use actual mould vertices; rotated AABB corners can be empty space. */
export const getBrickWorldBounds = (definition: BrickDefinition, pose: BrickPose): BrickBounds => {
  const part = normalizeLDrawPartNumber(definition.partNumber)
  const points = contactHulls.get(part) ?? getLoadedLDrawGeneratedVisualValues(part)
  if (!points?.length) return transformBrickLocalBounds(definition, pose, getBrickLocalBounds(definition))
  let byPoints = contactBoundsCache.get(definition)
  if (!byPoints) { byPoints = new WeakMap(); contactBoundsCache.set(definition, byPoints) }
  let orientations = byPoints.get(points)
  if (!orientations) { orientations = new Map(); byPoints.set(points, orientations) }
  const key = `${definition.footprint.widthStuds},${definition.footprint.heightStuds},${definition.footprint.depthStuds}:${pose.rotationQuarterTurns},${pose.verticalQuarterTurns ?? 0},${pose.rollQuarterTurns ?? 0}:${pose.orientationMatrix?.join(',') ?? ''}`
  let bounds = orientations.get(key)
  if (!bounds) {
    const matrix = getRigidBrickMatrix(definition, { ...pose, xStud: 0, yStud: 0, zStud: 0 }).elements
    const { widthStuds, heightStuds, depthStuds } = definition.footprint
    bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }
    for (let index = 0; index < points.length; index += 3) {
      const x = points[index] - widthStuds / 2, y = points[index + 1] - heightStuds / 2, z = points[index + 2] - depthStuds / 2
      const worldX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]
      const worldY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]
      const worldZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]
      bounds.minX = Math.min(bounds.minX, worldX); bounds.maxX = Math.max(bounds.maxX, worldX)
      bounds.minY = Math.min(bounds.minY, worldY); bounds.maxY = Math.max(bounds.maxY, worldY)
      bounds.minZ = Math.min(bounds.minZ, worldZ); bounds.maxZ = Math.max(bounds.maxZ, worldZ)
    }
    if (orientations.size >= 512) orientations.clear()
    orientations.set(key, bounds)
  }
  return { minX: pose.xStud + bounds.minX, maxX: pose.xStud + bounds.maxX,
    minY: pose.yStud + bounds.minY, maxY: pose.yStud + bounds.maxY,
    minZ: pose.zStud + bounds.minZ, maxZ: pose.zStud + bounds.maxZ }
}

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
