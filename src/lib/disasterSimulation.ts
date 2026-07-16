import { createBuildGraph } from './planUtils'
import { analyzeBuildStability, type StabilityAnalysis } from './stabilityAnalysis'
import type { PlacedBrick } from '../types/bricks'

export type DisasterScenario = 'wind' | 'rain' | 'earthquake'

export type DisasterSimulationOptions = {
  scenario: DisasterScenario
  intensity: number
  durationSeconds?: number
  directionDegrees?: number
}

export type DisasterScoreBreakdown = {
  survival: number
  staticStability: number
  span: number
  materialEfficiency: number
}

export type WindExposure = {
  projectedArea: number
  exposedArea: number
  exposedRatio: number
}

export type WindOcclusionField = {
  rayHitBrickIds: string[][]
  projectedSampleCountByBrickId: Map<string, number>
  projectedAreaByBrickId: Map<string, number>
}

export type DisasterSimulationResult = {
  options: Required<DisasterSimulationOptions>
  analysis: StabilityAnalysis
  failureTimeByBrickId: Map<string, number>
  peakStressByBrickId: Map<string, number>
  windExposureByBrickId: Map<string, WindExposure>
  windOcclusionField?: WindOcclusionField
  maxFallByBrickId: Map<string, number>
  timeline: Array<{
    timeSeconds: number
    failedCount: number
    loadFactor: number
  }>
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
  windExposureByBrickId: Map<string, WindExposure>
  offsetsByBrickId: Map<string, { x: number; y: number; z: number }>
}

const simulationFrameCount = 90
const contactTolerance = 0.14
const windOcclusionSampleSize = 0.5
const epsilon = 0.000001
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

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
  const ramp = Math.min(1, progress * 5)
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
  const crosswindSamples = Math.max(1, Math.ceil(crosswindSpan / windOcclusionSampleSize))
  const verticalSamples = Math.max(1, Math.ceil(height / windOcclusionSampleSize))
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

const getWindExposureFromField = (
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

export const runDisasterSimulation = (
  bricks: PlacedBrick[],
  options: DisasterSimulationOptions,
): DisasterSimulationResult => {
  const resolvedOptions: Required<DisasterSimulationOptions> = {
    scenario: options.scenario,
    intensity: Math.min(100, Math.max(0, options.intensity)),
    durationSeconds: Math.min(30, Math.max(3, options.durationSeconds ?? 9)),
    directionDegrees: options.directionDegrees ?? 25,
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
    ? getWindExposureFromField(windOcclusionField, new Set())
    : new Map<string, WindExposure>()
  const rootIds = new Set([...graph.boundsById]
    .filter(([, bounds]) => Math.abs(bounds.minY) <= contactTolerance)
    .map(([brickId]) => brickId))
  const prepared = bricks.flatMap((brick) => {
    const bounds = graph.boundsById.get(brick.id)
    const stability = analysis.riskByBrickId.get(brick.id)
    if (!bounds || !stability) return []
    const width = Math.max(epsilon, bounds.maxX - bounds.minX)
    const depth = Math.max(epsilon, bounds.maxZ - bounds.minZ)
    const topArea = width * depth
    const rootBoost = rootIds.has(brick.id) ? 2 : 0
    const connectionCapacity = (
      0.9 + stability.connectionCount * 0.7 + stability.supportCoverage * 1.8 + rootBoost
    ) * (0.7 + Math.pow(stability.mass, 0.35))
    return [{ brick, bounds, stability, topArea, connectionCapacity }]
  })
  const failureTimeByBrickId = new Map<string, number>()
  const peakStressByBrickId = new Map<string, number>()
  const maxFallByBrickId = new Map(prepared.map(({ brick, bounds }) => [brick.id, Math.max(0, bounds.minY)]))
  const timeline: DisasterSimulationResult['timeline'] = []

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
    for (const { brick } of prepared) {
      if (!reachable.has(brick.id) && !failureTimeByBrickId.has(brick.id)) {
        failureTimeByBrickId.set(brick.id, timeSeconds)
      }
    }
  }

  for (let frameIndex = 0; frameIndex <= simulationFrameCount; frameIndex += 1) {
    const timeSeconds = resolvedOptions.durationSeconds * frameIndex / simulationFrameCount
    const loadFactor = getDynamicLoadFactor(resolvedOptions.scenario, timeSeconds, resolvedOptions.durationSeconds)
    const frameWindExposure = windOcclusionField
      ? getWindExposureFromField(windOcclusionField, new Set(failureTimeByBrickId.keys()))
      : windExposureByBrickId

    for (const item of prepared) {
      if (failureTimeByBrickId.has(item.brick.id)) continue
      const riskBias = item.stability.risk * (0.28 + intensity * 0.72)
      let demand = 0
      let grip = 1
      if (resolvedOptions.scenario === 'wind') {
        const exposedArea = frameWindExposure.get(item.brick.id)?.exposedArea ?? 0
        demand = exposedArea * (0.2 + 2.15 * intensity ** 2) * (0.28 + item.stability.heightRatio * 0.92)
      } else if (resolvedOptions.scenario === 'rain') {
        demand = item.topArea * (0.12 + 1.7 * intensity) * (0.34 + item.stability.heightRatio * 0.35)
        grip = 1 - intensity * 0.38
      } else {
        demand = item.stability.mass * (0.12 + 1.35 * intensity) * (0.18 + item.stability.heightRatio)
      }
      const stress = demand * loadFactor / Math.max(epsilon, item.connectionCapacity * grip) + riskBias
      peakStressByBrickId.set(item.brick.id, Math.max(peakStressByBrickId.get(item.brick.id) ?? 0, stress))
      const deterministicTolerance = 0.94 + hashUnit(item.brick.id) * 0.18
      if (stress >= deterministicTolerance) failureTimeByBrickId.set(item.brick.id, timeSeconds)
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
    analysis,
    failureTimeByBrickId,
    peakStressByBrickId,
    windExposureByBrickId,
    windOcclusionField,
    maxFallByBrickId,
    timeline,
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
  const offsetsByBrickId = new Map<string, { x: number; y: number; z: number }>()

  for (const [brickId] of result.analysis.riskByBrickId) {
    const failureTime = result.failureTimeByBrickId.get(brickId)
    if (failureTime !== undefined && failureTime <= resolvedTime) failedIds.add(brickId)
  }
  const windExposureByBrickId = result.windOcclusionField
    ? getWindExposureFromField(result.windOcclusionField, failedIds)
    : result.windExposureByBrickId

  for (const [brickId, stability] of result.analysis.riskByBrickId) {
    const failureTime = result.failureTimeByBrickId.get(brickId)
    if (failureTime !== undefined && failureTime <= resolvedTime) {
      const age = resolvedTime - failureTime
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

  return { timeSeconds: resolvedTime, loadFactor, failedIds, windExposureByBrickId, offsetsByBrickId }
}
