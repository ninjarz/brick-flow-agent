import type { BuildPlan, PlacedBrick } from '../types/bricks'
import type { WorldEvent, WorldObjectActionKind, WorldState } from '../types/world'
import { getVoxelInteractionKind, isVoxelDoorStateClear } from './voxelBlockState'

export type WorldObjectInteractionResult = {
  ok: boolean
  plan: BuildPlan
  world: WorldState
  reason?: 'MISSING_OBJECT' | 'UNSUPPORTED_ACTION' | 'HIDDEN_OBJECT' | 'BLOCKED'
}

export const applyWorldObjectActionToBrick = (brick: PlacedBrick, action: WorldObjectActionKind): PlacedBrick | undefined => {
  const kind = getVoxelInteractionKind(brick)
  if (!kind) return undefined
  if (action === 'inspect') {
    if (kind !== 'chest') return undefined
    return {
      ...brick,
      voxelState: {
        ...brick.voxelState,
        open: true,
        storyContents: brick.voxelState?.storyContents?.map((item) => ({ ...item, discovered: true })),
      },
    }
  }
  if (kind === 'lantern') {
    if (action === 'open' || action === 'close') return undefined
    const powered = action === 'power-on' ? true : action === 'power-off' ? false : brick.voxelState?.powered === false
    return { ...brick, voxelState: { ...brick.voxelState, powered } }
  }
  if (action === 'power-on' || action === 'power-off') return undefined
  const open = action === 'open' ? true : action === 'close' ? false : !brick.voxelState?.open
  return { ...brick, voxelState: { ...brick.voxelState, open } }
}

export const applyWorldObjectInteraction = ({
  plan,
  world,
  brickId,
  action,
  actorId = 'world',
}: {
  plan: BuildPlan
  world: WorldState
  brickId: string
  action: WorldObjectActionKind
  actorId?: string
}): WorldObjectInteractionResult => {
  const brick = plan.bricks.find((candidate) => candidate.id === brickId)
  if (!brick) return { ok: false, plan, world, reason: 'MISSING_OBJECT' }
  if (world.hiddenTargets.some((target) => target.kind === 'brick' && target.id === brickId)) {
    return { ok: false, plan, world, reason: 'HIDDEN_OBJECT' }
  }
  const updated = applyWorldObjectActionToBrick(brick, action)
  if (!updated) return { ok: false, plan, world, reason: 'UNSUPPORTED_ACTION' }
  if (brick.voxelState?.open !== updated.voxelState?.open && !isVoxelDoorStateClear(updated, plan.bricks)) {
    return { ok: false, plan, world, reason: 'BLOCKED' }
  }
  const event: WorldEvent = {
    id: `world-object-${brickId}-${Math.round(world.elapsedSeconds * 1000)}-${world.events.length}`,
    timeSeconds: world.elapsedSeconds,
    type: 'object-interaction',
    actorId,
    targetId: brickId,
    objectAction: action,
  }
  return {
    ok: true,
    plan: { ...plan, bricks: plan.bricks.map((candidate) => candidate.id === brickId ? updated : candidate) },
    world: { ...world, events: [...world.events, event].slice(-500) },
  }
}
