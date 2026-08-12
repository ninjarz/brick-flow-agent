import type { BuildPlan } from '../types/bricks'
import type { WorldEvent } from '../types/world'
import { applyWorldObjectActionToBrick } from './worldObjectInteraction'

export const applyPendingWorldObjectEvents = (
  plan: BuildPlan,
  events: WorldEvent[],
  appliedEventIds: Set<string>,
): BuildPlan => {
  const pending = events.filter((event) => event.type === 'object-interaction' && !appliedEventIds.has(event.id))
  if (pending.length === 0) return plan
  for (const event of pending) appliedEventIds.add(event.id)
  const actionByBrickId = new Map(pending.flatMap((event) => event.targetId && event.objectAction ? [[event.targetId, event.objectAction] as const] : []))
  let changed = false
  const bricks = plan.bricks.map((brick) => {
    const action = actionByBrickId.get(brick.id)
    if (!action) return brick
    const updated = applyWorldObjectActionToBrick(brick, action)
    if (!updated) return brick
    changed = true
    return updated
  })
  return changed ? { ...plan, bricks } : plan
}
