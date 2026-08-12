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
})
