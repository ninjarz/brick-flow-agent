import { describe, expect, it } from 'vitest'
import { maxWorldCoordinate, gridCellIndices } from './worldCoordinates'
import { normalizeHorizontalStud } from './brickUnits'
import { isValidImportedPose } from './planImport'
import { createEmptyWorldState, createWorldEntity, parseStoredWorldState } from './worldEntity'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createWorldEntityOccupancyIndex } from './worldEntityCollision'
import { createWorldObstacleIndex } from './worldObstacleIndex'
import { makeBrick } from './planUtils'

describe('world coordinate boundaries', () => {
  it.each([1e18, 1e308, -1e308])('bounds normalization and rejects imported coordinates %s', (value) => {
    expect(Math.abs(normalizeHorizontalStud(value))).toBeLessThanOrEqual(maxWorldCoordinate)
    expect(isValidImportedPose({ xStud: value, yStud: 0, zStud: 0, rotationQuarterTurns: 0 })).toBe(false)
    expect(isValidImportedPose({ xStud: 0, yStud: value, yPlate: 0, zStud: 0, rotationQuarterTurns: 0 })).toBe(false)
    const entity = createWorldEntity(worldEntityDefinitionById.get('knight')!)
    const restored = parseStoredWorldState({ ...createEmptyWorldState('plan'), entities: [{ ...entity, transform: { ...entity.transform, x: value } }] }, 'plan')!
    expect(restored).toBeUndefined()
  })

  it('fails fast for unsafe indices even if callers bypass import validation', () => {
    const entity = createWorldEntity(worldEntityDefinitionById.get('knight')!)
    entity.transform.x = 1e18
    expect(() => createWorldEntityOccupancyIndex([entity])).toThrow('WORLD_COORDINATE_OUT_OF_RANGE')
    const brick = makeBrick('minecraft-stone-block', 'gray', 0, 0, 0)
    brick.pose.xStud = 1e18
    expect(() => createWorldObstacleIndex([brick])).toThrow('WORLD_COORDINATE_OUT_OF_RANGE')
    expect(() => [...gridCellIndices(0, maxWorldCoordinate, 2)]).toThrow('WORLD_SPATIAL_RANGE_TOO_LARGE')
    expect([...gridCellIndices(-2, 3, 2)]).toEqual([-1, 0, 1])
  })
})
