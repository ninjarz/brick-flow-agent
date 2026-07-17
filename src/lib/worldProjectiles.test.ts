import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createWorldEntity } from './worldEntity'
import { getWorldProjectileVisuals, sampleWorldProjectilePosition } from './worldProjectiles'

describe('world projectile visuals', () => {
  it('creates visible ranged projectiles but not melee projectiles', () => {
    const archer = createWorldEntity(worldEntityDefinitionById.get('archer')!, { id: 'archer', transform: { x: 0, z: 0 } })
    const knight = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'knight', transform: { x: 8, z: 0 } })
    const event = { id: 'event-1', timeSeconds: 2, type: 'attack' as const, actorId: archer.id, targetId: knight.id }
    expect(getWorldProjectileVisuals([event], [archer, knight], 2)).toHaveLength(1)
    expect(getWorldProjectileVisuals([{ ...event, actorId: knight.id, targetId: archer.id }], [archer, knight], 2)).toHaveLength(0)
  })

  it('samples a ballistic arc and expires old visuals', () => {
    const catapult = createWorldEntity(worldEntityDefinitionById.get('catapult')!, { id: 'catapult', transform: { x: 0, z: 0 } })
    const knight = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'knight', transform: { x: 10, z: 0 } })
    const event = { id: 'event-1', timeSeconds: 5, type: 'attack' as const, actorId: catapult.id, targetId: knight.id }
    const projectile = getWorldProjectileVisuals([event], [catapult, knight], 5)[0]
    const middle = sampleWorldProjectilePosition(projectile, 5 + projectile.lifetimeSeconds / 2)
    expect(middle.x).toBeCloseTo(5)
    expect(middle.y).toBeGreaterThan(projectile.start.y)
    expect(middle.progress).toBeCloseTo(0.5)
    expect(getWorldProjectileVisuals([event], [catapult, knight], 7)).toHaveLength(0)
  })
})
