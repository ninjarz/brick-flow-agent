import { createBuildGraph } from './planUtils'
import {
  analyzeBuildStability,
  createConvexHull,
  getSignedDistanceToSupportHull,
  type StabilityAnalysis,
  type StabilityPoint2,
} from './stabilityAnalysis'
import type { PlacedBrick } from '../types/bricks'

export type DisasterScenario = 'wind' | 'rain' | 'earthquake'
export type DisasterPhysicsProfile = 'realistic' | 'challenge'

export type DisasterFailureMode =
  | 'shear'
  | 'overturn'
  | 'slip'
  | 'water-load'
  | 'rain-peel'
  | 'seismic-shear'
  | 'seismic-overturn'
  | 'ground-overturn'
  | 'detached'

export type DisasterSimulationOptions = {
  scenario: DisasterScenario
  intensity: number
  durationSeconds?: number
  directionDegrees?: number
  physicsProfile?: DisasterPhysicsProfile
}

export type StudContactPoint = {
  x: number
  z: number
  studId: string
}

export type AffineContactSolution = {
  reactions: number[]
  studReactionById: Map<string, number>
  totalReaction: number
  totalTension: number
  maxStudTension: number
  maxStudCompression: number
  compressionCenter: { x: number; z: number }
  forceResidual: number
  momentResidual: { x: number; z: number }
}

export type StudConnectionLoad = {
  verticalLoad: number
  verticalLoadCenter: { x: number; z: number }
  horizontalForce: { x: number; z: number }
  horizontalLoadCenter: { x: number; z: number }
  applicationHeight: number
}

export type StudConnectionSolution = {
  utilization: number
  tensionUtilization: number
  shearUtilization: number
  maxStudTension: number
  maxStudShear: number
  maxStudCompression: number
  controllingStudId?: string
  compressionCenter: { x: number; z: number }
  torsion: number
}

export type DisasterScoreBreakdown = {
  survival: number
  staticStability: number
  span: number
  materialEfficiency: number
}

export type DisasterLoadCalibration = {
  baseValue: number
  unit: 'm/s' | 'g' | 'mm'
  loadMultiplier: number
}

export type WindExposure = {
  projectedArea: number
  exposedArea: number
  exposedRatio: number
}

export type RainExposure = WindExposure

export type WindOcclusionField = {
  rayHitBrickIds: string[][]
  projectedSampleCountByBrickId: Map<string, number>
  projectedAreaByBrickId: Map<string, number>
}

export type RainOcclusionField = WindOcclusionField

export type DisasterFailureHinge = {
  pivot: { x: number; y: number; z: number }
  axis: { x: number; z: number }
}

export type DisasterSimulationResult = {
  options: Required<DisasterSimulationOptions>
  loadCalibration: DisasterLoadCalibration
  analysis: StabilityAnalysis
  failureTimeByBrickId: Map<string, number>
  failureModeByBrickId: Map<string, DisasterFailureMode>
  failureHingeByBrickId: Map<string, DisasterFailureHinge>
  peakStressByBrickId: Map<string, number>
  peakConnectionUtilizationByBrickId: Map<string, number>
  connectionUtilizationHistoryByBrickId: Map<string, Float32Array>
  governingFailureModeByBrickId: Map<string, DisasterFailureMode>
  windExposureByBrickId: Map<string, WindExposure>
  windOcclusionField?: WindOcclusionField
  rainExposureByBrickId: Map<string, RainExposure>
  rainOcclusionField?: RainOcclusionField
  maxFallByBrickId: Map<string, number>
  timeline: Array<{
    timeSeconds: number
    failedCount: number
    loadFactor: number
  }>
  simulationStepCount: number
  survivedBrickCount: number
  failedBrickCount: number
  score: number
  grade: 'S' | 'A' | 'B' | 'C' | 'D'
  scoreBreakdown: DisasterScoreBreakdown
}

export type DisasterSimulationWorkerRequest = {
  type: 'simulate'
  requestId: number
  bricks: PlacedBrick[]
  options: DisasterSimulationOptions
}

export type DisasterSimulationWorkerResponse =
  | { type: 'result'; requestId: number; result: DisasterSimulationResult }
  | { type: 'error'; requestId: number; message: string }

export type DisasterFrame = {
  timeSeconds: number
  loadFactor: number
  failedIds: Set<string>
  connectionUtilizationByBrickId: Map<string, number>
  windExposureByBrickId: Map<string, WindExposure>
  rainExposureByBrickId: Map<string, RainExposure>
  waterAccumulation: number
  offsetsByBrickId: Map<string, { x: number; y: number; z: number }>
  rotationsByBrickId: Map<string, DisasterFailureHinge & { angle: number }>
}

const defaultSimulationFrameCount = 90
const contactTolerance = 0.14
const disasterOcclusionSampleSize = 0.5
const epsilon = 0.000001
const studPitchMeters = 0.008
const waterDensityKilogramsPerCubicMeter = 1000
const gravityMetersPerSecondSquared = 9.80665
const estimatedMassKilogramsPerStudVolume = 0.00025
const studSeparationCapacityNewtons = 0.7
const studCompressionCapacityNewtons = 35
const studContactRadius = 0.22
const challengeWaterLoadMultiplier = 20
const airDensityKilogramsPerCubicMeter = 1.225
const windDragCoefficient = 1.2
const challengeWindLoadMultiplier = 2
const challengeEarthquakeLoadMultiplier = 5
const emptyContactReactions: number[] = []
const emptyStudReactionById = new Map<string, number>()
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

const getClosestPointOnSupportHull = (
  point: StabilityPoint2,
  hull: StabilityPoint2[],
) => {
  let closest = hull[0] ?? { x: point.x, z: point.z }
  let minimumDistanceSquared = Infinity
  for (let index = 0; index < hull.length; index += 1) {
    const source = hull[index]
    const target = hull[(index + 1) % hull.length]
    const dx = target.x - source.x
    const dz = target.z - source.z
    const lengthSquared = dx * dx + dz * dz
    const amount = lengthSquared <= epsilon
      ? 0
      : clamp(((point.x - source.x) * dx + (point.z - source.z) * dz) / lengthSquared)
    const candidate = { x: source.x + dx * amount, z: source.z + dz * amount }
    const distanceSquared = (point.x - candidate.x) ** 2 + (point.z - candidate.z) ** 2
    if (distanceSquared < minimumDistanceSquared) {
      minimumDistanceSquared = distanceSquared
      closest = candidate
    }
  }
  return closest
}

const getSimulationFrameCount = (brickCount: number) => {
  if (brickCount > 1000) return 48
  if (brickCount > 500) return 72
  return defaultSimulationFrameCount
}

type PreparedAffineContactGeometry = {
  points: StudContactPoint[]
  center: { x: number; z: number }
  inverseCovariance: { xx: number; xz: number; zz: number }
  studs: Array<{
    id: string
    count: number
    sumDx: number
    sumDz: number
    sumDx2: number
    sumDxDz: number
    sumDz2: number
    centerX: number
    centerZ: number
    contacts: Array<{ dx: number; dz: number }>
  }>
}

const prepareAffineContactGeometry = (
  points: StudContactPoint[],
): PreparedAffineContactGeometry | undefined => {
  if (points.length === 0) return undefined
  const center = points.reduce((result, point) => ({
    x: result.x + point.x / points.length,
    z: result.z + point.z / points.length,
  }), { x: 0, z: 0 })
  let xx = 0
  let xz = 0
  let zz = 0
  const studAccumulators = new Map<string, {
    count: number
    sumDx: number
    sumDz: number
    sumDx2: number
    sumDxDz: number
    sumDz2: number
    sumX: number
    sumZ: number
    contacts: Array<{ dx: number; dz: number }>
  }>()
  for (const point of points) {
    const dx = point.x - center.x
    const dz = point.z - center.z
    xx += dx * dx
    xz += dx * dz
    zz += dz * dz
    const stud = studAccumulators.get(point.studId) ?? {
      count: 0,
      sumDx: 0,
      sumDz: 0,
      sumDx2: 0,
      sumDxDz: 0,
      sumDz2: 0,
      sumX: 0,
      sumZ: 0,
      contacts: [],
    }
    stud.count += 1
    stud.sumDx += dx
    stud.sumDz += dz
    stud.sumDx2 += dx * dx
    stud.sumDxDz += dx * dz
    stud.sumDz2 += dz * dz
    stud.sumX += point.x
    stud.sumZ += point.z
    stud.contacts.push({ dx, dz })
    studAccumulators.set(point.studId, stud)
  }
  const determinant = xx * zz - xz * xz
  if (Math.abs(determinant) <= epsilon) return undefined
  return {
    points,
    center,
    inverseCovariance: {
      xx: zz / determinant,
      xz: -xz / determinant,
      zz: xx / determinant,
    },
    studs: [...studAccumulators].map(([id, stud]) => ({
      id,
      count: stud.count,
      sumDx: stud.sumDx,
      sumDz: stud.sumDz,
      sumDx2: stud.sumDx2,
      sumDxDz: stud.sumDxDz,
      sumDz2: stud.sumDz2,
      centerX: stud.sumX / stud.count,
      centerZ: stud.sumZ / stud.count,
      contacts: stud.contacts,
    })),
  }
}

const getAffineReactionField = (
  geometry: PreparedAffineContactGeometry,
  verticalLoad: number,
  targetMoment: { x: number; z: number },
) => {
  const load = Math.max(0, verticalLoad)
  return {
    load,
    baseReaction: load / geometry.points.length,
    slopeX: geometry.inverseCovariance.xx * targetMoment.x +
      geometry.inverseCovariance.xz * targetMoment.z,
    slopeZ: geometry.inverseCovariance.xz * targetMoment.x +
      geometry.inverseCovariance.zz * targetMoment.z,
  }
}

const solvePreparedAffineContactReactions = (
  geometry: PreparedAffineContactGeometry,
  verticalLoad: number,
  loadCenter: { x: number; z: number },
  includeContactReactions: boolean,
): AffineContactSolution => {
  const eccentricityX = loadCenter.x - geometry.center.x
  const eccentricityZ = loadCenter.z - geometry.center.z
  const targetMoment = {
    x: Math.max(0, verticalLoad) * eccentricityX,
    z: Math.max(0, verticalLoad) * eccentricityZ,
  }
  const { load, baseReaction, slopeX, slopeZ } = getAffineReactionField(
    geometry,
    verticalLoad,
    targetMoment,
  )
  const reactions = includeContactReactions
    ? geometry.points.map((point) => (
      baseReaction + slopeX * (point.x - geometry.center.x) + slopeZ * (point.z - geometry.center.z)
    ))
    : emptyContactReactions
  const studReactionById = includeContactReactions
    ? new Map<string, number>()
    : emptyStudReactionById
  let totalReaction = 0
  let totalTension = 0
  let maxStudTension = 0
  let maxStudCompression = 0
  let compressionAmount = 0
  let compressionMomentX = 0
  let compressionMomentZ = 0
  let reactionMomentX = 0
  let reactionMomentZ = 0
  for (const stud of geometry.studs) {
    let studReaction = 0
    let studTension = 0
    let studCompression = 0
    for (const contact of stud.contacts) {
      const reaction = baseReaction + slopeX * contact.dx + slopeZ * contact.dz
      studReaction += reaction
      if (reaction < 0) {
        studTension -= reaction
      } else {
        studCompression += reaction
        compressionAmount += reaction
        compressionMomentX += reaction * (geometry.center.x + contact.dx)
        compressionMomentZ += reaction * (geometry.center.z + contact.dz)
      }
    }
    if (includeContactReactions) studReactionById.set(stud.id, studReaction)
    totalReaction += studReaction
    reactionMomentX += baseReaction * stud.sumDx + slopeX * stud.sumDx2 + slopeZ * stud.sumDxDz
    reactionMomentZ += baseReaction * stud.sumDz + slopeX * stud.sumDxDz + slopeZ * stud.sumDz2
    totalTension += studTension
    maxStudTension = Math.max(maxStudTension, studTension)
    maxStudCompression = Math.max(maxStudCompression, studCompression)
  }

  return {
    reactions,
    studReactionById,
    totalReaction,
    totalTension,
    maxStudTension,
    maxStudCompression,
    compressionCenter: compressionAmount > epsilon
      ? { x: compressionMomentX / compressionAmount, z: compressionMomentZ / compressionAmount }
      : geometry.center,
    forceResidual: totalReaction - load,
    momentResidual: {
      x: reactionMomentX - targetMoment.x,
      z: reactionMomentZ - targetMoment.z,
    },
  }
}

const solvePreparedStudConnection = (
  geometry: PreparedAffineContactGeometry,
  load: StudConnectionLoad,
): StudConnectionSolution => {
  const targetMoment = {
    x: Math.max(0, load.verticalLoad) * (load.verticalLoadCenter.x - geometry.center.x) +
      load.horizontalForce.x * Math.max(0, load.applicationHeight),
    z: Math.max(0, load.verticalLoad) * (load.verticalLoadCenter.z - geometry.center.z) +
      load.horizontalForce.z * Math.max(0, load.applicationHeight),
  }
  const { baseReaction, slopeX, slopeZ } = getAffineReactionField(
    geometry,
    load.verticalLoad,
    targetMoment,
  )
  const torsion = (
    (load.horizontalLoadCenter.z - geometry.center.z) * load.horizontalForce.x -
    (load.horizontalLoadCenter.x - geometry.center.x) * load.horizontalForce.z
  )
  const torsionRadiusSquared = geometry.studs.reduce((sum, stud) => (
    sum + (stud.centerX - geometry.center.x) ** 2 + (stud.centerZ - geometry.center.z) ** 2
  ), 0)
  const torsionScale = Math.abs(torsionRadiusSquared) > epsilon
    ? torsion / torsionRadiusSquared
    : 0
  const uniformShearX = load.horizontalForce.x / geometry.studs.length
  const uniformShearZ = load.horizontalForce.z / geometry.studs.length
  let utilization = 0
  let tensionUtilization = 0
  let shearUtilization = 0
  let maxStudTension = 0
  let maxStudShear = 0
  let maxStudCompression = 0
  let controllingStudId: string | undefined
  let compressionAmount = 0
  let compressionMomentX = 0
  let compressionMomentZ = 0
  for (const stud of geometry.studs) {
    let tension = 0
    let compression = 0
    for (const contact of stud.contacts) {
      const reaction = baseReaction + slopeX * contact.dx + slopeZ * contact.dz
      if (reaction < 0) {
        tension -= reaction
      } else {
        compression += reaction
        compressionAmount += reaction
        compressionMomentX += reaction * (geometry.center.x + contact.dx)
        compressionMomentZ += reaction * (geometry.center.z + contact.dz)
      }
    }
    const dx = stud.centerX - geometry.center.x
    const dz = stud.centerZ - geometry.center.z
    const shearX = uniformShearX - torsionScale * dz
    const shearZ = uniformShearZ + torsionScale * dx
    const shear = Math.hypot(shearX, shearZ)
    const combinedUtilization = (tension + shear) / studSeparationCapacityNewtons
    if (combinedUtilization > utilization) {
      utilization = combinedUtilization
      controllingStudId = stud.id
    }
    tensionUtilization = Math.max(tensionUtilization, tension / studSeparationCapacityNewtons)
    shearUtilization = Math.max(shearUtilization, shear / studSeparationCapacityNewtons)
    maxStudTension = Math.max(maxStudTension, tension)
    maxStudShear = Math.max(maxStudShear, shear)
    maxStudCompression = Math.max(maxStudCompression, compression)
  }

  return {
    utilization,
    tensionUtilization,
    shearUtilization,
    maxStudTension,
    maxStudShear,
    maxStudCompression,
    controllingStudId,
    compressionCenter: compressionAmount > epsilon
      ? { x: compressionMomentX / compressionAmount, z: compressionMomentZ / compressionAmount }
      : geometry.center,
    torsion,
  }
}

/**
 * Closed-form vertical specialization of the affine contact-force fields used by
 * force-equilibrium brick solvers. Positive reactions are compression; negative
 * reactions are snap-fit tension that can peel a stud connection apart.
 */
export const solveAffineContactReactions = (
  points: StudContactPoint[],
  verticalLoad: number,
  loadCenter: { x: number; z: number },
): AffineContactSolution | undefined => {
  const geometry = prepareAffineContactGeometry(points)
  return geometry
    ? solvePreparedAffineContactReactions(geometry, verticalLoad, loadCenter, true)
    : undefined
}

export const solveStudConnection = (
  points: StudContactPoint[],
  load: StudConnectionLoad,
): StudConnectionSolution | undefined => {
  const geometry = prepareAffineContactGeometry(points)
  return geometry ? solvePreparedStudConnection(geometry, load) : undefined
}

const hashUnit = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0xffffffff
}

const getDynamicLoadFactor = (
  scenario: DisasterScenario,
  timeSeconds: number,
  durationSeconds: number,
) => {
  const progress = clamp(timeSeconds / durationSeconds)
  const ramp = Math.min(1, progress * 3)
  if (scenario === 'wind') return ramp * (0.62 + Math.sin(progress * Math.PI * 8) * 0.16 + Math.sin(progress * Math.PI * 23) * 0.11)
  if (scenario === 'rain') return ramp * (0.74 + progress * 0.2 + Math.sin(progress * Math.PI * 11) * 0.06)
  return ramp * (0.38 + Math.abs(Math.sin(progress * Math.PI * 13)) * 0.54 + Math.abs(Math.sin(progress * Math.PI * 29)) * 0.08)
}

const getGrade = (score: number): DisasterSimulationResult['grade'] => {
  if (score >= 90) return 'S'
  if (score >= 78) return 'A'
  if (score >= 64) return 'B'
  if (score >= 48) return 'C'
  return 'D'
}

type WindBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

type WindProjection = {
  brickId: string
  bounds: WindBounds
  minCrosswind: number
  maxCrosswind: number
  projectedArea: number
}

const getBoundsProjectionRange = (
  bounds: WindBounds,
  axis: { x: number; z: number },
) => {
  const values = [
    bounds.minX * axis.x + bounds.minZ * axis.z,
    bounds.minX * axis.x + bounds.maxZ * axis.z,
    bounds.maxX * axis.x + bounds.minZ * axis.z,
    bounds.maxX * axis.x + bounds.maxZ * axis.z,
  ]
  return { min: Math.min(...values), max: Math.max(...values) }
}

const getHorizontalRayEntryDistance = (
  origin: { x: number; z: number },
  direction: { x: number; z: number },
  bounds: WindBounds,
) => {
  let minDistance = -Infinity
  let maxDistance = Infinity

  for (const axis of ['x', 'z'] as const) {
    if (Math.abs(direction[axis]) <= epsilon) {
      if (origin[axis] < bounds[`min${axis.toUpperCase()}` as 'minX' | 'minZ'] - epsilon ||
        origin[axis] > bounds[`max${axis.toUpperCase()}` as 'maxX' | 'maxZ'] + epsilon) return undefined
      continue
    }

    const min = bounds[`min${axis.toUpperCase()}` as 'minX' | 'minZ']
    const max = bounds[`max${axis.toUpperCase()}` as 'maxX' | 'maxZ']
    const first = (min - origin[axis]) / direction[axis]
    const second = (max - origin[axis]) / direction[axis]
    minDistance = Math.max(minDistance, Math.min(first, second))
    maxDistance = Math.min(maxDistance, Math.max(first, second))
    if (maxDistance < minDistance - epsilon) return undefined
  }

  if (maxDistance < -epsilon) return undefined
  return Math.max(0, minDistance)
}

const createWindOcclusionField = (
  boundsById: Map<string, WindBounds>,
  windDirection: { x: number; z: number },
) => {
  const crosswind = { x: -windDirection.z, z: windDirection.x }
  const projections: WindProjection[] = [...boundsById].map(([brickId, bounds]) => {
    const range = getBoundsProjectionRange(bounds, crosswind)
    return {
      brickId,
      bounds,
      minCrosswind: range.min,
      maxCrosswind: range.max,
      projectedArea: Math.max(epsilon, range.max - range.min) * Math.max(epsilon, bounds.maxY - bounds.minY),
    }
  })
  if (projections.length === 0) {
    return {
      rayHitBrickIds: [],
      projectedSampleCountByBrickId: new Map<string, number>(),
      projectedAreaByBrickId: new Map<string, number>(),
    } satisfies WindOcclusionField
  }

  const minimumWindDepth = Math.min(
    0,
    ...projections.map(({ bounds }) => getBoundsProjectionRange(bounds, windDirection).min),
  ) - 1
  const minimumCrosswind = Math.min(...projections.map((projection) => projection.minCrosswind))
  const maximumCrosswind = Math.max(...projections.map((projection) => projection.maxCrosswind))
  const minimumY = Math.min(...projections.map(({ bounds }) => bounds.minY))
  const maximumY = Math.max(...projections.map(({ bounds }) => bounds.maxY))
  const crosswindSpan = Math.max(epsilon, maximumCrosswind - minimumCrosswind)
  const height = Math.max(epsilon, maximumY - minimumY)
  const crosswindSamples = Math.max(1, Math.ceil(crosswindSpan / disasterOcclusionSampleSize))
  const verticalSamples = Math.max(1, Math.ceil(height / disasterOcclusionSampleSize))
  const rayHitBrickIds: string[][] = []
  const projectedSampleCountByBrickId = new Map(projections.map(({ brickId }) => [brickId, 0]))
  const projectedAreaByBrickId = new Map(projections.map(({ brickId, projectedArea }) => [brickId, projectedArea]))

  const addRay = (crosswindPosition: number, y: number) => {
    const origin = {
      x: windDirection.x * minimumWindDepth + crosswind.x * crosswindPosition,
      z: windDirection.z * minimumWindDepth + crosswind.z * crosswindPosition,
    }
    const hits = projections.flatMap((candidate) => {
      if (crosswindPosition <= candidate.minCrosswind + epsilon ||
        crosswindPosition >= candidate.maxCrosswind - epsilon ||
        y < candidate.bounds.minY + epsilon ||
        y > candidate.bounds.maxY - epsilon) return []
      const distance = getHorizontalRayEntryDistance(origin, windDirection, candidate.bounds)
      return distance === undefined ? [] : [{ brickId: candidate.brickId, distance }]
    }).sort((source, target) => source.distance - target.distance)
    if (hits.length === 0) return

    const hitBrickIds = hits.map(({ brickId }) => brickId)
    hitBrickIds.forEach((brickId) => {
      projectedSampleCountByBrickId.set(brickId, (projectedSampleCountByBrickId.get(brickId) ?? 0) + 1)
    })
    rayHitBrickIds.push(hitBrickIds)
  }

  for (let crosswindIndex = 0; crosswindIndex < crosswindSamples; crosswindIndex += 1) {
    const crosswindPosition = minimumCrosswind + crosswindSpan * (crosswindIndex + 0.5) / crosswindSamples
    for (let verticalIndex = 0; verticalIndex < verticalSamples; verticalIndex += 1) {
      const y = minimumY + height * (verticalIndex + 0.5) / verticalSamples
      addRay(crosswindPosition, y)
    }
  }

  for (const projection of projections) {
    if ((projectedSampleCountByBrickId.get(projection.brickId) ?? 0) > 0) continue
    addRay(
      (projection.minCrosswind + projection.maxCrosswind) / 2,
      (projection.bounds.minY + projection.bounds.maxY) / 2,
    )
  }

  return { rayHitBrickIds, projectedSampleCountByBrickId, projectedAreaByBrickId }
}

const getExposureFromField = (
  field: WindOcclusionField,
  failedIds: Set<string>,
) => {
  const exposedSampleCountByBrickId = new Map<string, number>()
  for (const rayHitBrickIds of field.rayHitBrickIds) {
    const exposedBrickId = rayHitBrickIds.find((brickId) => !failedIds.has(brickId))
    if (!exposedBrickId) continue
    exposedSampleCountByBrickId.set(
      exposedBrickId,
      (exposedSampleCountByBrickId.get(exposedBrickId) ?? 0) + 1,
    )
  }

  return new Map([...field.projectedAreaByBrickId].map(([brickId, projectedArea]) => {
    const projectedSampleCount = field.projectedSampleCountByBrickId.get(brickId) ?? 0
    const exposedSampleCount = exposedSampleCountByBrickId.get(brickId) ?? 0
    const exposedRatio = projectedSampleCount > 0 ? exposedSampleCount / projectedSampleCount : 1
    return [brickId, {
      projectedArea,
      exposedArea: projectedArea * exposedRatio,
      exposedRatio,
    }] as const
  }))
}

const createDynamicExposureTracker = (
  field: WindOcclusionField,
) => {
  const failedIds = new Set<string>()
  const activeHitIndexByRay = new Int32Array(field.rayHitBrickIds.length)
  const activeRayIndicesByBrickId = new Map<string, Set<number>>()
  const exposedSampleCountByBrickId = new Map<string, number>()
  const exposureByBrickId = new Map<string, WindExposure>(
    [...field.projectedAreaByBrickId].map(([brickId, projectedArea]) => [
      brickId,
      { projectedArea, exposedArea: 0, exposedRatio: 0 },
    ]),
  )

  const updateExposure = (brickId: string) => {
    const exposure = exposureByBrickId.get(brickId)
    if (!exposure) return
    const projectedSampleCount = field.projectedSampleCountByBrickId.get(brickId) ?? 0
    const exposedSampleCount = exposedSampleCountByBrickId.get(brickId) ?? 0
    const exposedRatio = projectedSampleCount > 0 ? exposedSampleCount / projectedSampleCount : 1
    exposure.exposedRatio = exposedRatio
    exposure.exposedArea = exposure.projectedArea * exposedRatio
  }

  field.rayHitBrickIds.forEach((rayHitBrickIds, rayIndex) => {
    const brickId = rayHitBrickIds[0]
    if (!brickId) return
    const rayIndices = activeRayIndicesByBrickId.get(brickId) ?? new Set<number>()
    rayIndices.add(rayIndex)
    activeRayIndicesByBrickId.set(brickId, rayIndices)
    exposedSampleCountByBrickId.set(brickId, (exposedSampleCountByBrickId.get(brickId) ?? 0) + 1)
  })
  for (const brickId of exposureByBrickId.keys()) updateExposure(brickId)

  return {
    exposureByBrickId,
    update(nextFailedIds: Set<string>) {
      const newlyFailedIds = [...nextFailedIds].filter((brickId) => !failedIds.has(brickId))
      newlyFailedIds.forEach((brickId) => failedIds.add(brickId))
      const changedBrickIds = new Set<string>()
      for (const failedBrickId of newlyFailedIds) {
        const rayIndices = activeRayIndicesByBrickId.get(failedBrickId)
        if (!rayIndices) continue
        activeRayIndicesByBrickId.delete(failedBrickId)
        exposedSampleCountByBrickId.set(
          failedBrickId,
          Math.max(0, (exposedSampleCountByBrickId.get(failedBrickId) ?? 0) - rayIndices.size),
        )
        changedBrickIds.add(failedBrickId)
        for (const rayIndex of rayIndices) {
          const rayHitBrickIds = field.rayHitBrickIds[rayIndex]
          let hitIndex = activeHitIndexByRay[rayIndex] + 1
          while (hitIndex < rayHitBrickIds.length && failedIds.has(rayHitBrickIds[hitIndex])) hitIndex += 1
          activeHitIndexByRay[rayIndex] = hitIndex
          const exposedBrickId = rayHitBrickIds[hitIndex]
          if (!exposedBrickId) continue
          const exposedRayIndices = activeRayIndicesByBrickId.get(exposedBrickId) ?? new Set<number>()
          exposedRayIndices.add(rayIndex)
          activeRayIndicesByBrickId.set(exposedBrickId, exposedRayIndices)
          exposedSampleCountByBrickId.set(
            exposedBrickId,
            (exposedSampleCountByBrickId.get(exposedBrickId) ?? 0) + 1,
          )
          changedBrickIds.add(exposedBrickId)
        }
      }
      changedBrickIds.forEach(updateExposure)
      return exposureByBrickId
    },
  }
}

const createRainOcclusionField = (
  boundsById: Map<string, WindBounds>,
) => {
  const projections = [...boundsById].map(([brickId, bounds]) => ({
    brickId,
    bounds,
    projectedArea: Math.max(epsilon, bounds.maxX - bounds.minX) *
      Math.max(epsilon, bounds.maxZ - bounds.minZ),
  }))
  if (projections.length === 0) {
    return {
      rayHitBrickIds: [],
      projectedSampleCountByBrickId: new Map<string, number>(),
      projectedAreaByBrickId: new Map<string, number>(),
    } satisfies RainOcclusionField
  }

  const minimumX = Math.min(...projections.map(({ bounds }) => bounds.minX))
  const maximumX = Math.max(...projections.map(({ bounds }) => bounds.maxX))
  const minimumZ = Math.min(...projections.map(({ bounds }) => bounds.minZ))
  const maximumZ = Math.max(...projections.map(({ bounds }) => bounds.maxZ))
  const width = Math.max(epsilon, maximumX - minimumX)
  const depth = Math.max(epsilon, maximumZ - minimumZ)
  const xSamples = Math.max(1, Math.ceil(width / disasterOcclusionSampleSize))
  const zSamples = Math.max(1, Math.ceil(depth / disasterOcclusionSampleSize))
  const rayHitBrickIds: string[][] = []
  const projectedSampleCountByBrickId = new Map(projections.map(({ brickId }) => [brickId, 0]))
  const projectedAreaByBrickId = new Map(projections.map(({ brickId, projectedArea }) => [brickId, projectedArea]))

  const addRay = (x: number, z: number) => {
    const hits = projections
      .filter(({ bounds }) => (
        x > bounds.minX + epsilon && x < bounds.maxX - epsilon &&
        z > bounds.minZ + epsilon && z < bounds.maxZ - epsilon
      ))
      .sort((source, target) => target.bounds.maxY - source.bounds.maxY)
    if (hits.length === 0) return

    const hitBrickIds = hits.map(({ brickId }) => brickId)
    hitBrickIds.forEach((brickId) => {
      projectedSampleCountByBrickId.set(brickId, (projectedSampleCountByBrickId.get(brickId) ?? 0) + 1)
    })
    rayHitBrickIds.push(hitBrickIds)
  }

  for (let xIndex = 0; xIndex < xSamples; xIndex += 1) {
    const x = minimumX + width * (xIndex + 0.5) / xSamples
    for (let zIndex = 0; zIndex < zSamples; zIndex += 1) {
      const z = minimumZ + depth * (zIndex + 0.5) / zSamples
      addRay(x, z)
    }
  }

  for (const projection of projections) {
    if ((projectedSampleCountByBrickId.get(projection.brickId) ?? 0) > 0) continue
    addRay(
      (projection.bounds.minX + projection.bounds.maxX) / 2,
      (projection.bounds.minZ + projection.bounds.maxZ) / 2,
    )
  }

  return { rayHitBrickIds, projectedSampleCountByBrickId, projectedAreaByBrickId }
}

const getWaterAccumulation = (
  timeSeconds: number,
  durationSeconds: number,
  intensity: number,
) => clamp(timeSeconds / durationSeconds) * (0.3 + intensity * 0.7)

const getRainPondingDepthMeters = (
  intensity: number,
  waterAccumulation: number,
) => waterAccumulation * (0.002 + 0.028 * Math.pow(intensity, 1.5))

const getWindSpeedMetersPerSecond = (intensity: number) => 3 + 27 * intensity

const getPeakGroundAccelerationG = (intensity: number) => 0.05 + 1.95 * intensity

const getLoadMultiplier = (
  scenario: DisasterScenario,
  physicsProfile: DisasterPhysicsProfile,
) => {
  if (physicsProfile === 'realistic') return 1
  if (scenario === 'rain') return challengeWaterLoadMultiplier
  if (scenario === 'wind') return challengeWindLoadMultiplier
  return challengeEarthquakeLoadMultiplier
}

const getLoadCalibration = (
  scenario: DisasterScenario,
  intensity: number,
  physicsProfile: DisasterPhysicsProfile,
): DisasterLoadCalibration => {
  const loadMultiplier = getLoadMultiplier(scenario, physicsProfile)
  if (scenario === 'wind') {
    return { baseValue: getWindSpeedMetersPerSecond(intensity), unit: 'm/s', loadMultiplier }
  }
  if (scenario === 'earthquake') {
    return { baseValue: getPeakGroundAccelerationG(intensity), unit: 'g', loadMultiplier }
  }
  return {
    baseValue: getRainPondingDepthMeters(intensity, 0.3 + intensity * 0.7) * 1000,
    unit: 'mm',
    loadMultiplier,
  }
}

const createStudContactPoints = (
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  supportId: string,
) => {
  const width = Math.max(epsilon, maxX - minX)
  const depth = Math.max(epsilon, maxZ - minZ)
  const xStudCount = Math.max(1, Math.round(width))
  const zStudCount = Math.max(1, Math.round(depth))
  const contactOffsetX = Math.min(studContactRadius, width / xStudCount * 0.28)
  const contactOffsetZ = Math.min(studContactRadius, depth / zStudCount * 0.28)
  const points: StudContactPoint[] = []
  for (let xIndex = 0; xIndex < xStudCount; xIndex += 1) {
    const x = minX + width * (xIndex + 0.5) / xStudCount
    for (let zIndex = 0; zIndex < zStudCount; zIndex += 1) {
      const z = minZ + depth * (zIndex + 0.5) / zStudCount
      const studId = `${supportId}:${xIndex}:${zIndex}`
      points.push(
        { x: x - contactOffsetX, z: z - contactOffsetZ, studId },
        { x: x + contactOffsetX, z: z - contactOffsetZ, studId },
        { x: x + contactOffsetX, z: z + contactOffsetZ, studId },
        { x: x - contactOffsetX, z: z + contactOffsetZ, studId },
      )
    }
  }
  return points
}

export const runDisasterSimulation = (
  bricks: PlacedBrick[],
  options: DisasterSimulationOptions,
): DisasterSimulationResult => {
  const resolvedOptions: Required<DisasterSimulationOptions> = {
    scenario: options.scenario,
    intensity: Math.min(100, Math.max(0, options.intensity)),
    durationSeconds: Math.min(30, Math.max(3, options.durationSeconds ?? 9)),
    directionDegrees: options.directionDegrees ?? 25,
    physicsProfile: options.physicsProfile ?? 'challenge',
  }
  const intensity = resolvedOptions.intensity / 100
  const windRadians = resolvedOptions.directionDegrees * Math.PI / 180
  const windDirection = { x: Math.cos(windRadians), z: Math.sin(windRadians) }
  const graph = createBuildGraph(bricks)
  const analysis = analyzeBuildStability(bricks, graph)
  const windOcclusionField = resolvedOptions.scenario === 'wind'
    ? createWindOcclusionField(graph.boundsById, windDirection)
    : undefined
  const windExposureByBrickId = windOcclusionField
    ? getExposureFromField(windOcclusionField, new Set())
    : new Map<string, WindExposure>()
  const rainOcclusionField = resolvedOptions.scenario === 'rain'
    ? createRainOcclusionField(graph.boundsById)
    : undefined
  const rainExposureByBrickId = rainOcclusionField
    ? getExposureFromField(rainOcclusionField, new Set())
    : new Map<string, RainExposure>()
  const windExposureTracker = windOcclusionField
    ? createDynamicExposureTracker(windOcclusionField)
    : undefined
  const rainExposureTracker = rainOcclusionField
    ? createDynamicExposureTracker(rainOcclusionField)
    : undefined
  const rootIds = new Set([...graph.boundsById]
    .filter(([, bounds]) => Math.abs(bounds.minY) <= contactTolerance)
    .map(([brickId]) => brickId))
  const prepared = bricks.flatMap((brick) => {
    const bounds = graph.boundsById.get(brick.id)
    const stability = analysis.riskByBrickId.get(brick.id)
    if (!bounds || !stability) return []
    const width = Math.max(epsilon, bounds.maxX - bounds.minX)
    const height = Math.max(epsilon, bounds.maxY - bounds.minY)
    const depth = Math.max(epsilon, bounds.maxZ - bounds.minZ)
    const topArea = width * depth
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2
    const centerZ = (bounds.minZ + bounds.maxZ) / 2
    const rootBoost = rootIds.has(brick.id) ? 2 : 0
    const connectionCapacity = (
      0.9 + stability.connectionCount * 0.7 + stability.supportCoverage * 1.8 + rootBoost
    ) * (0.7 + Math.pow(stability.mass, 0.35))
    const massKilograms = stability.mass * estimatedMassKilogramsPerStudVolume
    const weightNewtons = massKilograms * gravityMetersPerSecondSquared
    return [{ brick, bounds, stability, width, height, depth, topArea, centerX, centerY, centerZ, connectionCapacity, massKilograms, weightNewtons }]
  })
  const preparedById = new Map(prepared.map((item) => [item.brick.id, item]))
  const seismicLoadOrder = [...prepared].sort((source, target) => target.centerY - source.centerY)
  const verticalSupportsByBrickId = new Map(prepared.map((item) => [
    item.brick.id,
    [...(graph.attachmentEdges.get(item.brick.id) ?? [])].flatMap((supportId) => {
      const support = preparedById.get(supportId)
      if (!support || support.centerY >= item.centerY) return []
      if (Math.abs(support.bounds.maxY - item.bounds.minY) > contactTolerance) return []
      const minX = Math.max(item.bounds.minX, support.bounds.minX)
      const maxX = Math.min(item.bounds.maxX, support.bounds.maxX)
      const minZ = Math.max(item.bounds.minZ, support.bounds.minZ)
      const maxZ = Math.min(item.bounds.maxZ, support.bounds.maxZ)
      const overlapArea = Math.max(0, maxX - minX) * Math.max(0, maxZ - minZ)
      return overlapArea > epsilon ? [{
        support,
        overlapArea,
        minX,
        maxX,
        minZ,
        maxZ,
        contactPoints: createStudContactPoints(minX, maxX, minZ, maxZ, support.brick.id),
      }] : []
    }),
  ]))
  const defaultContactGeometryByBrickId = new Map([...verticalSupportsByBrickId].map(([brickId, supports]) => [
    brickId,
    prepareAffineContactGeometry(supports.flatMap(({ contactPoints }) => contactPoints)),
  ]))
  const contactGeometryCache = new Map<string, PreparedAffineContactGeometry | undefined>()
  const getLiveContactGeometry = (
    brickId: string,
    failedIds: Set<string>,
  ) => {
    const allSupports = verticalSupportsByBrickId.get(brickId) ?? []
    if (allSupports.length === 0) return undefined
    if (failedIds.size === 0 || !allSupports.some(({ support }) => failedIds.has(support.brick.id))) {
      return defaultContactGeometryByBrickId.get(brickId)
    }
    const supports = allSupports.filter(({ support }) => !failedIds.has(support.brick.id))
    const cacheKey = `${brickId}:${supports.map(({ support }) => support.brick.id).join(',')}`
    if (contactGeometryCache.has(cacheKey)) {
      return contactGeometryCache.get(cacheKey)
    }
    const geometry = prepareAffineContactGeometry(supports.flatMap(({ contactPoints }) => contactPoints))
    contactGeometryCache.set(cacheKey, geometry)
    return geometry
  }
  const createTransferredLoadByBrickId = (
    failedIds: Set<string>,
    directLoadByBrickId: Map<string, number>,
  ) => {
    const loads = new Map(prepared
      .filter(({ brick }) => !failedIds.has(brick.id))
      .map((item) => [item.brick.id, {
        amount: directLoadByBrickId.get(item.brick.id) ?? 0,
        momentX: item.centerX * (directLoadByBrickId.get(item.brick.id) ?? 0),
        momentY: item.centerY * (directLoadByBrickId.get(item.brick.id) ?? 0),
        momentZ: item.centerZ * (directLoadByBrickId.get(item.brick.id) ?? 0),
      }]))

    for (const item of seismicLoadOrder) {
      if (failedIds.has(item.brick.id)) continue
      const load = loads.get(item.brick.id)
      if (!load || load.amount <= epsilon) continue
      const supports = (verticalSupportsByBrickId.get(item.brick.id) ?? [])
        .filter(({ support }) => !failedIds.has(support.brick.id))
      const totalOverlapArea = supports.reduce((sum, support) => sum + support.overlapArea, 0)
      if (totalOverlapArea <= epsilon) continue

      for (const { support, overlapArea } of supports) {
        const share = overlapArea / totalOverlapArea
        const supportLoad = loads.get(support.brick.id)
        if (!supportLoad) continue
        supportLoad.amount += load.amount * share
        supportLoad.momentX += load.momentX * share
        supportLoad.momentY += load.momentY * share
        supportLoad.momentZ += load.momentZ * share
      }
    }

    return loads
  }
  let groundComponentFailureCount = -1
  let cachedGroundComponents: Array<{ brickIds: string[]; supportHull: StabilityPoint2[] }> = []
  const getGroundOverturnFailures = (
    failedIds: Set<string>,
    verticalLoadByBrickId: Map<string, number>,
  ) => {
    if (groundComponentFailureCount !== failedIds.size) {
      const visited = new Set<string>()
      const components: typeof cachedGroundComponents = []
      for (const start of prepared) {
        if (failedIds.has(start.brick.id) || visited.has(start.brick.id)) continue
        const brickIds: string[] = []
        const queue = [start.brick.id]
        visited.add(start.brick.id)
        for (let index = 0; index < queue.length; index += 1) {
          const brickId = queue[index]
          brickIds.push(brickId)
          for (const targetId of graph.attachmentEdges.get(brickId) ?? []) {
            if (failedIds.has(targetId) || visited.has(targetId)) continue
            visited.add(targetId)
            queue.push(targetId)
          }
        }

        const groundedItems = brickIds
          .filter((brickId) => rootIds.has(brickId))
          .map((brickId) => preparedById.get(brickId))
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
        if (groundedItems.length === 0) continue
        const supportHull = createConvexHull(groundedItems.flatMap(({ bounds }) => [
          { x: bounds.minX, z: bounds.minZ },
          { x: bounds.maxX, z: bounds.minZ },
          { x: bounds.maxX, z: bounds.maxZ },
          { x: bounds.minX, z: bounds.maxZ },
        ]))
        if (supportHull.length > 0) components.push({ brickIds, supportHull })
      }
      cachedGroundComponents = components
      groundComponentFailureCount = failedIds.size
    }

    const failures: Array<{
      brickIds: string[]
      hinge: DisasterFailureHinge
    }> = []
    for (const { brickIds, supportHull } of cachedGroundComponents) {
      let verticalLoad = 0
      let verticalMomentX = 0
      let verticalMomentZ = 0
      for (const brickId of brickIds) {
        const item = preparedById.get(brickId)
        if (!item) continue
        const itemVerticalLoad = verticalLoadByBrickId.get(brickId) ?? item.weightNewtons
        verticalLoad += itemVerticalLoad
        verticalMomentX += itemVerticalLoad * item.centerX
        verticalMomentZ += itemVerticalLoad * item.centerZ
      }
      if (verticalLoad <= epsilon) continue

      const effectiveLoadPoint = {
        x: verticalMomentX / verticalLoad,
        z: verticalMomentZ / verticalLoad,
      }
      if (getSignedDistanceToSupportHull(effectiveLoadPoint, supportHull) >= -0.02) continue

      const pivot = getClosestPointOnSupportHull(effectiveLoadPoint, supportHull)
      const outwardX = effectiveLoadPoint.x - pivot.x
      const outwardZ = effectiveLoadPoint.z - pivot.z
      const outwardLength = Math.max(epsilon, Math.hypot(outwardX, outwardZ))
      failures.push({
        brickIds,
        hinge: {
          pivot: { ...pivot, y: 0 },
          axis: {
            x: outwardZ / outwardLength,
            z: -outwardX / outwardLength,
          },
        },
      })
    }

    return failures
  }
  const failureTimeByBrickId = new Map<string, number>()
  const failureModeByBrickId = new Map<string, DisasterFailureMode>()
  const failureHingeByBrickId = new Map<string, DisasterFailureHinge>()
  const peakStressByBrickId = new Map<string, number>()
  const peakConnectionUtilizationByBrickId = new Map<string, number>()
  const maxFallByBrickId = new Map(prepared.map(({ brick, bounds }) => [brick.id, Math.max(0, bounds.minY)]))
  const timeline: DisasterSimulationResult['timeline'] = []
  const simulationFrameCount = getSimulationFrameCount(prepared.length)
  const connectionUtilizationHistoryByBrickId = new Map(prepared.map(({ brick }) => [
    brick.id,
    new Float32Array(simulationFrameCount + 1),
  ]))
  const governingFailureModeByBrickId = new Map<string, DisasterFailureMode>()

  const markDisconnectedBricks = (timeSeconds: number) => {
    const reachable = new Set<string>()
    const queue = [...rootIds].filter((brickId) => !failureTimeByBrickId.has(brickId))
    queue.forEach((brickId) => reachable.add(brickId))
    for (let index = 0; index < queue.length; index += 1) {
      for (const targetId of graph.attachmentEdges.get(queue[index]) ?? []) {
        if (failureTimeByBrickId.has(targetId) || reachable.has(targetId)) continue
        reachable.add(targetId)
        queue.push(targetId)
      }
    }
    const detachedIds = new Set(prepared
      .map(({ brick }) => brick.id)
      .filter((brickId) => !reachable.has(brickId) && !failureTimeByBrickId.has(brickId)))
    const visitedDetachedIds = new Set<string>()
    for (const startId of detachedIds) {
      if (visitedDetachedIds.has(startId)) continue
      const component: string[] = []
      const componentQueue = [startId]
      visitedDetachedIds.add(startId)
      for (let index = 0; index < componentQueue.length; index += 1) {
        const brickId = componentQueue[index]
        component.push(brickId)
        for (const targetId of graph.attachmentEdges.get(brickId) ?? []) {
          if (!detachedIds.has(targetId) || visitedDetachedIds.has(targetId)) continue
          visitedDetachedIds.add(targetId)
          componentQueue.push(targetId)
        }
      }
      const hingeSource = component.flatMap((brickId) => (
        [...(graph.attachmentEdges.get(brickId) ?? [])]
          .filter((targetId) => failureHingeByBrickId.has(targetId))
      )).sort((source, target) => (
        (failureTimeByBrickId.get(source) ?? Infinity) - (failureTimeByBrickId.get(target) ?? Infinity)
      ))[0]
      const inheritedHinge = hingeSource ? failureHingeByBrickId.get(hingeSource) : undefined
      for (const brickId of component) {
        failureTimeByBrickId.set(brickId, timeSeconds)
        failureModeByBrickId.set(brickId, 'detached')
        if (inheritedHinge) failureHingeByBrickId.set(brickId, inheritedHinge)
      }
    }
  }

  let exposureFailureCount = 0
  let cachedFrameWindExposure = windExposureTracker?.exposureByBrickId ?? windExposureByBrickId
  let cachedFrameRainExposure = rainExposureTracker?.exposureByBrickId ?? rainExposureByBrickId
  const directWeightByBrickId = new Map(prepared.map((item) => [item.brick.id, item.weightNewtons]))
  const directMassByBrickId = new Map(prepared.map((item) => [item.brick.id, item.massKilograms]))
  let transferredLoadFailureCount = -1
  let cachedFrameGravityLoads: ReturnType<typeof createTransferredLoadByBrickId> | undefined
  let cachedFrameWindDirectLoads: Map<string, number> | undefined
  let cachedFrameWindLoads: ReturnType<typeof createTransferredLoadByBrickId> | undefined
  let cachedFrameSeismicLoads: ReturnType<typeof createTransferredLoadByBrickId> | undefined
  for (let frameIndex = 0; frameIndex <= simulationFrameCount; frameIndex += 1) {
    if (frameIndex > 0) {
      for (const history of connectionUtilizationHistoryByBrickId.values()) {
        history[frameIndex] = history[frameIndex - 1]
      }
    }
    const connectionFailureCandidates: Array<{
      brickId: string
      failureMode: DisasterFailureMode
      stress: number
      threshold: number
      hinge?: DisasterFailureHinge
    }> = []
    const timeSeconds = resolvedOptions.durationSeconds * frameIndex / simulationFrameCount
    const loadFactor = getDynamicLoadFactor(resolvedOptions.scenario, timeSeconds, resolvedOptions.durationSeconds)
    const failedIds = new Set(failureTimeByBrickId.keys())
    if (failedIds.size !== exposureFailureCount) {
      if (windExposureTracker) cachedFrameWindExposure = windExposureTracker.update(failedIds)
      if (rainExposureTracker) cachedFrameRainExposure = rainExposureTracker.update(failedIds)
      exposureFailureCount = failedIds.size
    }
    const frameWindExposure = cachedFrameWindExposure
    const frameRainExposure = cachedFrameRainExposure
    const waterAccumulation = getWaterAccumulation(
      timeSeconds,
      resolvedOptions.durationSeconds,
      intensity,
    )
    if (failedIds.size !== transferredLoadFailureCount) {
      cachedFrameGravityLoads = resolvedOptions.scenario !== 'rain'
        ? createTransferredLoadByBrickId(failedIds, directWeightByBrickId)
        : undefined
      cachedFrameWindDirectLoads = resolvedOptions.scenario === 'wind'
        ? new Map(prepared.map((item) => {
          const exposedArea = frameWindExposure.get(item.brick.id)?.exposedArea ?? 0
          const windSpeed = getWindSpeedMetersPerSecond(intensity)
          const forceNewtons = 0.5 * airDensityKilogramsPerCubicMeter * windDragCoefficient *
            exposedArea * studPitchMeters ** 2 * windSpeed ** 2 *
            getLoadMultiplier('wind', resolvedOptions.physicsProfile)
          return [item.brick.id, forceNewtons]
        }))
        : undefined
      cachedFrameWindLoads = cachedFrameWindDirectLoads
        ? createTransferredLoadByBrickId(failedIds, cachedFrameWindDirectLoads)
        : undefined
      cachedFrameSeismicLoads = resolvedOptions.scenario === 'earthquake'
        ? createTransferredLoadByBrickId(failedIds, directMassByBrickId)
        : undefined
      transferredLoadFailureCount = failedIds.size
    }
    const frameGravityLoads = cachedFrameGravityLoads
    const frameWindDirectLoads = cachedFrameWindDirectLoads
    const frameWindLoads = cachedFrameWindLoads
    const frameRainDirectLoads = resolvedOptions.scenario === 'rain'
      ? new Map(prepared.map((item) => {
        const exposure = frameRainExposure.get(item.brick.id)
        const exposedArea = exposure?.exposedArea ?? item.topArea
        const pondingDepthMeters = getRainPondingDepthMeters(intensity, waterAccumulation)
        const waterLoadMultiplier = getLoadMultiplier('rain', resolvedOptions.physicsProfile)
        const waterLoadNewtons = waterDensityKilogramsPerCubicMeter * gravityMetersPerSecondSquared *
          pondingDepthMeters * exposedArea * studPitchMeters ** 2 * waterLoadMultiplier
        const directLoad = item.weightNewtons + waterLoadNewtons * loadFactor
        return [item.brick.id, directLoad]
      }))
      : undefined
    const frameRainLoads = frameRainDirectLoads
      ? createTransferredLoadByBrickId(failedIds, frameRainDirectLoads)
      : undefined
    const frameSeismicLoads = cachedFrameSeismicLoads

    for (const item of prepared) {
      if (failureTimeByBrickId.has(item.brick.id)) continue
      const riskBias = item.stability.risk * (0.28 + intensity * 0.72)
      let appliedRiskBias = riskBias
      let loadStress = 0
      let failureMode: DisasterFailureMode
      let failureHinge: DisasterFailureHinge | undefined
      if (resolvedOptions.scenario === 'wind') {
        appliedRiskBias = 0
        const exposedArea = frameWindExposure.get(item.brick.id)?.exposedArea ?? 0
        const windLoad = frameWindLoads?.get(item.brick.id)
        const gravityLoad = frameGravityLoads?.get(item.brick.id)
        const force = (windLoad?.amount ?? frameWindDirectLoads?.get(item.brick.id) ?? 0) * loadFactor
        const verticalLoad = gravityLoad?.amount ?? item.weightNewtons
        const geometry = getLiveContactGeometry(item.brick.id, failedIds)
        const windLoadCenter = windLoad && windLoad.amount > epsilon
          ? {
            x: windLoad.momentX / windLoad.amount,
            y: windLoad.momentY / windLoad.amount,
            z: windLoad.momentZ / windLoad.amount,
          }
          : { x: item.centerX, y: item.centerY, z: item.centerZ }
        const verticalLoadCenter = gravityLoad && verticalLoad > epsilon
          ? { x: gravityLoad.momentX / verticalLoad, z: gravityLoad.momentZ / verticalLoad }
          : { x: item.centerX, z: item.centerZ }
        const connectionSolution = geometry
          ? solvePreparedStudConnection(geometry, {
            verticalLoad,
            verticalLoadCenter,
            horizontalForce: { x: windDirection.x * force, z: windDirection.z * force },
            horizontalLoadCenter: windLoadCenter,
            applicationHeight: Math.max(item.height / 2, windLoadCenter.y - item.bounds.minY),
          })
          : undefined
        if (connectionSolution) {
          loadStress = connectionSolution.utilization
          failureMode = connectionSolution.tensionUtilization > connectionSolution.shearUtilization
            ? 'overturn'
            : 'shear'
          if (failureMode === 'overturn') {
            failureHinge = {
              pivot: { ...connectionSolution.compressionCenter, y: item.bounds.minY },
              axis: { x: windDirection.z, z: -windDirection.x },
            }
          }
        } else if (!rootIds.has(item.brick.id)) {
          const legacyForce = exposedArea * (0.2 + 2.15 * intensity ** 2)
          const shearResistance = item.connectionCapacity * (0.78 + item.stability.supportCoverage * 0.62)
          const shearStress = legacyForce * loadFactor / Math.max(epsilon, shearResistance)
          const baseSpanAlongWind = Math.abs(windDirection.x) * item.width + Math.abs(windDirection.z) * item.depth
          const overturnResistance = item.connectionCapacity * Math.max(0.2, baseSpanAlongWind / 2) *
            (0.48 + item.stability.supportCoverage * 0.92)
          const pressureCenterHeight = Math.max(item.height / 2, item.centerY)
          const overturnStress = legacyForce * loadFactor * pressureCenterHeight / Math.max(epsilon, overturnResistance)
          loadStress = Math.max(shearStress, overturnStress)
          failureMode = overturnStress > shearStress ? 'overturn' : 'shear'
          appliedRiskBias = riskBias
        } else {
          failureMode = 'shear'
        }
      } else if (resolvedOptions.scenario === 'rain') {
        appliedRiskBias = 0
        const rainLoad = frameRainLoads?.get(item.brick.id)
        const demand = rainLoad?.amount ?? frameRainDirectLoads?.get(item.brick.id) ?? 0
        const loadCenterX = rainLoad && demand > epsilon ? rainLoad.momentX / demand : item.centerX
        const loadCenterZ = rainLoad && demand > epsilon ? rainLoad.momentZ / demand : item.centerZ
        const geometry = getLiveContactGeometry(item.brick.id, failedIds)
        const contactSolution = geometry
          ? solvePreparedStudConnection(geometry, {
            verticalLoad: demand,
            verticalLoadCenter: { x: loadCenterX, z: loadCenterZ },
            horizontalForce: { x: 0, z: 0 },
            horizontalLoadCenter: { x: loadCenterX, z: loadCenterZ },
            applicationHeight: 0,
          })
          : undefined
        const peelUtilization = contactSolution?.tensionUtilization ?? 0
        const compressionUtilization = (contactSolution?.maxStudCompression ?? 0) /
          studCompressionCapacityNewtons
        loadStress = Math.max(peelUtilization, compressionUtilization)
        failureMode = peelUtilization >= compressionUtilization
          ? 'rain-peel'
          : 'water-load'
        const supportCenterX = geometry?.center.x ?? item.centerX
        const supportCenterZ = geometry?.center.z ?? item.centerZ
        const leverX = loadCenterX - supportCenterX
        const leverZ = loadCenterZ - supportCenterZ
        if (loadStress >= 0.94 + hashUnit(item.brick.id) * 0.18 && failureMode === 'rain-peel') {
          const axisLength = Math.max(epsilon, Math.hypot(leverZ, -leverX))
          failureHinge = {
            pivot: {
              x: contactSolution?.compressionCenter.x ?? supportCenterX,
              y: item.bounds.minY,
              z: contactSolution?.compressionCenter.z ?? supportCenterZ,
            },
            axis: { x: leverZ / axisLength, z: -leverX / axisLength },
          }
        }
      } else {
        appliedRiskBias = 0
        const seismicLoad = frameSeismicLoads?.get(item.brick.id)
        const gravityLoad = frameGravityLoads?.get(item.brick.id)
        const transmittedMass = seismicLoad?.amount ?? item.massKilograms
        const force = transmittedMass * gravityMetersPerSecondSquared *
          getPeakGroundAccelerationG(intensity) *
          getLoadMultiplier('earthquake', resolvedOptions.physicsProfile) * loadFactor
        const tributaryCenter = seismicLoad && transmittedMass > epsilon
          ? {
            x: seismicLoad.momentX / transmittedMass,
            y: seismicLoad.momentY / transmittedMass,
            z: seismicLoad.momentZ / transmittedMass,
          }
          : { x: item.centerX, y: item.centerY, z: item.centerZ }
        const verticalLoad = gravityLoad?.amount ?? item.weightNewtons
        const verticalLoadCenter = gravityLoad && verticalLoad > epsilon
          ? { x: gravityLoad.momentX / verticalLoad, z: gravityLoad.momentZ / verticalLoad }
          : { x: item.centerX, z: item.centerZ }
        const geometry = getLiveContactGeometry(item.brick.id, failedIds)
        const connectionSolution = geometry
          ? solvePreparedStudConnection(geometry, {
            verticalLoad,
            verticalLoadCenter,
            horizontalForce: { x: windDirection.x * force, z: windDirection.z * force },
            horizontalLoadCenter: tributaryCenter,
            applicationHeight: Math.max(item.height / 2, tributaryCenter.y - item.bounds.minY),
          })
          : undefined
        if (connectionSolution) {
          loadStress = connectionSolution.utilization
          failureMode = connectionSolution.tensionUtilization > connectionSolution.shearUtilization
            ? 'seismic-overturn'
            : 'seismic-shear'
          if (failureMode === 'seismic-overturn') {
            failureHinge = {
              pivot: { ...connectionSolution.compressionCenter, y: item.bounds.minY },
              axis: { x: windDirection.z, z: -windDirection.x },
            }
          }
        } else if (!rootIds.has(item.brick.id)) {
          const legacyForce = (seismicLoad?.amount ?? item.stability.mass) * (0.12 + 1.35 * intensity)
          const shearResistance = item.connectionCapacity * (0.82 + item.stability.supportCoverage * 0.58)
          const shearStress = legacyForce * loadFactor / Math.max(epsilon, shearResistance)
          const heightLever = Math.max(item.height / 2, tributaryCenter.y - item.bounds.minY)
          const baseSpanAlongShake = Math.abs(windDirection.x) * item.width + Math.abs(windDirection.z) * item.depth
          const overturnResistance = item.connectionCapacity * Math.max(0.2, baseSpanAlongShake / 2) *
            (0.52 + item.stability.supportCoverage * 0.9)
          const overturnStress = legacyForce * loadFactor * heightLever / Math.max(epsilon, overturnResistance)
          loadStress = Math.max(shearStress, overturnStress)
          failureMode = overturnStress > shearStress ? 'seismic-overturn' : 'seismic-shear'
          appliedRiskBias = riskBias
        } else {
          failureMode = 'seismic-shear'
        }
      }
      const stress = loadStress + appliedRiskBias
      connectionUtilizationHistoryByBrickId.get(item.brick.id)![frameIndex] = loadStress
      if (loadStress > (peakConnectionUtilizationByBrickId.get(item.brick.id) ?? 0)) {
        peakConnectionUtilizationByBrickId.set(item.brick.id, loadStress)
        governingFailureModeByBrickId.set(item.brick.id, failureMode)
      }
      peakStressByBrickId.set(item.brick.id, Math.max(peakStressByBrickId.get(item.brick.id) ?? 0, stress))
      const deterministicTolerance = 0.94 + hashUnit(item.brick.id) * 0.18
      if (stress >= deterministicTolerance) {
        connectionFailureCandidates.push({
          brickId: item.brick.id,
          failureMode,
          stress,
          threshold: deterministicTolerance,
          hinge: failureHinge,
        })
      }
    }

    const groundOverturnFailures = getGroundOverturnFailures(
      failedIds,
      frameRainDirectLoads ?? directWeightByBrickId,
    )
    for (const failure of groundOverturnFailures) {
      for (const brickId of failure.brickIds) {
        if (failureTimeByBrickId.has(brickId)) continue
        failureTimeByBrickId.set(brickId, timeSeconds)
        failureModeByBrickId.set(brickId, 'ground-overturn')
        failureHingeByBrickId.set(brickId, failure.hinge)
      }
    }

    const liveConnectionFailureCandidates = connectionFailureCandidates
      .filter((candidate) => !failureTimeByBrickId.has(candidate.brickId))
    if (liveConnectionFailureCandidates.length > 0) {
      const failure = liveConnectionFailureCandidates.reduce((mostOverloaded, candidate) => (
        candidate.stress / candidate.threshold > mostOverloaded.stress / mostOverloaded.threshold
          ? candidate
          : mostOverloaded
      ))
      failureTimeByBrickId.set(failure.brickId, timeSeconds)
      failureModeByBrickId.set(failure.brickId, failure.failureMode)
      if (failure.hinge) failureHingeByBrickId.set(failure.brickId, failure.hinge)
    }

    markDisconnectedBricks(timeSeconds)
    timeline.push({ timeSeconds, failedCount: failureTimeByBrickId.size, loadFactor })
  }

  const failedMass = [...failureTimeByBrickId].reduce((sum, [brickId]) => (
    sum + (analysis.riskByBrickId.get(brickId)?.mass ?? 0)
  ), 0)
  const survivalRatio = analysis.totalMass <= epsilon ? 0 : clamp(1 - failedMass / analysis.totalMass)
  const survival = Math.round(survivalRatio * 100)
  const staticStability = analysis.stabilityScore
  const span = Math.round(clamp(analysis.modelSpan / 16) * 100)
  const materialEfficiency = Math.round(clamp(
    0.25 + analysis.modelSpan / Math.max(2, Math.sqrt(analysis.totalMass)) * 0.22,
  ) * 100)
  const scoreBreakdown = { survival, staticStability, span, materialEfficiency }
  const score = Math.round(
    survival * 0.55 + staticStability * 0.2 + span * 0.15 + materialEfficiency * 0.1,
  )

  return {
    options: resolvedOptions,
    loadCalibration: getLoadCalibration(
      resolvedOptions.scenario,
      intensity,
      resolvedOptions.physicsProfile,
    ),
    analysis,
    failureTimeByBrickId,
    failureModeByBrickId,
    failureHingeByBrickId,
    peakStressByBrickId,
    peakConnectionUtilizationByBrickId,
    connectionUtilizationHistoryByBrickId,
    governingFailureModeByBrickId,
    windExposureByBrickId,
    windOcclusionField,
    rainExposureByBrickId,
    rainOcclusionField,
    maxFallByBrickId,
    timeline,
    simulationStepCount: simulationFrameCount,
    survivedBrickCount: Math.max(0, prepared.length - failureTimeByBrickId.size),
    failedBrickCount: failureTimeByBrickId.size,
    score,
    grade: getGrade(score),
    scoreBreakdown,
  }
}

export const getDisasterFrame = (
  result: DisasterSimulationResult,
  timeSeconds: number,
): DisasterFrame => {
  const resolvedTime = Math.min(result.options.durationSeconds, Math.max(0, timeSeconds))
  const loadFactor = getDynamicLoadFactor(result.options.scenario, resolvedTime, result.options.durationSeconds)
  const radians = result.options.directionDegrees * Math.PI / 180
  const direction = { x: Math.cos(radians), z: Math.sin(radians) }
  const intensity = result.options.intensity / 100
  const failedIds = new Set<string>()
  const connectionUtilizationByBrickId = new Map<string, number>()
  const offsetsByBrickId = new Map<string, { x: number; y: number; z: number }>()
  const rotationsByBrickId = new Map<string, DisasterFailureHinge & { angle: number }>()

  for (const [brickId] of result.analysis.riskByBrickId) {
    const failureTime = result.failureTimeByBrickId.get(brickId)
    if (failureTime !== undefined && failureTime <= resolvedTime) failedIds.add(brickId)
  }
  const simulationStep = result.options.durationSeconds <= epsilon
    ? 0
    : resolvedTime / result.options.durationSeconds * result.simulationStepCount
  const lowerStep = Math.min(result.simulationStepCount, Math.floor(simulationStep))
  const upperStep = Math.min(result.simulationStepCount, lowerStep + 1)
  const interpolation = simulationStep - lowerStep
  for (const [brickId, history] of result.connectionUtilizationHistoryByBrickId) {
    const lowerValue = history[lowerStep] ?? 0
    const upperValue = history[upperStep] ?? lowerValue
    connectionUtilizationByBrickId.set(
      brickId,
      lowerValue + (upperValue - lowerValue) * interpolation,
    )
  }
  const windExposureByBrickId = result.windOcclusionField
    ? getExposureFromField(result.windOcclusionField, failedIds)
    : result.windExposureByBrickId
  const rainExposureByBrickId = result.rainOcclusionField
    ? getExposureFromField(result.rainOcclusionField, failedIds)
    : result.rainExposureByBrickId
  const waterAccumulation = result.options.scenario === 'rain'
    ? getWaterAccumulation(resolvedTime, result.options.durationSeconds, intensity)
    : 0

  for (const [brickId, stability] of result.analysis.riskByBrickId) {
    const failureTime = result.failureTimeByBrickId.get(brickId)
    if (failureTime !== undefined && failureTime <= resolvedTime) {
      const age = resolvedTime - failureTime
      const hinge = result.failureHingeByBrickId.get(brickId)
      if (hinge) {
        const hingeProgress = clamp(age / 0.9)
        const releaseAge = Math.max(0, age - 1.05)
        rotationsByBrickId.set(brickId, {
          ...hinge,
          angle: hingeProgress * hingeProgress * Math.PI * 0.47,
        })
        offsetsByBrickId.set(brickId, {
          x: 0,
          y: -Math.min(Math.max(0, hinge.pivot.y), 4.9 * releaseAge * releaseAge),
          z: 0,
        })
        continue
      }
      const fall = Math.min(result.maxFallByBrickId.get(brickId) ?? 0, 4.9 * age * age)
      const drift = Math.min(6, age * age * (0.18 + intensity * 0.65))
      const earthquakeSign = hashUnit(brickId) > 0.5 ? 1 : -1
      offsetsByBrickId.set(brickId, {
        x: result.options.scenario === 'earthquake' ? drift * earthquakeSign : direction.x * drift,
        y: -fall,
        z: result.options.scenario === 'earthquake' ? direction.z * drift * -earthquakeSign : direction.z * drift,
      })
      continue
    }

    const windExposureRatio = windExposureByBrickId.get(brickId)?.exposedRatio ?? 1
    const elasticAmount = intensity * loadFactor * stability.heightRatio * (
      result.options.scenario === 'wind' ? windExposureRatio : 1
    )
    if (result.options.scenario === 'wind') {
      offsetsByBrickId.set(brickId, { x: direction.x * elasticAmount * 0.055, y: 0, z: direction.z * elasticAmount * 0.055 })
    } else if (result.options.scenario === 'earthquake') {
      const shake = Math.sin(resolvedTime * 13 + hashUnit(brickId) * 2) * elasticAmount * 0.065
      offsetsByBrickId.set(brickId, { x: shake, y: 0, z: shake * 0.55 })
    }
  }

  return {
    timeSeconds: resolvedTime,
    loadFactor,
    failedIds,
    connectionUtilizationByBrickId,
    windExposureByBrickId,
    rainExposureByBrickId,
    waterAccumulation,
    offsetsByBrickId,
    rotationsByBrickId,
  }
}
