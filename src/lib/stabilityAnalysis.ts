import { createBuildGraph, type BuildGraph } from './planUtils'
import type { PlacedBrick } from '../types/bricks'

export type StabilityPoint2 = {
  x: number
  z: number
}

export type StabilityPoint3 = StabilityPoint2 & {
  y: number
}

export type StabilityRiskLevel = 'stable' | 'watch' | 'critical' | 'detached'

export type BrickStability = {
  brickId: string
  mass: number
  center: StabilityPoint3
  grounded: boolean
  connectionCount: number
  supportCoverage: number
  heightRatio: number
  risk: number
  riskLevel: StabilityRiskLevel
  reasons: Array<'detached' | 'cantilever' | 'single-connection' | 'high-load' | 'high-center'>
}

export type StabilityAnalysis = {
  totalMass: number
  centerOfMass: StabilityPoint3
  supportHull: StabilityPoint2[]
  supportArea: number
  modelHeight: number
  modelSpan: number
  tippingMargin: number
  groundedMassRatio: number
  connectionRedundancy: number
  averageSupportCoverage: number
  stabilityScore: number
  riskByBrickId: Map<string, BrickStability>
  criticalBrickIds: string[]
}

const contactTolerance = 0.14
const epsilon = 0.000001

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

const cross = (origin: StabilityPoint2, source: StabilityPoint2, target: StabilityPoint2) =>
  (source.x - origin.x) * (target.z - origin.z) - (source.z - origin.z) * (target.x - origin.x)

export const createConvexHull = (points: StabilityPoint2[]): StabilityPoint2[] => {
  const sorted = [...new Map(points.map((point) => [`${point.x}:${point.z}`, point])).values()]
    .sort((source, target) => source.x - target.x || source.z - target.z)

  if (sorted.length <= 2) return sorted

  const lower: StabilityPoint2[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop()
    lower.push(point)
  }

  const upper: StabilityPoint2[] = []
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop()
    upper.push(point)
  }

  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

const polygonArea = (points: StabilityPoint2[]) => {
  if (points.length < 3) return 0
  return Math.abs(points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]
    return area + point.x * next.z - next.x * point.z
  }, 0)) / 2
}

const distanceToSegment = (point: StabilityPoint2, source: StabilityPoint2, target: StabilityPoint2) => {
  const dx = target.x - source.x
  const dz = target.z - source.z
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= epsilon) return Math.hypot(point.x - source.x, point.z - source.z)
  const amount = clamp(((point.x - source.x) * dx + (point.z - source.z) * dz) / lengthSquared)
  return Math.hypot(point.x - (source.x + dx * amount), point.z - (source.z + dz * amount))
}

const pointIsInsidePolygon = (point: StabilityPoint2, polygon: StabilityPoint2[]) => {
  if (polygon.length < 3) return false
  let inside = false
  for (let sourceIndex = 0, targetIndex = polygon.length - 1; sourceIndex < polygon.length; targetIndex = sourceIndex++) {
    const source = polygon[sourceIndex]
    const target = polygon[targetIndex]
    const crossesRay = (source.z > point.z) !== (target.z > point.z) &&
      point.x < ((target.x - source.x) * (point.z - source.z)) / (target.z - source.z) + source.x
    if (crossesRay) inside = !inside
  }
  return inside
}

const signedDistanceToHull = (point: StabilityPoint2, hull: StabilityPoint2[]) => {
  if (hull.length === 0) return -1
  if (hull.length === 1) return -Math.hypot(point.x - hull[0].x, point.z - hull[0].z)
  const distance = Math.min(...hull.map((source, index) => (
    distanceToSegment(point, source, hull[(index + 1) % hull.length])
  )))
  return pointIsInsidePolygon(point, hull) ? distance : -distance
}

const overlapLength = (sourceMin: number, sourceMax: number, targetMin: number, targetMax: number) =>
  Math.max(0, Math.min(sourceMax, targetMax) - Math.max(sourceMin, targetMin))

const getSupportCoverage = (
  brickId: string,
  graph: BuildGraph,
) => {
  const bounds = graph.boundsById.get(brickId)
  if (!bounds) return 0
  if (Math.abs(bounds.minY) <= contactTolerance) return 1

  const baseArea = Math.max(epsilon, (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ))
  let supportArea = 0

  for (const candidateId of graph.attachmentEdges.get(brickId) ?? []) {
    const candidate = graph.boundsById.get(candidateId)
    if (!candidate || Math.abs(candidate.maxY - bounds.minY) > contactTolerance) continue
    supportArea += overlapLength(bounds.minX, bounds.maxX, candidate.minX, candidate.maxX) *
      overlapLength(bounds.minZ, bounds.maxZ, candidate.minZ, candidate.maxZ)
  }

  return clamp(supportArea / baseArea)
}

const getRiskLevel = (risk: number, grounded: boolean): StabilityRiskLevel => {
  if (!grounded) return 'detached'
  if (risk >= 0.67) return 'critical'
  if (risk >= 0.36) return 'watch'
  return 'stable'
}

export const getStabilityRiskColor = (risk: number, grounded = true) => {
  if (!grounded) return '#7f1d1d'
  if (risk >= 0.72) return '#ef4444'
  if (risk >= 0.46) return '#f97316'
  if (risk >= 0.24) return '#facc15'
  return '#22c55e'
}

export const analyzeBuildStability = (bricks: PlacedBrick[]): StabilityAnalysis => {
  const graph = createBuildGraph(bricks)
  const measured = bricks.flatMap((brick) => {
    const bounds = graph.boundsById.get(brick.id)
    if (!bounds) return []
    const width = Math.max(epsilon, bounds.maxX - bounds.minX)
    const height = Math.max(epsilon, bounds.maxY - bounds.minY)
    const depth = Math.max(epsilon, bounds.maxZ - bounds.minZ)
    return [{
      brick,
      bounds,
      mass: Math.max(0.05, width * height * depth),
      center: {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
        z: (bounds.minZ + bounds.maxZ) / 2,
      },
    }]
  })

  if (measured.length === 0) {
    return {
      totalMass: 0,
      centerOfMass: { x: 0, y: 0, z: 0 },
      supportHull: [],
      supportArea: 0,
      modelHeight: 0,
      modelSpan: 0,
      tippingMargin: -1,
      groundedMassRatio: 0,
      connectionRedundancy: 0,
      averageSupportCoverage: 0,
      stabilityScore: 0,
      riskByBrickId: new Map(),
      criticalBrickIds: [],
    }
  }

  const totalMass = measured.reduce((sum, item) => sum + item.mass, 0)
  const centerOfMass = measured.reduce<StabilityPoint3>((center, item) => ({
    x: center.x + item.center.x * item.mass / totalMass,
    y: center.y + item.center.y * item.mass / totalMass,
    z: center.z + item.center.z * item.mass / totalMass,
  }), { x: 0, y: 0, z: 0 })
  const minX = Math.min(...measured.map(({ bounds }) => bounds.minX))
  const maxX = Math.max(...measured.map(({ bounds }) => bounds.maxX))
  const minY = Math.min(...measured.map(({ bounds }) => bounds.minY))
  const maxY = Math.max(...measured.map(({ bounds }) => bounds.maxY))
  const minZ = Math.min(...measured.map(({ bounds }) => bounds.minZ))
  const maxZ = Math.max(...measured.map(({ bounds }) => bounds.maxZ))
  const modelHeight = Math.max(epsilon, maxY - Math.min(0, minY))
  const modelSpan = Math.max(maxX - minX, maxZ - minZ)
  const groundCorners = measured.flatMap(({ brick, bounds }) => {
    if (!graph.groundedIds.has(brick.id) || Math.abs(bounds.minY) > contactTolerance) return []
    return [
      { x: bounds.minX, z: bounds.minZ },
      { x: bounds.maxX, z: bounds.minZ },
      { x: bounds.maxX, z: bounds.maxZ },
      { x: bounds.minX, z: bounds.maxZ },
    ]
  })
  const supportHull = createConvexHull(groundCorners)
  const supportArea = polygonArea(supportHull)
  const hullScale = Math.max(1, Math.sqrt(Math.max(epsilon, supportArea)), modelSpan * 0.25)
  const tippingMargin = signedDistanceToHull(centerOfMass, supportHull) / hullScale
  const groundedMass = measured.reduce((sum, item) => (
    sum + (graph.groundedIds.has(item.brick.id) ? item.mass : 0)
  ), 0)
  const groundedMassRatio = clamp(groundedMass / totalMass)
  const elevated = measured.filter(({ bounds }) => bounds.minY > contactTolerance)
  const redundantCount = elevated.filter(({ brick }) => (graph.attachmentEdges.get(brick.id)?.size ?? 0) >= 2).length
  const connectionRedundancy = elevated.length === 0 ? 1 : redundantCount / elevated.length

  const riskByBrickId = new Map<string, BrickStability>()
  let weightedCoverage = 0
  for (const item of measured) {
    const grounded = graph.groundedIds.has(item.brick.id)
    const connectionCount = graph.attachmentEdges.get(item.brick.id)?.size ?? 0
    const supportCoverage = getSupportCoverage(item.brick.id, graph)
    const heightRatio = clamp(item.center.y / modelHeight)
    const massAbove = measured.reduce((sum, candidate) => {
      if (candidate.center.y <= item.center.y + epsilon) return sum
      const overlapX = overlapLength(item.bounds.minX, item.bounds.maxX, candidate.bounds.minX, candidate.bounds.maxX)
      const overlapZ = overlapLength(item.bounds.minZ, item.bounds.maxZ, candidate.bounds.minZ, candidate.bounds.maxZ)
      return sum + (overlapX > 0 && overlapZ > 0 ? candidate.mass : 0)
    }, 0)
    const loadRatio = clamp(massAbove / Math.max(item.mass * 5, epsilon))
    const cantileverRisk = 1 - supportCoverage
    const connectionRisk = item.bounds.minY > contactTolerance && connectionCount <= 1 ? 1 : 0
    const globalTippingRisk = clamp(-tippingMargin * 2.2)
    const risk = grounded
      ? clamp(cantileverRisk * 0.48 + connectionRisk * 0.18 + loadRatio * 0.16 + heightRatio * 0.1 + globalTippingRisk * 0.32)
      : 1
    const reasons: BrickStability['reasons'] = []
    if (!grounded) reasons.push('detached')
    if (cantileverRisk >= 0.45) reasons.push('cantilever')
    if (connectionRisk > 0) reasons.push('single-connection')
    if (loadRatio >= 0.55) reasons.push('high-load')
    if (heightRatio >= 0.75 && risk >= 0.3) reasons.push('high-center')

    weightedCoverage += supportCoverage * item.mass
    riskByBrickId.set(item.brick.id, {
      brickId: item.brick.id,
      mass: item.mass,
      center: item.center,
      grounded,
      connectionCount,
      supportCoverage,
      heightRatio,
      risk,
      riskLevel: getRiskLevel(risk, grounded),
      reasons,
    })
  }

  const averageSupportCoverage = clamp(weightedCoverage / totalMass)
  const marginScore = clamp(0.55 + tippingMargin * 2.4)
  const stabilityScore = Math.round(100 * (
    groundedMassRatio * 0.3 +
    marginScore * 0.3 +
    averageSupportCoverage * 0.25 +
    connectionRedundancy * 0.15
  ))
  const criticalBrickIds = [...riskByBrickId.values()]
    .filter((item) => item.riskLevel === 'critical' || item.riskLevel === 'detached')
    .sort((source, target) => target.risk - source.risk)
    .map((item) => item.brickId)

  return {
    totalMass,
    centerOfMass,
    supportHull,
    supportArea,
    modelHeight,
    modelSpan,
    tippingMargin,
    groundedMassRatio,
    connectionRedundancy,
    averageSupportCoverage,
    stabilityScore,
    riskByBrickId,
    criticalBrickIds,
  }
}
