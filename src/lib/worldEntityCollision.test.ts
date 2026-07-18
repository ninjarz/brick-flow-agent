import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createWorldEntity } from './worldEntity'
import {
  findNearestAvailableWorldEntityPoint,
  getWorldEntityCollisionRadius,
} from './worldEntityCollision'

describe('WorldEntity collision', () => {
  it('uses the full box footprint when reserving vehicle space', () => {
    const catapult = createWorldEntity(worldEntityDefinitionById.get('catapult')!)
    expect(getWorldEntityCollisionRadius(catapult)).toBeCloseTo(Math.hypot(3.6, 5.6) / 2)
  })

  it('moves a placement point to the nearest non-overlapping grid position', () => {
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const existing = createWorldEntity(knightDefinition, { id: 'existing', transform: { x: 0, z: 0 } })
    const placed = createWorldEntity(knightDefinition, { id: 'placed', transform: { x: 0, z: 0 } })

    const point = findNearestAvailableWorldEntityPoint(placed, placed.transform, [existing])!
    const distance = Math.hypot(point.x - existing.transform.x, point.z - existing.transform.z)

    expect(point).toBeDefined()
    expect(distance).toBeGreaterThanOrEqual(
      getWorldEntityCollisionRadius(existing) + getWorldEntityCollisionRadius(placed) - 0.021,
    )
  })

  it('moves placement away from externally blocked world geometry', () => {
    const knight = createWorldEntity(worldEntityDefinitionById.get('knight')!, {
      transform: { x: 0, z: 0 },
    })

    const point = findNearestAvailableWorldEntityPoint(knight, knight.transform, [], {
      isBlocked: ({ x, z }) => Math.abs(x) <= 1 && Math.abs(z) <= 1,
    })

    expect(point).toBeDefined()
    expect(Math.abs(point!.x) > 1 || Math.abs(point!.z) > 1).toBe(true)
  })
})
