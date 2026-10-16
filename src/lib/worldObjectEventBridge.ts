import type { BuildPlan } from '../types/bricks'
import type { WorldEvent, WorldState } from '../types/world'
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

/** New snapshots consume events and update the model in one workspace commit.
 * Legacy snapshots have no cursor: their historical events are treated as
 * already applied, avoiding another non-idempotent toggle during migration.
 */
export const consumeWorldObjectEvents = (plan: BuildPlan, world: WorldState) => {
  const eventIds = world.events.filter((event) => event.type === 'object-interaction').map((event) => event.id)
  const applied = new Set(world.appliedObjectEventIds ?? eventIds)
  const nextPlan = applyPendingWorldObjectEvents(plan, world.events, applied)
  const retained = eventIds.filter((id) => applied.has(id))
  const previous = world.appliedObjectEventIds
  const unchanged = previous && previous.length === retained.length && previous.every((id, index) => id === retained[index])
  return { plan: nextPlan, world: unchanged ? world : { ...world, appliedObjectEventIds: retained } }
}
