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

export type DisasterSimulationResult = {
  options: Required<DisasterSimulationOptions>
  analysis: StabilityAnalysis
  failureTimeByBrickId: Map<string, number>
  peakStressByBrickId: Map<string, number>
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
  offsetsByBrickId: Map<string, { x: number; y: number; z: number }>
}

const simulationFrameCount = 90
const contactTolerance = 0.14
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
    const windExposedArea = height * (
      Math.abs(windDirection.x) * depth + Math.abs(windDirection.z) * width
    )
    const topArea = width * depth
    const rootBoost = rootIds.has(brick.id) ? 2 : 0
    const connectionCapacity = (
      0.9 + stability.connectionCount * 0.7 + stability.supportCoverage * 1.8 + rootBoost
    ) * (0.7 + Math.pow(stability.mass, 0.35))
    return [{ brick, bounds, stability, windExposedArea, topArea, connectionCapacity }]
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

    for (const item of prepared) {
      if (failureTimeByBrickId.has(item.brick.id)) continue
      const riskBias = item.stability.risk * (0.28 + intensity * 0.72)
      let demand = 0
      let grip = 1
      if (resolvedOptions.scenario === 'wind') {
        demand = item.windExposedArea * (0.2 + 2.15 * intensity ** 2) * (0.28 + item.stability.heightRatio * 0.92)
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

  for (const [brickId, stability] of result.analysis.riskByBrickId) {
    const failureTime = result.failureTimeByBrickId.get(brickId)
    if (failureTime !== undefined && failureTime <= resolvedTime) {
      failedIds.add(brickId)
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

    const elasticAmount = intensity * loadFactor * stability.heightRatio
    if (result.options.scenario === 'wind') {
      offsetsByBrickId.set(brickId, { x: direction.x * elasticAmount * 0.055, y: 0, z: direction.z * elasticAmount * 0.055 })
    } else if (result.options.scenario === 'earthquake') {
      const shake = Math.sin(resolvedTime * 13 + hashUnit(brickId) * 2) * elasticAmount * 0.065
      offsetsByBrickId.set(brickId, { x: shake, y: 0, z: shake * 0.55 })
    }
  }

  return { timeSeconds: resolvedTime, loadFactor, failedIds, offsetsByBrickId }
}
