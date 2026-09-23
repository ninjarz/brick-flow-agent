import type { BuildPlan } from '../types/bricks'
import type { WorldEvent } from '../types/world'
import { applyWorldObjectActionToBrick } from './worldObjectInteraction'
import { isVoxelDoorStateClear } from './voxelBlockState'

export const applyPendingWorldObjectEvents = (
  plan: BuildPlan,
  events: WorldEvent[],
  appliedEventIds: Set<string>,
): BuildPlan => {
  const pending = events.filter((event) => event.type === 'object-interaction' && !appliedEventIds.has(event.id))
  if (pending.length === 0) return plan
  for (const event of pending) appliedEventIds.add(event.id)
  const indexById = new Map(plan.bricks.map((brick, index) => [brick.id, index]))
  let updatedBricks: BuildPlan['bricks'] | undefined
  for (const event of pending) {
    if (!event.targetId || !event.objectAction) continue
    const index = indexById.get(event.targetId)
    if (index === undefined) continue
    const bricks = updatedBricks ?? plan.bricks
    const previous = bricks[index]
    const updated = applyWorldObjectActionToBrick(previous, event.objectAction)
    if (!updated || (previous.voxelState?.open !== updated.voxelState?.open && !isVoxelDoorStateClear(updated, bricks))) continue
    updatedBricks ??= [...plan.bricks]
    updatedBricks[index] = updated
  }
  return updatedBricks ? { ...plan, bricks: updatedBricks } : plan
}
