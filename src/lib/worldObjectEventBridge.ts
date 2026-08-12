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
  const actionsByBrickId = new Map<string, NonNullable<WorldEvent['objectAction']>[]>()
  for (const event of pending) {
    if (!event.targetId || !event.objectAction) continue
    const actions = actionsByBrickId.get(event.targetId) ?? []
    actions.push(event.objectAction)
    actionsByBrickId.set(event.targetId, actions)
  }
  let changed = false
  const bricks = plan.bricks.map((brick) => {
    const actions = actionsByBrickId.get(brick.id)
    if (!actions) return brick
    const updated = actions.reduce((current, action) => applyWorldObjectActionToBrick(current, action) ?? current, brick)
    if (updated !== brick) changed = true
    return updated
  })
  return changed ? { ...plan, bricks } : plan
}
