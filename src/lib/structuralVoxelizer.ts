import type { StructuralCell, StructuralEntryDirection } from './structuralGrid'

type Point3 = {
  x: number
  y: number
  z: number
}

export type MeshTriangle = [Point3, Point3, Point3]

type VoxelizeMeshOptions = {
  widthStuds: number
  heightStuds: number
  depthStuds: number
  voxelSize: number
  triangles: MeshTriangle[]
}

const allEntryDirections: StructuralEntryDirection[] = ['top', 'bottom', 'left', 'right', 'front', 'back']
const epsilon = 0.000001
const voxelBoundaryTolerance = 0.00001

const round = (value: number) => Number(value.toFixed(6))

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
  widthStuds,
  heightStuds,
  depthStuds,
  voxelSize,
  triangles,
}: VoxelizeMeshOptions): StructuralCell[] => {
  const cells: StructuralCell[] = []
  const xCount = Math.max(1, Math.round(widthStuds / voxelSize))
  const yCount = Math.max(1, Math.round(heightStuds / voxelSize))
  const zCount = Math.max(1, Math.round(depthStuds / voxelSize))

  for (let x = 0; x < xCount; x += 1) {
    for (let y = 0; y < yCount; y += 1) {
      for (let z = 0; z < zCount; z += 1) {
        const minX = x * voxelSize
        const minY = y * voxelSize
        const minZ = z * voxelSize
        const center = {
          x: minX + voxelSize / 2,
          y: minY + voxelSize / 2,
          z: minZ + voxelSize / 2,
        }

        const kind =
          pointIsInsideMesh(center, triangles) ||
          voxelIntersectsMesh(triangles, minX, minY, minZ, voxelSize)
            ? 'solid'
            : 'enterable'

        cells.push(makeCell(kind, minX, minY, minZ, voxelSize))
      }
    }
  }

  return cells
}
