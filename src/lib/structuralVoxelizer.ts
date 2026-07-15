import type { StructuralCell, StructuralEntryDirection } from './structuralGrid'

type Point3 = {
  x: number
  y: number
  z: number
}

export type MeshTriangle = [Point3, Point3, Point3]

type VoxelizeMeshOptions = {
  minXStuds: number
  maxXStuds: number
  minYStuds: number
  maxYStuds: number
  minZStuds: number
  maxZStuds: number
  voxelSize: number
  triangles: MeshTriangle[]
}

type VoxelSample = {
  minX: number
  minY: number
  minZ: number
  centerIsInside: boolean
  surfaceIntersects: boolean
}

const allEntryDirections: StructuralEntryDirection[] = ['top', 'bottom', 'left', 'right', 'front', 'back']
const epsilon = 0.000001
const voxelBoundaryTolerance = 0.00001
const gridBoundarySnapTolerance = 0.0001

const round = (value: number) => Number(value.toFixed(6))

const snapGridBoundary = (value: number, voxelSize: number, direction: 'min' | 'max') => {
  // LDraw transforms can leave nominal grid boundaries a few decimal places off.
  // Snap those values, but expand genuinely protruding geometry to the next voxel.
  const nearestBoundary = Math.round(value / voxelSize) * voxelSize
  if (Math.abs(value - nearestBoundary) <= gridBoundarySnapTolerance) return round(nearestBoundary)

  const gridIndex = direction === 'min'
    ? Math.floor(value / voxelSize)
    : Math.ceil(value / voxelSize)
  return round(gridIndex * voxelSize)
}

const makeCell = (
  kind: StructuralCell['kind'],
  minX: number,
  minY: number,
  minZ: number,
  voxelSize: number,
): StructuralCell => ({
  kind,
  minX: round(minX),
  maxX: round(minX + voxelSize),
  minY: round(minY),
  maxY: round(minY + voxelSize),
  minZ: round(minZ),
  maxZ: round(minZ + voxelSize),
  ...(kind === 'enterable' ? { entersFrom: allEntryDirections } : {}),
})

const subtract = (source: Point3, target: Point3): Point3 => ({
  x: source.x - target.x,
  y: source.y - target.y,
  z: source.z - target.z,
})

const cross = (source: Point3, target: Point3): Point3 => ({
  x: source.y * target.z - source.z * target.y,
  y: source.z * target.x - source.x * target.z,
  z: source.x * target.y - source.y * target.x,
})

const dot = (source: Point3, target: Point3) =>
  source.x * target.x + source.y * target.y + source.z * target.z

const normalise = (point: Point3): Point3 => {
  const length = Math.sqrt(dot(point, point))
  if (length < epsilon) return { x: 1, y: 0, z: 0 }

  return {
    x: point.x / length,
    y: point.y / length,
    z: point.z / length,
  }
}

const pointOnAxis = (point: Point3, axis: Point3) =>
  dot(point, axis)

const axisSeparatesTriangleAndBox = (
  axis: Point3,
  triangle: MeshTriangle,
  halfSize: Point3,
) => {
  const axisLengthSq = dot(axis, axis)
  if (axisLengthSq < epsilon) return false

  const projections = triangle.map((point) => pointOnAxis(point, axis))
  const minProjection = Math.min(...projections)
  const maxProjection = Math.max(...projections)
  const boxRadius =
    halfSize.x * Math.abs(axis.x) +
    halfSize.y * Math.abs(axis.y) +
    halfSize.z * Math.abs(axis.z)

  return minProjection > boxRadius + epsilon || maxProjection < -boxRadius - epsilon
}

const planeSeparatesTriangleAndBox = (
  normal: Point3,
  pointOnPlane: Point3,
  halfSize: Point3,
) => {
  const radius =
    halfSize.x * Math.abs(normal.x) +
    halfSize.y * Math.abs(normal.y) +
    halfSize.z * Math.abs(normal.z)
  const distance = dot(normal, pointOnPlane)
  return distance > radius + epsilon || distance < -radius - epsilon
}

const triangleIntersectsVoxel = (
  triangle: MeshTriangle,
  minX: number,
  minY: number,
  minZ: number,
  voxelSize: number,
) => {
  const halfSize = {
    x: voxelSize / 2 - voxelBoundaryTolerance,
    y: voxelSize / 2 - voxelBoundaryTolerance,
    z: voxelSize / 2 - voxelBoundaryTolerance,
  }
  const center = {
    x: minX + voxelSize / 2,
    y: minY + voxelSize / 2,
    z: minZ + voxelSize / 2,
  }
  const shiftedTriangle = triangle.map((point) => subtract(point, center)) as MeshTriangle
  const edges = [
    subtract(shiftedTriangle[1], shiftedTriangle[0]),
    subtract(shiftedTriangle[2], shiftedTriangle[1]),
    subtract(shiftedTriangle[0], shiftedTriangle[2]),
  ]

  if (axisSeparatesTriangleAndBox({ x: 1, y: 0, z: 0 }, shiftedTriangle, halfSize)) return false
  if (axisSeparatesTriangleAndBox({ x: 0, y: 1, z: 0 }, shiftedTriangle, halfSize)) return false
  if (axisSeparatesTriangleAndBox({ x: 0, y: 0, z: 1 }, shiftedTriangle, halfSize)) return false

  const normal = cross(edges[0], edges[1])
  if (planeSeparatesTriangleAndBox(normal, shiftedTriangle[0], halfSize)) return false

  const boxAxes = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ]

  return !edges.some((edge) =>
    boxAxes.some((boxAxis) => axisSeparatesTriangleAndBox(cross(edge, boxAxis), shiftedTriangle, halfSize)),
  )
}

const voxelIntersectsMesh = (
  triangles: MeshTriangle[],
  minX: number,
  minY: number,
  minZ: number,
  voxelSize: number,
) =>
  triangles.some((triangle) => triangleIntersectsVoxel(triangle, minX, minY, minZ, voxelSize))

const insideRayDirections = [
  normalise({ x: 1, y: 0.017, z: 0.031 }),
  normalise({ x: 0.023, y: 1, z: 0.041 }),
  normalise({ x: 0.037, y: 0.029, z: 1 }),
]

const rayIntersectsTriangle = (origin: Point3, direction: Point3, triangle: MeshTriangle) => {
  const [v0, v1, v2] = triangle
  const edge1 = subtract(v1, v0)
  const edge2 = subtract(v2, v0)
  const h = cross(direction, edge2)
  const a = dot(edge1, h)
  if (Math.abs(a) < epsilon) return undefined

  const f = 1 / a
  const s = subtract(origin, v0)
  const u = f * dot(s, h)
  if (u < -epsilon || u > 1 + epsilon) return undefined

  const q = cross(s, edge1)
  const v = f * dot(direction, q)
  if (v < -epsilon || u + v > 1 + epsilon) return undefined

  const t = f * dot(edge2, q)
  return t > epsilon ? t : undefined
}

const pointIsInsideMeshForDirection = (point: Point3, direction: Point3, triangles: MeshTriangle[]) => {
  const hits = new Set<number>()

  for (const triangle of triangles) {
    const hitDistance = rayIntersectsTriangle(point, direction, triangle)
    if (hitDistance === undefined) continue
    hits.add(Math.round(hitDistance / epsilon))
  }

  return hits.size % 2 === 1
}

const pointIsInsideMesh = (point: Point3, triangles: MeshTriangle[]) => {
  let insideVotes = 0

  for (let index = 0; index < insideRayDirections.length; index += 1) {
    if (pointIsInsideMeshForDirection(point, insideRayDirections[index], triangles)) insideVotes += 1
    if (insideVotes >= 2) return true
    if (index + 1 - insideVotes >= 2) return false
  }

  return false
}

export const voxelizeMeshStructuralCells = ({
  minXStuds,
  maxXStuds,
  minYStuds,
  maxYStuds,
  minZStuds,
  maxZStuds,
  voxelSize,
  triangles,
}: VoxelizeMeshOptions): StructuralCell[] => {
  const gridMinX = snapGridBoundary(minXStuds, voxelSize, 'min')
  const gridMaxX = snapGridBoundary(maxXStuds, voxelSize, 'max')
  const gridMinY = snapGridBoundary(minYStuds, voxelSize, 'min')
  const gridMaxY = snapGridBoundary(maxYStuds, voxelSize, 'max')
  const gridMinZ = snapGridBoundary(minZStuds, voxelSize, 'min')
  const gridMaxZ = snapGridBoundary(maxZStuds, voxelSize, 'max')
  const xCount = Math.max(1, Math.round((gridMaxX - gridMinX) / voxelSize))
  const yCount = Math.max(1, Math.round((gridMaxY - gridMinY) / voxelSize))
  const zCount = Math.max(1, Math.round((gridMaxZ - gridMinZ) / voxelSize))
  const samples: VoxelSample[] = []

  for (let x = 0; x < xCount; x += 1) {
    for (let y = 0; y < yCount; y += 1) {
      for (let z = 0; z < zCount; z += 1) {
        const minX = gridMinX + x * voxelSize
        const minY = gridMinY + y * voxelSize
        const minZ = gridMinZ + z * voxelSize
        const center = {
          x: minX + voxelSize / 2,
          y: minY + voxelSize / 2,
          z: minZ + voxelSize / 2,
        }
        const centerIsInside = pointIsInsideMesh(center, triangles)

        samples.push({
          minX,
          minY,
          minZ,
          centerIsInside,
          surfaceIntersects: centerIsInside
            ? false
            : voxelIntersectsMesh(triangles, minX, minY, minZ, voxelSize),
        })
      }
    }
  }

  const sampleIndex = (x: number, y: number, z: number) =>
    (x * yCount + y) * zCount + z
  const interiorColumns = new Set<number>()
  samples.forEach((sample, index) => {
    if (!sample.centerIsInside) return
    const x = Math.floor(index / (yCount * zCount))
    const z = index % zCount
    interiorColumns.add(x * zCount + z)
  })
  const solidMask = samples.map((sample, index) => {
    const x = Math.floor(index / (yCount * zCount))
    const z = index % zCount
    // Center occupancy avoids doubling the vertical thickness of shallow curved
    // parts. Surface-only columns remain filled so sub-voxel bars and rims survive.
    return sample.centerIsInside || (
      sample.surfaceIntersects && !interiorColumns.has(x * zCount + z)
    )
  })
  const solidCount = solidMask.filter(Boolean).length
  const hasTouchingSolid = (x: number, y: number, z: number) => {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
          if (offsetX === 0 && offsetY === 0 && offsetZ === 0) continue
          const neighborX = x + offsetX
          const neighborY = y + offsetY
          const neighborZ = z + offsetZ
          if (
            neighborX < 0 || neighborX >= xCount ||
            neighborY < 0 || neighborY >= yCount ||
            neighborZ < 0 || neighborZ >= zCount
          ) continue
          if (solidMask[sampleIndex(neighborX, neighborY, neighborZ)]) return true
        }
      }
    }
    return false
  }

  return samples.map((sample, index) => {
    const x = Math.floor(index / (yCount * zCount))
    const remainder = index % (yCount * zCount)
    const y = Math.floor(remainder / zCount)
    const z = remainder % zCount
    // A lone voxel that does not even touch the rest of the part diagonally is a
    // ray/triangle precision artifact, not a usable collision island.
    const kind = solidMask[index] && (
      solidCount === 1 || hasTouchingSolid(x, y, z)
    )
      ? 'solid'
      : 'enterable'

    return makeCell(kind, sample.minX, sample.minY, sample.minZ, voxelSize)
  })
}
