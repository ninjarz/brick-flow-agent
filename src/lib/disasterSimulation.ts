import { createBuildGraph } from './planUtils'
import { getDisasterMassProperties, gravity, prepareDisasterContacts, studPulloutNewtons } from './disasterContacts'
import { addDisasterWrench, createDisasterLoadPaths, createDisasterWrench, resolveDisasterSupports } from './disasterLoadPaths'
import { createProjectedSpatialIndex } from './projectedSpatialIndex'
import {
  analyzeBuildStability,
  getSignedDistanceToSupportHull,
  type StabilityAnalysis,
  type StabilityPoint2,
} from './stabilityAnalysis'
import type { PlacedBrick } from '../types/bricks'
import type { EditorAnalysisRequest } from './editorAnalysisProtocol'

export type DisasterScenario = 'wind' | 'rain' | 'earthquake'
export type DisasterPhysicsProfile = 'realistic' | 'challenge'
export type DisasterGroundCondition = 'surface' | 'anchored'
export const disasterSolverRevision = 2

export type DisasterFailureMode =
  | 'shear'
  | 'overturn'
  | 'slip'
  | 'water-load'
  | 'rain-peel'
  | 'seismic-shear'
  | 'seismic-overturn'
  | 'ground-overturn'
  | 'gravity-connection'
  | 'detached'

export type DisasterSimulationOptions = {
  scenario: DisasterScenario
  intensity: number
  durationSeconds?: number
  directionDegrees?: number
  physicsProfile?: DisasterPhysicsProfile
  groundCondition?: DisasterGroundCondition
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
  initialStaticFailureCount: number
  initialBrokenConnectionCount: number
  brokenConnectionCount: number
  modelMassKilograms: number
  unresolvedConnectionBrickIds: string[]
  slidingRiskBrickCount: number
  survivedBrickCount: number
  failedBrickCount: number
  firstFailureTimeSeconds?: number
  firstFailureBrickId?: string
  firstHazardFailureTimeSeconds?: number
  firstHazardFailureBrickId?: string
  peakLoadTimeSeconds: number
  score: number
  grade: 'S' | 'A' | 'B' | 'C' | 'D'
  scoreBreakdown: DisasterScoreBreakdown
}

export type DisasterSimulationWorkerRequest = {
  type: 'simulate'
  requestId: number
  options: DisasterSimulationOptions
} & ({ bricks: PlacedBrick[]; geometry: EditorAnalysisRequest['geometry'] } | { bricks?: never; geometry?: never })

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
const disasterOcclusionSampleSize = 0.5
const epsilon = 0.000001
const studPitchMeters = 0.008
const waterDensityKilogramsPerCubicMeter = 1000
const studSeparationCapacityNewtons = studPulloutNewtons
const challengeWaterLoadMultiplier = 20
const airDensityKilogramsPerCubicMeter = 1.225
const windDragCoefficient = 1.2
const estimatedSurfaceFriction = 0.45
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

const getSimulationFrameCount = (brickCount: number, options: DisasterSimulationOptions) => {
  if (brickCount > 1000) {
    return options.scenario === 'wind' && options.physicsProfile === 'realistic' && options.intensity > 0 ? 96 : 48
  }
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
  if (scenario === 'rain') return progress
  return ramp * (0.82 * Math.sin(progress * Math.PI * 12) + 0.18 * Math.sin(progress * Math.PI * 26))
}

const getGrade = (
  score: number,
  initialStaticFailureCount = 0,
  additionalHazardFailureCount = 0,
): DisasterSimulationResult['grade'] => {
  let grade: DisasterSimulationResult['grade'] = score >= 90 ? 'S'
    : score >= 78 ? 'A'
    : score >= 64 ? 'B'
    : score >= 48 ? 'C'
    : 'D'
  const totalFailures = initialStaticFailureCount + additionalHazardFailureCount
  if (totalFailures > 0 && grade === 'S') grade = 'A'
  if ((initialStaticFailureCount >= 10 || additionalHazardFailureCount >= 10) && (grade === 'S' || grade === 'A')) {
    grade = 'B'
  }
  return grade
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

  const candidatesAt = createProjectedSpatialIndex(projections, (projection) => ({
    minX: projection.minCrosswind, maxX: projection.maxCrosswind,
    minY: projection.bounds.minY, maxY: projection.bounds.maxY,
  }))
  const addRay = (crosswindPosition: number, y: number) => {
    const origin = {
      x: windDirection.x * minimumWindDepth + crosswind.x * crosswindPosition,
      z: windDirection.z * minimumWindDepth + crosswind.z * crosswindPosition,
    }
    const hits = candidatesAt(crosswindPosition, y).flatMap((candidate) => {
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

  const candidatesAt = createProjectedSpatialIndex(projections, ({ bounds }) => ({
    minX: bounds.minX, maxX: bounds.maxX, minY: bounds.minZ, maxY: bounds.maxZ,
  }))
  const addRay = (x: number, z: number) => {
    const hits = candidatesAt(x, z)
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
) => intensity === 0 ? 0 : clamp(timeSeconds / durationSeconds) * (0.3 + intensity * 0.7)

const getRainPondingDepthMeters = (
  intensity: number,
  waterAccumulation: number,
) => waterAccumulation * 0.03 * Math.pow(intensity, 1.5)

const getWindSpeedMetersPerSecond = (intensity: number) => 30 * intensity

const getPeakGroundAccelerationG = (intensity: number) => 2 * intensity

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

export const formatDisasterIntensityScale = (
  scenario: DisasterScenario,
  intensityPercent: number,
  locale: 'zh-CN' | 'en-US',
): string => {
  const clamped = Math.min(100, Math.max(0, intensityPercent))
  const intensity = clamped / 100
  const zh = locale === 'zh-CN'

  if (scenario === 'wind') {
    const speed = getWindSpeedMetersPerSecond(intensity)
    const beaufort: Array<[number, string, string]> = [
      [0.3, '0 级无风', 'Beaufort 0 Calm'],
      [1.6, '1 级软风', 'Beaufort 1 Light air'],
      [3.4, '2 级轻风', 'Beaufort 2 Light breeze'],
      [5.5, '3 级微风', 'Beaufort 3 Gentle breeze'],
      [8.0, '4 级和风', 'Beaufort 4 Moderate breeze'],
      [10.8, '5 级清风', 'Beaufort 5 Fresh breeze'],
      [13.9, '6 级强风', 'Beaufort 6 Strong breeze'],
      [17.2, '7 级疾风', 'Beaufort 7 Near gale'],
      [20.8, '8 级大风', 'Beaufort 8 Gale'],
      [24.5, '9 级烈风', 'Beaufort 9 Strong gale'],
      [28.5, '10 级狂风', 'Beaufort 10 Storm'],
      [Infinity, '11 级暴风', 'Beaufort 11 Violent storm'],
    ]
    const [, zhLabel, enLabel] = beaufort.find(([limit]) => speed < limit) ?? beaufort[beaufort.length - 1]
    return `${zh ? zhLabel : enLabel} · ${speed.toFixed(1)} m/s`
  }

  if (scenario === 'earthquake') {
    const pga = getPeakGroundAccelerationG(intensity)
    const mmi: Array<[number, string, string]> = [
      [0.001, '无震', 'No shaking'],
      [0.04, 'IV 度轻震', 'MMI IV Light'],
      [0.09, 'V 度较强', 'MMI V Moderate'],
      [0.18, 'VI 度强震', 'MMI VI Strong'],
      [0.34, 'VII 度很强', 'MMI VII Very strong'],
      [0.65, 'VIII 度严重', 'MMI VIII Severe'],
      [1.24, 'IX 度极强', 'MMI IX Violent'],
      [Infinity, 'X+ 度毁灭', 'MMI X+ Extreme'],
    ]
    const [, zhLabel, enLabel] = mmi.find(([limit]) => pga < limit) ?? mmi[mmi.length - 1]
    return `${zh ? zhLabel : enLabel} · ${pga.toFixed(2)} g`
  }

  const depthMm = getRainPondingDepthMeters(intensity, 0.3 + intensity * 0.7) * 1000
  const rainLevels: Array<[number, string, string]> = [
    [0.05, '无雨', 'Dry'],
    [2.0, '小雨', 'Light rain'],
    [5.0, '中雨', 'Moderate rain'],
    [10.0, '大雨', 'Heavy rain'],
    [18.0, '暴雨', 'Rainstorm'],
    [Infinity, '特大暴雨', 'Extreme storm'],
  ]
  const [, zhLabel, enLabel] = rainLevels.find(([limit]) => depthMm < limit) ?? rainLevels[rainLevels.length - 1]
  return `${zh ? zhLabel : enLabel} · ${depthMm.toFixed(1)} mm`
}

const createFailureHinge = (
  pivot: DisasterFailureHinge['pivot'],
  outward: StabilityPoint2,
): DisasterFailureHinge | undefined => {
  const length = Math.hypot(outward.x, outward.z)
  if (length <= epsilon) return undefined
  return { pivot, axis: { x: outward.z / length, z: -outward.x / length } }
}

const buildDisasterScene = (bricks: PlacedBrick[], graph: ReturnType<typeof createBuildGraph>) => {
  const analysis = analyzeBuildStability(bricks, graph)
  const prepared = bricks.filter(({ id }) => graph.boundsById.has(id))
  const contacts = prepareDisasterContacts(prepared, graph)
  const items = prepared.map(brick => {
    const bounds = graph.boundsById.get(brick.id)!
    const stability = analysis.riskByBrickId.get(brick.id)!
    const massProperties = getDisasterMassProperties(brick, stability.mass, stability.center)
    return { brick, bounds, exposureCenter: stability.center, ...massProperties }
  })
  return {
    analysis, items, ...contacts,
    heights: items.map(({ bounds }) => (bounds.minY + bounds.maxY) / 2),
    totalMassKg: items.reduce((sum, { mass }) => sum + mass, 0),
    rainOcclusionField: undefined as RainOcclusionField | undefined,
    windOcclusionByDirection: new Map<number, WindOcclusionField>(),
  }
}

const disasterSceneByBricks = new WeakMap<PlacedBrick[], {
  length: number
  first: PlacedBrick | undefined
  last: PlacedBrick | undefined
  graph: ReturnType<typeof createBuildGraph>
  scene: ReturnType<typeof buildDisasterScene>
}>()
const frameExposureCache = new WeakMap<DisasterSimulationResult, {
  failedCount: number
  wind?: Map<string, WindExposure>
  rain?: Map<string, RainExposure>
}>()

const getCachedWindOcclusionField = (
  scene: ReturnType<typeof buildDisasterScene>,
  boundsById: Map<string, WindBounds>,
  directionDegrees: number,
  direction: { x: number; z: number },
) => {
  const key = ((Math.round(directionDegrees * 100) % 36000) + 36000) % 36000
  const cached = scene.windOcclusionByDirection.get(key)
  if (cached) return cached
  const field = createWindOcclusionField(boundsById, direction)
  if (scene.windOcclusionByDirection.size >= 16) {
    const oldest = scene.windOcclusionByDirection.keys().next().value
    if (oldest !== undefined) scene.windOcclusionByDirection.delete(oldest)
  }
  scene.windOcclusionByDirection.set(key, field)
  return field
}

const getCachedRainOcclusionField = (
  scene: ReturnType<typeof buildDisasterScene>,
  boundsById: Map<string, WindBounds>,
) => {
  if (!scene.rainOcclusionField) {
    scene.rainOcclusionField = createRainOcclusionField(boundsById)
  }
  return scene.rainOcclusionField
}

export const runDisasterSimulation = (
  bricks: PlacedBrick[],
  options: DisasterSimulationOptions,
  simulationFrameCount = getSimulationFrameCount(bricks.length, options),
): DisasterSimulationResult => {
  const resolvedOptions: Required<DisasterSimulationOptions> = {
    scenario: options.scenario,
    intensity: Math.min(100, Math.max(0, options.intensity)),
    durationSeconds: Math.min(30, Math.max(3, options.durationSeconds ?? 9)),
    directionDegrees: options.directionDegrees ?? 25,
    physicsProfile: options.physicsProfile ?? 'challenge',
    groundCondition: options.groundCondition ?? 'surface',
  }
  const { scenario, durationSeconds, physicsProfile } = resolvedOptions
  const intensity = resolvedOptions.intensity / 100
  const radians = resolvedOptions.directionDegrees * Math.PI / 180
  const direction = { x: Math.cos(radians), z: Math.sin(radians) }
  const cachedEntry = disasterSceneByBricks.get(bricks)
  let graph: ReturnType<typeof createBuildGraph>
  let scene: ReturnType<typeof buildDisasterScene>
  if (
    cachedEntry
    && cachedEntry.length === bricks.length
    && cachedEntry.first === bricks[0]
    && cachedEntry.last === bricks[bricks.length - 1]
  ) {
    graph = cachedEntry.graph
    scene = cachedEntry.scene
  } else {
    graph = createBuildGraph(bricks)
    scene = buildDisasterScene(bricks, graph)
    disasterSceneByBricks.set(bricks, {
      length: bricks.length,
      first: bricks[0],
      last: bricks[bricks.length - 1],
      graph,
      scene,
    })
  }
  const { analysis, ground, bonds, neighbors, items, heights, totalMassKg } = scene
  const windOcclusionField = scenario === 'wind'
    ? getCachedWindOcclusionField(scene, graph.boundsById, resolvedOptions.directionDegrees, direction)
    : undefined
  const rainOcclusionField = scenario === 'rain'
    ? getCachedRainOcclusionField(scene, graph.boundsById)
    : undefined
  const windTracker = windOcclusionField && createDynamicExposureTracker(windOcclusionField)
  const rainTracker = rainOcclusionField && createDynamicExposureTracker(rainOcclusionField)
  const windExposureByBrickId = windOcclusionField
    ? getExposureFromField(windOcclusionField, new Set())
    : new Map<string, WindExposure>()
  const rainExposureByBrickId = rainOcclusionField
    ? getExposureFromField(rainOcclusionField, new Set())
    : new Map<string, RainExposure>()
  const failed = new Uint8Array(items.length)
  const broken = new Uint8Array(bonds.length)
  const directLoads = items.map(createDisasterWrench)
  const loads = items.map(createDisasterWrench)
  const historyByIndex = items.map(() => new Float32Array(simulationFrameCount + 1))
  const peakUtilizationByIndex = new Float32Array(items.length)
  const windExposureByIndex = windTracker
    ? items.map(({ brick }) => windTracker.exposureByBrickId.get(brick.id))
    : undefined
  const rainExposureByIndex = rainTracker
    ? items.map(({ brick }) => rainTracker.exposureByBrickId.get(brick.id))
    : undefined
  let paths: ReturnType<typeof createDisasterLoadPaths> | undefined
  let previousRoutes: NonNullable<typeof paths>['routes'] | undefined
  const failureTimeByBrickId = new Map<string, number>()
  const failureModeByBrickId = new Map<string, DisasterFailureMode>()
  const failureHingeByBrickId = new Map<string, DisasterFailureHinge>()
  const peakConnectionUtilizationByBrickId = new Map<string, number>()
  const governingFailureModeByBrickId = new Map<string, DisasterFailureMode>()
  const unresolvedConnectionBrickIds = new Set<string>()
  const connectionUtilizationHistoryByBrickId = new Map(items.map(({ brick }, index) => [
    brick.id, historyByIndex[index],
  ]))
  const maxFallByBrickId = new Map(items.map(({ brick, bounds }) => [brick.id, Math.max(0, bounds.minY)]))
  const timeline: DisasterSimulationResult['timeline'] = []
  let failedMassKg = 0
  let brokenConnectionCount = 0
  let initialBrokenConnectionCount = 0
  let slidingRiskBrickCount = 0
  let appliedExposureFailureCount = 0
  let firstFailureTimeSeconds: number | undefined
  let firstFailureBrickId: string | undefined
  let firstFailureWasDetached = true
  let firstHazardFailureTimeSeconds: number | undefined
  let firstHazardFailureBrickId: string | undefined
  let firstHazardFailureWasDetached = true
  let peakLoadFactor = -1
  let peakLoadTimeSeconds = 0
  const multiplier = getLoadMultiplier(scenario, physicsProfile)
  const windPressure = 0.5 * airDensityKilogramsPerCubicMeter * windDragCoefficient *
    getWindSpeedMetersPerSecond(intensity) ** 2 * studPitchMeters ** 2 * multiplier
  const peakAcceleration = getPeakGroundAccelerationG(intensity) * gravity * multiplier

  const markFailure = (index: number, time: number, mode: DisasterFailureMode, hinge?: DisasterFailureHinge) => {
    const { brick, mass } = items[index]
    failed[index] = 1
    failedMassKg += mass
    failureTimeByBrickId.set(brick.id, time)
    failureModeByBrickId.set(brick.id, mode)
    if (hinge) failureHingeByBrickId.set(brick.id, hinge)
    const isDetached = mode === 'detached'
    if (
      firstFailureTimeSeconds === undefined
      || time < firstFailureTimeSeconds - epsilon
      || (Math.abs(time - firstFailureTimeSeconds) <= epsilon && firstFailureWasDetached && !isDetached)
    ) {
      firstFailureTimeSeconds = time
      firstFailureBrickId = brick.id
      firstFailureWasDetached = isDetached
    }
    if (
      time > epsilon
      && (
        firstHazardFailureTimeSeconds === undefined
        || time < firstHazardFailureTimeSeconds - epsilon
        || (Math.abs(time - firstHazardFailureTimeSeconds) <= epsilon && firstHazardFailureWasDetached && !isDetached)
      )
    ) {
      firstHazardFailureTimeSeconds = time
      firstHazardFailureBrickId = brick.id
      firstHazardFailureWasDetached = isDetached
    }
  }

  const markDetached = (
    rank: Int32Array,
    time: number,
    causes: Map<number, { mode: DisasterFailureMode; hinge?: DisasterFailureHinge }>,
  ) => {
    const visited = new Uint8Array(items.length)
    for (let start = 0; start < items.length; start += 1) {
      if (failed[start] || visited[start] || rank[start] >= 0) continue
      const component = [start]
      visited[start] = 1
      for (let i = 0; i < component.length; i += 1) {
        const index = component[i]
        for (const bond of neighbors[index]) {
          const next = bond.a === index ? bond.b : bond.a
          if (broken[bond.index] || failed[next] || visited[next] || rank[next] >= 0) continue
          visited[next] = 1
          component.push(next)
        }
      }
      const hinge = component.find(index => causes.get(index)?.hinge)
      for (const index of component) {
        const cause = causes.get(index)
        markFailure(index, time, cause?.mode ?? 'detached', cause?.hinge ?? (hinge === undefined ? undefined : causes.get(hinge)?.hinge))
      }
    }
  }

  const updateLoads = (order: number[], time: number, factor: number, gravityOnly: boolean) => {
    if (failureTimeByBrickId.size !== appliedExposureFailureCount) {
      const failedIds = new Set(failureTimeByBrickId.keys())
      windTracker?.update(failedIds)
      rainTracker?.update(failedIds)
      appliedExposureFailureCount = failedIds.size
    }
    const rainPressure = gravityOnly ? 0 : waterDensityKilogramsPerCubicMeter * gravity * studPitchMeters ** 2 *
      getRainPondingDepthMeters(intensity, getWaterAccumulation(time, durationSeconds, intensity)) * multiplier
    const isEarthquake = scenario === 'earthquake'
    for (let i = 0; i < order.length; i += 1) {
      const index = order[i]
      const { center, exposureCenter, mass } = items[index]
      const load = directLoads[index]
      const target = loads[index]
      const weightBase = mass * gravity
      const water = rainExposureByIndex ? (rainExposureByIndex[index]?.exposedArea ?? 0) * rainPressure : 0
      const weight = weightBase + water
      const weightX = weightBase * center.x + water * exposureCenter.x
      const weightZ = weightBase * center.z + water * exposureCenter.z
      const lateral = gravityOnly ? 0 : isEarthquake
        ? mass * peakAcceleration * factor
        : (windExposureByIndex ? (windExposureByIndex[index]?.exposedArea ?? 0) : 0) * windPressure * factor
      const applicationPoint = isEarthquake ? center : exposureCenter
      const lateralX = lateral * applicationPoint.x
      const lateralY = lateral * applicationPoint.y
      const lateralZ = lateral * applicationPoint.z
      load.weight = weight
      load.weightX = weightX
      load.weightZ = weightZ
      load.lateral = lateral
      load.lateralX = lateralX
      load.lateralY = lateralY
      load.lateralZ = lateralZ
      load.unresolved = false
      target.weight = weight
      target.weightX = weightX
      target.weightZ = weightZ
      target.lateral = lateral
      target.lateralX = lateralX
      target.lateralY = lateralY
      target.lateralZ = lateralZ
      target.unresolved = false
    }
  }

  const evaluateGround = (
    components: ReturnType<typeof createDisasterLoadPaths>['components'],
    time: number,
  ) => {
    if (resolvedOptions.groundCondition === 'anchored') return false
    let anyFailed = false
    let slidingCount = 0
    for (const { members, hull } of components) {
      const load = createDisasterWrench()
      for (const index of members) addDisasterWrench(load, directLoads[index])
      if (load.weight <= epsilon) continue
      const frictionLimit = estimatedSurfaceFriction * load.weight
      if (Math.abs(load.lateral) > frictionLimit) {
        const mass = members.reduce((sum, index) => sum + items[index].mass, 0)
        const acceleration = (load.lateral - Math.sign(load.lateral) * frictionLimit) / mass
        slidingCount += members.length
        // Solve in the accelerating frame of the component. Floor friction
        // can transmit at most μN. Excess horizontal force drives sliding.
        for (const index of members) {
          const { center, mass: brickMass } = items[index]
          const inertialForce = brickMass * acceleration
          const direct = loads[index]
          direct.lateral -= inertialForce
          direct.lateralX -= inertialForce * center.x
          direct.lateralY -= inertialForce * center.y
          direct.lateralZ -= inertialForce * center.z
          load.lateralY -= inertialForce * center.y
        }
      }
      const point = {
        x: (load.weightX + direction.x * load.lateralY) / load.weight,
        z: (load.weightZ + direction.z * load.lateralY) / load.weight,
      }
      if (getSignedDistanceToSupportHull(point, hull) >= -0.02) continue
      const pivot = getClosestPointOnSupportHull(point, hull)
      const hinge = createFailureHinge({ ...pivot, y: 0 }, { x: point.x - pivot.x, z: point.z - pivot.z })
      for (const index of members) markFailure(index, time, 'ground-overturn', hinge)
      anyFailed = true
    }
    slidingRiskBrickCount = Math.max(slidingRiskBrickCount, slidingCount)
    return anyFailed
  }

  const causes = new Map<number, { mode: DisasterFailureMode; hinge?: DisasterFailureHinge }>()
  const blocked = new Uint8Array(items.length)
  for (let frameIndex = 0; frameIndex <= simulationFrameCount; frameIndex += 1) {
    const time = durationSeconds * frameIndex / simulationFrameCount
    const factor = intensity === 0 ? 0 : getDynamicLoadFactor(scenario, time, durationSeconds)
    const gravityOnly = frameIndex === 0 || intensity === 0
    if (frameIndex > 0) {
      for (let index = 0; index < items.length; index += 1) {
        if (failed[index] || intensity === 0) {
          const history = historyByIndex[index]
          history[frameIndex] = history[frameIndex - 1]
        }
      }
    }
    if (frameIndex > 0 && intensity === 0) {
      timeline.push({ timeSeconds: time, failedCount: failureTimeByBrickId.size, loadFactor: 0 })
      continue
    }
    // Resolve the changing topology at this instant. Loaded descendants
    // release before supports that may be relieved by their release.
    for (;;) {
      if (!paths) {
        paths = createDisasterLoadPaths(neighbors, ground, heights, failed, broken, previousRoutes)
        previousRoutes = paths.routes
        markDetached(paths.rank, time, causes)
        causes.clear()
      }
      updateLoads(paths.order, time, factor, gravityOnly)
      if (evaluateGround(paths.components, time)) {
        paths = undefined
        continue
      }
      blocked.fill(0)
      let changed = false
      for (let orderIdx = 0; orderIdx < paths.order.length; orderIdx += 1) {
        const index = paths.order[orderIdx]
        const route = paths.routes[index]
        const demand = resolveDisasterSupports(route, loads[index], direction, loads)
        if (!demand) continue
        const mode: DisasterFailureMode = gravityOnly ? 'gravity-connection'
          : scenario === 'rain' ? (demand.compressionLimited ? 'water-load' : 'rain-peel')
          : scenario === 'earthquake' ? (demand.overturning ? 'seismic-overturn' : 'seismic-shear')
          : demand.overturning ? 'overturn' : 'shear'
        const history = historyByIndex[index]
        if (demand.utilization > history[frameIndex]) history[frameIndex] = demand.utilization
        if (demand.utilization > peakUtilizationByIndex[index]) {
          peakUtilizationByIndex[index] = demand.utilization
          const id = items[index].brick.id
          peakConnectionUtilizationByBrickId.set(id, demand.utilization)
          governingFailureModeByBrickId.set(id, mode)
        }
        if (demand.unverified) unresolvedConnectionBrickIds.add(items[index].brick.id)
        const releases = !blocked[index] && !demand.unverified && demand.utilization >= 1
        if (releases) {
          broken[demand.support.bond.index] = 1
          brokenConnectionCount += 1
          causes.set(index, {
            mode,
            hinge: demand.overturning ? createFailureHinge(demand.pivot, demand.outward) : undefined,
          })
          changed = true
        }
        if (releases || blocked[index]) {
          for (const { target } of route.supports) blocked[target] = 1
          for (const { target } of route.joints) blocked[target] = 1
        }
      }
      if (!changed) break
      paths = undefined
    }
    if (frameIndex === 0) initialBrokenConnectionCount = brokenConnectionCount
    const absFactor = Math.abs(factor)
    if (absFactor > peakLoadFactor) {
      peakLoadFactor = absFactor
      peakLoadTimeSeconds = time
    }
    timeline.push({ timeSeconds: time, failedCount: failureTimeByBrickId.size, loadFactor: absFactor })
  }

  const survivalRatio = totalMassKg <= epsilon ? 0 : clamp(1 - failedMassKg / totalMassKg)
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
  const initialStaticFailureCount = [...failureTimeByBrickId.values()]
    .filter((failureTime) => failureTime <= epsilon).length

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
    peakStressByBrickId: peakConnectionUtilizationByBrickId,
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
    initialStaticFailureCount,
    initialBrokenConnectionCount,
    brokenConnectionCount,
    modelMassKilograms: totalMassKg,
    unresolvedConnectionBrickIds: [...unresolvedConnectionBrickIds],
    slidingRiskBrickCount,
    survivedBrickCount: Math.max(0, items.length - failureTimeByBrickId.size),
    failedBrickCount: failureTimeByBrickId.size,
    firstFailureTimeSeconds,
    firstFailureBrickId,
    firstHazardFailureTimeSeconds,
    firstHazardFailureBrickId,
    peakLoadTimeSeconds,
    score,
    grade: getGrade(score, initialStaticFailureCount, Math.max(0, failureTimeByBrickId.size - initialStaticFailureCount)),
    scoreBreakdown,
  }
}

export const getDisasterFrame = (
  result: DisasterSimulationResult,
  timeSeconds: number,
): DisasterFrame => {
  const resolvedTime = Math.min(result.options.durationSeconds, Math.max(0, timeSeconds))
  const signedLoadFactor = result.options.intensity === 0 ? 0
    : getDynamicLoadFactor(result.options.scenario, resolvedTime, result.options.durationSeconds)
  const loadFactor = Math.abs(signedLoadFactor)
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
  let windExposureByBrickId = result.windExposureByBrickId
  let rainExposureByBrickId = result.rainExposureByBrickId
  if (failedIds.size > 0 && (result.windOcclusionField || result.rainOcclusionField)) {
    const cached = frameExposureCache.get(result)
    if (cached && cached.failedCount === failedIds.size) {
      if (cached.wind) windExposureByBrickId = cached.wind
      if (cached.rain) rainExposureByBrickId = cached.rain
    } else {
      const nextWind = result.windOcclusionField ? getExposureFromField(result.windOcclusionField, failedIds) : undefined
      const nextRain = result.rainOcclusionField ? getExposureFromField(result.rainOcclusionField, failedIds) : undefined
      frameExposureCache.set(result, { failedCount: failedIds.size, wind: nextWind, rain: nextRain })
      if (nextWind) windExposureByBrickId = nextWind
      if (nextRain) rainExposureByBrickId = nextRain
    }
  }
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
      const drift = failureTime > epsilon ? Math.min(6, age * age * intensity * 0.83) : 0
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
      const shake = Math.sign(signedLoadFactor) * elasticAmount * 0.065
      offsetsByBrickId.set(brickId, { x: direction.x * shake, y: 0, z: direction.z * shake })
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
