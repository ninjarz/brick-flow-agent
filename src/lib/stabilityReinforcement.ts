import { brickById } from '../data/basicBricks'
import type { BuildPlan, PlacedBrick } from '../types/bricks'
import { normalizeHorizontalStud, normalizeYStud } from './brickUnits'
import { runDisasterSimulation, type DisasterSimulationOptions } from './disasterSimulation'
import { analyzeBuildStability } from './stabilityAnalysis'
import { getBrickBounds, getBlockingBuildPlanIssues, hasBrickCollision, isBrickSupported, validateBuildPlan } from './planUtils'
import { getEffectiveInventory, type InventoryOverrides } from './userInventory'

export type ReinforcementCandidate = {
  id: string
  targetBrickIds: string[]
  columnCount: number
  addedBricks: PlacedBrick[]
}

export type ReinforcementProposal = ReinforcementCandidate & {
  beforeScore: number
  afterScore: number
  scoreDelta: number
  beforeFailedBrickCount: number
  afterFailedBrickCount: number
  failureReduction: number
}

const epsilon = 0.06
const maxColumnPieces = 24
const supportTypes = {
  lego: { tall: 'brick-1x1', short: 'plate-1x1', tallHeight: 1.2, shortHeight: 0.4 },
  minecraft: { tall: 'minecraft-basic-block', short: 'minecraft-basic-block', tallHeight: 1, shortHeight: 1 },
} as const

const safeIdPart = (value: number) => String(Math.round(value * 5)).replace('-', 'n')

const createSupportColumn = (
  plan: BuildPlan,
  target: PlacedBrick,
  xStud: number,
  zStud: number,
  inventoryOverrides: InventoryOverrides,
  proposalIndex: number,
) => {
  const targetDefinition = brickById.get(target.brickId)
  const targetBounds = getBrickBounds(target)
  if (!targetDefinition || !targetBounds || targetBounds.minY <= epsilon) return undefined
  const types = supportTypes[targetDefinition.pack]
  if (!types) return undefined
  const totalUnits = Math.round(targetBounds.minY / types.shortHeight)
  if (Math.abs(totalUnits * types.shortHeight - targetBounds.minY) > epsilon || totalUnits <= 0) return undefined

  const currentCounts = plan.bricks.reduce<Record<string, number>>((counts, brick) => {
    counts[brick.brickId] = (counts[brick.brickId] ?? 0) + 1
    return counts
  }, {})
  const addedCounts: Record<string, number> = {}
  const added: PlacedBrick[] = []
  let remainingUnits = totalUnits
  let yStud = 0
  let pieceIndex = 0
  while (remainingUnits > 0 && pieceIndex < maxColumnPieces) {
    const useTall = types.tall !== types.short && remainingUnits >= Math.round(types.tallHeight / types.shortHeight)
    const brickId = useTall ? types.tall : types.short
    const height = useTall ? types.tallHeight : types.shortHeight
    const definition = brickById.get(brickId)
    if (!definition) return undefined
    const inventory = getEffectiveInventory(brickId, definition.inventory, inventoryOverrides)
    if ((currentCounts[brickId] ?? 0) + (addedCounts[brickId] ?? 0) >= inventory) return undefined
    const color = definition.colors.includes(target.color) ? target.color : definition.colors.includes('gray') ? 'gray' : definition.colors[0]
    const candidate: PlacedBrick = {
      id: `reinforcement-${target.id}-${safeIdPart(xStud)}-${safeIdPart(zStud)}-${proposalIndex}-${pieceIndex}`,
      brickId,
      color,
      pose: {
        xStud: normalizeHorizontalStud(xStud),
        yStud: normalizeYStud(yStud),
        zStud: normalizeHorizontalStud(zStud),
        rotationQuarterTurns: 0,
        verticalQuarterTurns: 0,
      },
    }
    const placed = [...plan.bricks, ...added]
    if (hasBrickCollision(candidate, placed) || !isBrickSupported(candidate, placed)) return undefined
    added.push(candidate)
    addedCounts[brickId] = (addedCounts[brickId] ?? 0) + 1
    yStud = normalizeYStud(yStud + height)
    remainingUnits -= Math.round(height / types.shortHeight)
    pieceIndex += 1
  }
  if (remainingUnits !== 0 || Math.abs(yStud - targetBounds.minY) > epsilon) return undefined
  return added
}

const getTargetColumnPositions = (target: PlacedBrick) => {
  const bounds = getBrickBounds(target)
  if (!bounds) return []
  const positions: Array<{ xStud: number; zStud: number }> = []
  const minX = Math.ceil(bounds.minX - epsilon)
  const maxX = Math.floor(bounds.maxX - 1 + epsilon)
  const minZ = Math.ceil(bounds.minZ - epsilon)
  const maxZ = Math.floor(bounds.maxZ - 1 + epsilon)
  for (let xStud = minX; xStud <= maxX; xStud += 1) {
    for (let zStud = minZ; zStud <= maxZ; zStud += 1) positions.push({ xStud, zStud })
  }
  const centerX = (bounds.minX + bounds.maxX - 1) / 2
  const centerZ = (bounds.minZ + bounds.maxZ - 1) / 2
  return positions.sort((left, right) => {
    const leftDistance = (left.xStud - centerX) ** 2 + (left.zStud - centerZ) ** 2
    const rightDistance = (right.xStud - centerX) ** 2 + (right.zStud - centerZ) ** 2
    return rightDistance - leftDistance || left.xStud - right.xStud || left.zStud - right.zStud
  })
}

const fitsInventory = (plan: BuildPlan, addedBricks: PlacedBrick[], inventoryOverrides: InventoryOverrides) => {
  const counts = [...plan.bricks, ...addedBricks].reduce<Record<string, number>>((result, brick) => {
    result[brick.brickId] = (result[brick.brickId] ?? 0) + 1
    return result
  }, {})
  return Object.entries(counts).every(([brickId, count]) => {
    const definition = brickById.get(brickId)
    return !definition || count <= getEffectiveInventory(brickId, definition.inventory, inventoryOverrides)
  })
}

export const createReinforcementCandidates = (
  plan: BuildPlan,
  inventoryOverrides: InventoryOverrides = {},
  limit = 6,
): ReinforcementCandidate[] => {
  const analysis = analyzeBuildStability(plan.bricks)
  const riskyTargets = [...analysis.riskByBrickId.values()]
    .filter((item) => item.riskLevel !== 'stable')
    .sort((left, right) => right.risk - left.risk)
    .map((item) => plan.bricks.find((brick) => brick.id === item.brickId))
    .filter((brick): brick is PlacedBrick => Boolean(brick))
  const candidates: ReinforcementCandidate[] = []
  const candidatePlan = (addedBricks: PlacedBrick[]) => ({
    ...plan,
    bricks: [...plan.bricks, ...addedBricks],
    steps: [...plan.steps, {
      id: 'reinforcement-validation-step',
      title: 'Structural reinforcement',
      description: '',
      brickIds: addedBricks.map((brick) => brick.id),
    }],
  })

  for (const target of riskyTargets.slice(0, 6)) {
    const columns = getTargetColumnPositions(target)
      .flatMap((position, index) => {
        const column = createSupportColumn(plan, target, position.xStud, position.zStud, inventoryOverrides, candidates.length + index)
        return column ? [column] : []
      })
      .sort((left, right) => left.length - right.length)
    if (columns.length === 0) continue

    const single = columns[0]
    const singlePlan = candidatePlan(single)
    if (getBlockingBuildPlanIssues(validateBuildPlan(singlePlan)).length === 0) {
      candidates.push({ id: `support-${target.id}-single`, targetBrickIds: [target.id], columnCount: 1, addedBricks: single })
    }
    const second = columns.find((column) => column[0]?.pose.xStud !== single[0]?.pose.xStud || column[0]?.pose.zStud !== single[0]?.pose.zStud)
    if (second) {
      const combined = [...single, ...second]
      const combinedPlan = candidatePlan(combined)
      if (fitsInventory(plan, combined, inventoryOverrides) && getBlockingBuildPlanIssues(validateBuildPlan(combinedPlan)).length === 0) {
        candidates.push({ id: `support-${target.id}-double`, targetBrickIds: [target.id], columnCount: 2, addedBricks: combined })
      }
    }
    if (candidates.length >= limit) break
  }
  return candidates.slice(0, limit)
}

export const evaluateReinforcementCandidates = (
  plan: BuildPlan,
  candidates: ReinforcementCandidate[],
  options: DisasterSimulationOptions,
): ReinforcementProposal[] => {
  const before = runDisasterSimulation(plan.bricks, options)
  return candidates.map((candidate) => {
    const after = runDisasterSimulation([...plan.bricks, ...candidate.addedBricks], options)
    return {
      ...candidate,
      beforeScore: before.score,
      afterScore: after.score,
      scoreDelta: after.score - before.score,
      beforeFailedBrickCount: before.failedBrickCount,
      afterFailedBrickCount: after.failedBrickCount,
      failureReduction: before.failedBrickCount - after.failedBrickCount,
    }
  }).sort((left, right) =>
    right.scoreDelta - left.scoreDelta ||
    right.failureReduction - left.failureReduction ||
    left.addedBricks.length - right.addedBricks.length ||
    left.id.localeCompare(right.id)
  )
}
