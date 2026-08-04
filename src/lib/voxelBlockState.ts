import { brickById } from '../data/basicBricks'
import type { BuildPlan, PlacedBrick, VoxelFenceConnections } from '../types/bricks'

const coordinateTolerance = 0.001

const isNear = (left: number, right: number) => Math.abs(left - right) <= coordinateTolerance

const isFence = (brick: PlacedBrick) =>
  brickById.get(brick.brickId)?.voxelVisual?.shape === 'fence'

const canFenceConnectTo = (brick: PlacedBrick) => {
  const definition = brickById.get(brick.brickId)
  const visual = definition?.voxelVisual
  if (!definition || !visual || visual.shape === 'cross') return false
  if (visual.shape === 'fence') return true
  return visual.renderLayer === 'opaque' && definition.footprint.heightStuds >= 1
}

export const getFenceConnections = (
  source: PlacedBrick,
  bricks: PlacedBrick[],
): VoxelFenceConnections => {
  const centerX = source.pose.xStud + 0.5
  const centerZ = source.pose.zStud + 0.5
  const connections: VoxelFenceConnections = {
    north: false,
    east: false,
    south: false,
    west: false,
  }

  for (const target of bricks) {
    if (target.id === source.id || !canFenceConnectTo(target)) continue
    if (!isNear(target.pose.yStud, source.pose.yStud)) continue
    const targetDefinition = brickById.get(target.brickId)
    if (!targetDefinition) continue
    const targetCenterX = target.pose.xStud + targetDefinition.footprint.widthStuds / 2
    const targetCenterZ = target.pose.zStud + targetDefinition.footprint.depthStuds / 2
    const dx = targetCenterX - centerX
    const dz = targetCenterZ - centerZ

    if (isNear(dx, 0) && isNear(dz, -1)) connections.north = true
    if (isNear(dx, 1) && isNear(dz, 0)) connections.east = true
    if (isNear(dx, 0) && isNear(dz, 1)) connections.south = true
    if (isNear(dx, -1) && isNear(dz, 0)) connections.west = true
  }

  return connections
}

const sameFenceConnections = (
  left: VoxelFenceConnections | undefined,
  right: VoxelFenceConnections,
) => Boolean(left) && (
  left!.north === right.north &&
  left!.east === right.east &&
  left!.south === right.south &&
  left!.west === right.west
)

export const synchronizeVoxelBlockStates = (bricks: PlacedBrick[]) => {
  let changed = false
  const nextBricks = bricks.map((brick) => {
    if (!isFence(brick)) return brick
    const fenceConnections = getFenceConnections(brick, bricks)
    if (sameFenceConnections(brick.voxelState?.fenceConnections, fenceConnections)) return brick
    changed = true
    return {
      ...brick,
      voxelState: {
        ...brick.voxelState,
        fenceConnections,
      },
    }
  })
  return changed ? nextBricks : bricks
}

export const synchronizePlanVoxelBlockStates = (plan: BuildPlan): BuildPlan => {
  const bricks = synchronizeVoxelBlockStates(plan.bricks)
  return bricks === plan.bricks ? plan : { ...plan, bricks }
}

export const getStairRotationFromViewDirection = (x: number, z: number): 0 | 1 | 2 | 3 => {
  if (Math.abs(x) > Math.abs(z)) return x >= 0 ? 1 : 3
  return z >= 0 ? 0 : 2
}

export const getSlabHalfFromSurface = (
  y: number,
  normalY: number,
): 'bottom' | 'top' => {
  if (normalY < -0.5) return 'top'
  if (normalY > 0.5) return 'bottom'
  const fractionalY = ((y % 1) + 1) % 1
  return fractionalY >= 0.5 ? 'top' : 'bottom'
}

export const isVoxelPlantSupported = (plant: PlacedBrick, bricks: PlacedBrick[]) => {
  if (brickById.get(plant.brickId)?.voxelVisual?.shape !== 'cross') return true
  const centerX = plant.pose.xStud + 0.5
  const centerZ = plant.pose.zStud + 0.5

  return bricks.some((candidate) => {
    if (candidate.id === plant.id) return false
    const definition = brickById.get(candidate.brickId)
    const visual = definition?.voxelVisual
    if (!definition || !visual || visual.shape === 'cross' || visual.shape === 'fence') return false
    const topY = candidate.pose.yStud + definition.footprint.heightStuds
    if (!isNear(topY, plant.pose.yStud)) return false
    return centerX > candidate.pose.xStud + coordinateTolerance &&
      centerX < candidate.pose.xStud + definition.footprint.widthStuds - coordinateTolerance &&
      centerZ > candidate.pose.zStud + coordinateTolerance &&
      centerZ < candidate.pose.zStud + definition.footprint.depthStuds - coordinateTolerance
  })
}

export type VoxelPlacementSurface = {
  x: number
  y: number
  z: number
  normalX: number
  normalY: number
  normalZ: number
  viewDirectionX: number
  viewDirectionZ: number
}

export const applyVoxelPlacementSurface = (
  bricks: PlacedBrick[],
  surface: VoxelPlacementSurface,
) => bricks.map((brick) => {
  const shape = brickById.get(brick.brickId)?.voxelVisual?.shape
  if (shape === 'stairs') {
    return {
      ...brick,
      pose: {
        ...brick.pose,
        rotationQuarterTurns: getStairRotationFromViewDirection(
          surface.viewDirectionX,
          surface.viewDirectionZ,
        ),
      },
    }
  }
  if (shape !== 'slab') return brick

  const slabHalf = getSlabHalfFromSurface(surface.y, surface.normalY)
  const currentHalf = brick.voxelState?.slabHalf ?? 'bottom'
  const yDelta = slabHalf === currentHalf ? 0 : slabHalf === 'top' ? 0.5 : -0.5
  return {
    ...brick,
    pose: {
      ...brick.pose,
      yStud: brick.pose.yStud + yDelta,
    },
    voxelState: {
      ...brick.voxelState,
      slabHalf,
    },
  }
})
