import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { stepWorldSimulation } from './worldSimulation'
import { inspectWorldScenarioRuntime } from './worldScenarioDiagnostics'

describe('world simulation soak invariants', () => {
  it('keeps a mixed npc encounter finite and bounded for 1,000 fixed steps', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    let world = {
      ...createEmptyWorldState('soak'),
      entities: Array.from({ length: 24 }, (_, index) => createWorldEntity(knight, {
        id: `npc-${index}`,
        factionId: index % 2 ? 'red' : 'blue',
        transform: { x: index % 6 * 3, z: Math.floor(index / 6) * 3 },
      })),
    }
    for (let step = 0; step < 1_000; step += 1) world = stepWorldSimulation(world, [], 0.1)
    expect(world.events.length).toBeLessThanOrEqual(500)
    expect(world.pendingImpacts.length).toBeLessThanOrEqual(100)
    expect(inspectWorldScenarioRuntime(world)).toEqual([])
    for (const entity of world.entities) {
      expect(Number.isFinite(entity.transform.x)).toBe(true)
      expect(Number.isFinite(entity.transform.z)).toBe(true)
      expect(entity.health).toBeGreaterThanOrEqual(0)
      expect(entity.health).toBeLessThanOrEqual(entity.maxHealth)
      expect(entity.commandQueue.length).toBeLessThanOrEqual(8)
    }
  }, 10_000)
})
