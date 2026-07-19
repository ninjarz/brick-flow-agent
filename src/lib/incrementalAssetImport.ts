import type { BuildPlan, PlacedBrick } from '../types/bricks'
import { dropBrickGroupAtPoint } from './brickGroupPlacement'
import { createId, createPlanSpatialState, createSingleBrickSteps, getBrickBounds } from './planUtils'

export type IncrementalAssetImportResult = {
  plan: BuildPlan
  importedBrickIds: string[]
  brickIdMap: Record<string, string>
  structureIdMap: Record<string, string>
  placementOffset: { x: number; y: number; z: number }
}

type Bounds2d = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const assetSpacingStuds = 2
const maxPlacementGapStuds = 32

const getGroupBounds2d = (bricks: PlacedBrick[]): Bounds2d | undefined => {
  const bounds = bricks.map(getBrickBounds).filter((item) => Boolean(item))
  if (bounds.length !== bricks.length || bounds.length === 0) return undefined
  return {
    minX: Math.min(...bounds.map((item) => item!.minX)),
    maxX: Math.max(...bounds.map((item) => item!.maxX)),
    minZ: Math.min(...bounds.map((item) => item!.minZ)),
    maxZ: Math.max(...bounds.map((item) => item!.maxZ)),
  }
}

const makeUniqueId = (
  prefix: string,
  usedIds: Set<string>,
  idFactory: (prefix: string) => string,
) => {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const id = idFactory(prefix)
    if (usedIds.has(id)) continue
    usedIds.add(id)
    return id
  }
  throw new Error(`Unable to create unique ${prefix} id`)
}

const remapAssetPlan = (
  currentPlan: BuildPlan,
  assetPlan: BuildPlan,
  idFactory: (prefix: string) => string,
) => {
  const usedBrickIds = new Set(currentPlan.bricks.map((brick) => brick.id))
  const brickIdMap = new Map(assetPlan.bricks.map((brick) => [
    brick.id,
    makeUniqueId('piece', usedBrickIds, idFactory),
  ]))
  const bricks = assetPlan.bricks.map((brick) => ({
    ...brick,
    id: brickIdMap.get(brick.id)!,
    pose: { ...brick.pose },
  }))

  const usedStepIds = new Set(currentPlan.steps.map((step) => step.id))
  const steps = assetPlan.steps.map((step) => ({
    ...step,
    id: makeUniqueId('step', usedStepIds, idFactory),
    brickIds: step.brickIds
      .map((brickId) => brickIdMap.get(brickId))
      .filter((brickId): brickId is string => Boolean(brickId)),
  })).filter((step) => step.brickIds.length > 0)

  const usedStructureIds = new Set((currentPlan.structures ?? []).map((structure) => structure.id))
  const structureIdMap = new Map((assetPlan.structures ?? []).map((structure) => [
    structure.id,
    makeUniqueId('structure', usedStructureIds, idFactory),
  ]))
  const structures = (assetPlan.structures ?? []).map((structure) => ({
    ...structure,
    id: structureIdMap.get(structure.id)!,
    brickIds: structure.brickIds
      .map((brickId) => brickIdMap.get(brickId))
      .filter((brickId): brickId is string => Boolean(brickId)),
  })).filter((structure) => structure.brickIds.length > 0)

  return {
    bricks,
    steps,
    structures,
    brickIdMap: Object.fromEntries(brickIdMap),
    structureIdMap: Object.fromEntries(structureIdMap),
  }
}

const getPlacementPoints = (
  assetBricks: PlacedBrick[],
  currentBounds: Bounds2d | undefined,
  gapStuds: number,
) => {
  const assetBounds = getGroupBounds2d(assetBricks)
  if (!assetBounds) return []
  const anchorBounds = getBrickBounds(assetBricks[0])
  if (!anchorBounds) return []
  const anchorCenterX = (anchorBounds.minX + anchorBounds.maxX) / 2
  const anchorCenterZ = (anchorBounds.minZ + anchorBounds.maxZ) / 2
  const assetCenterX = (assetBounds.minX + assetBounds.maxX) / 2
  const assetCenterZ = (assetBounds.minZ + assetBounds.maxZ) / 2

  if (!currentBounds) {
    return [{
      x: anchorCenterX - assetBounds.minX,
      z: anchorCenterZ - assetBounds.minZ,
    }]
  }

  const currentCenterX = (currentBounds.minX + currentBounds.maxX) / 2
  const currentCenterZ = (currentBounds.minZ + currentBounds.maxZ) / 2
  return [
    {
      x: anchorCenterX + currentBounds.maxX + gapStuds - assetBounds.minX,
      z: anchorCenterZ + currentCenterZ - assetCenterZ,
    },
    {
      x: anchorCenterX + currentCenterX - assetCenterX,
      z: anchorCenterZ + currentBounds.maxZ + gapStuds - assetBounds.minZ,
    },
    {
      x: anchorCenterX + currentBounds.minX - gapStuds - assetBounds.maxX,
      z: anchorCenterZ + currentCenterZ - assetCenterZ,
    },
    {
      x: anchorCenterX + currentCenterX - assetCenterX,
      z: anchorCenterZ + currentBounds.minZ - gapStuds - assetBounds.maxZ,
    },
  ]
}

export const importAssetPlanIncrementally = (
  currentPlan: BuildPlan,
  assetPlan: BuildPlan,
  idFactory: (prefix: string) => string = createId,
): IncrementalAssetImportResult | undefined => {
  if (assetPlan.bricks.length === 0) return undefined
  const remapped = remapAssetPlan(currentPlan, assetPlan, idFactory)
  const currentBounds = getGroupBounds2d(currentPlan.bricks)
  const spatialState = createPlanSpatialState(currentPlan.bricks)
  let placedBricks: PlacedBrick[] | undefined

  for (let gapStuds = assetSpacingStuds; gapStuds <= maxPlacementGapStuds && !placedBricks; gapStuds += 2) {
    for (const point of getPlacementPoints(remapped.bricks, currentBounds, gapStuds)) {
      placedBricks = dropBrickGroupAtPoint(
        remapped.bricks,
        remapped.bricks[0].id,
        point,
        { stationaryBricks: currentPlan.bricks, spatialState },
      )
      if (placedBricks) break
    }
  }
  if (!placedBricks) return undefined

  const usedStepIds = new Set([
    ...currentPlan.steps.map((step) => step.id),
    ...remapped.steps.map((step) => step.id),
  ])
  const importedSteps = remapped.steps.length > 0
    ? remapped.steps
    : createSingleBrickSteps(placedBricks).map((step) => ({
      ...step,
      id: makeUniqueId('step', usedStepIds, idFactory),
    }))
  const placedIdSet = new Set(placedBricks.map((brick) => brick.id))
  const importedStructures = remapped.structures.map((structure) => ({
    ...structure,
    brickIds: structure.brickIds.filter((brickId) => placedIdSet.has(brickId)),
  })).filter((structure) => structure.brickIds.length > 0)
  const structures = [...(currentPlan.structures ?? []), ...importedStructures]

  return {
    importedBrickIds: placedBricks.map((brick) => brick.id),
    brickIdMap: remapped.brickIdMap,
    structureIdMap: remapped.structureIdMap,
    placementOffset: {
      x: placedBricks[0].pose.xStud - remapped.bricks[0].pose.xStud,
      y: placedBricks[0].pose.yStud - remapped.bricks[0].pose.yStud,
      z: placedBricks[0].pose.zStud - remapped.bricks[0].pose.zStud,
    },
    plan: {
      ...currentPlan,
      bricks: [...currentPlan.bricks, ...placedBricks],
      steps: [...currentPlan.steps, ...importedSteps],
      ...(structures.length > 0 ? { structures } : {}),
    },
  }
}
