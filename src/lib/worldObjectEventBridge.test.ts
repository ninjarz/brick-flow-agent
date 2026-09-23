import { describe, expect, it } from 'vitest'
import type { BuildPlan } from '../types/bricks'
import type { WorldEvent } from '../types/world'
import { applyPendingWorldObjectEvents } from './worldObjectEventBridge'

const plan: BuildPlan = { id: 'plan', title: '', prompt: '', source: 'template-local', bricks: [{ id: 'door', brickId: 'minecraft-oak-door', color: 'brown', pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0 } }], steps: [] }
const event: WorldEvent = { id: 'open', timeSeconds: 1, type: 'object-interaction', actorId: 'hero', targetId: 'door', objectAction: 'open' }

describe('world object event bridge', () => {
  it('applies each event exactly once', () => {
    const applied = new Set<string>()
    const opened = applyPendingWorldObjectEvents(plan, [event], applied)
    expect(opened.bricks[0].voxelState?.open).toBe(true)
    expect(applyPendingWorldObjectEvents(opened, [event], applied)).toBe(opened)
  })

  it('preserves repeated action order for the same object', () => {
    const applied = new Set<string>()
    const toggles: WorldEvent[] = [
      { ...event, id: 'toggle-1', objectAction: 'toggle' },
      { ...event, id: 'toggle-2', timeSeconds: 2, objectAction: 'toggle' },
    ]
    const result = applyPendingWorldObjectEvents(plan, toggles, applied)
    expect(result.bricks[0].voxelState?.open).toBe(false)
    expect(applied).toEqual(new Set(['toggle-1', 'toggle-2']))
  })

  it('ignores a door opening event when its leaf is obstructed', () => {
    const blockedPlan: BuildPlan = { ...plan, bricks: [
      ...plan.bricks,
      { id: 'lamp', brickId: 'minecraft-lantern', color: 'yellow', pose: { xStud: 0.8, yStud: 0, zStud: 0.8, rotationQuarterTurns: 0 as const } },
    ] }
    const applied = new Set<string>()
    expect(applyPendingWorldObjectEvents(blockedPlan, [event], applied)).toBe(blockedPlan)
    expect(applied.has(event.id)).toBe(true)
  })
})
