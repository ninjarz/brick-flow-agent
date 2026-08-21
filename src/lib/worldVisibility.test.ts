import { describe, expect, it } from 'vitest'
import type { BrickStructure, PlacedBrick } from '../types/bricks'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createWorldHiddenTargetIndex, createWorldVisibilityIndex } from './worldVisibility'

const bricks: PlacedBrick[] = [
  { id: 'public', brickId: 'brick-1x1', color: 'gray', pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0 } },
  { id: 'secret', brickId: 'brick-1x1', color: 'gray', pose: { xStud: 1, yStud: 0, zStud: 0, rotationQuarterTurns: 0 } },
]
const structures: BrickStructure[] = [{ id: 'room', name: 'Room', description: '', brickIds: ['secret'] }]

describe('world visibility index', () => {
  it('preserves collection identity when nothing is hidden', () => {
    const world = createEmptyWorldState('plan')
    const index = createWorldVisibilityIndex(world, bricks, structures)
    expect(index.visibleEntities).toBe(world.entities)
    expect(index.visibleBricks).toBe(bricks)
    expect(index.visibleStructures).toBe(structures)
  })

  it('expands hidden structures to their bricks and filters hidden entities', () => {
    const entity = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'secret-guard' })
    const world = {
      ...createEmptyWorldState('plan'),
      entities: [entity],
      hiddenTargets: [
        { kind: 'entity' as const, id: entity.id },
        { kind: 'structure' as const, id: 'room' },
      ],
    }
    const index = createWorldVisibilityIndex(world, bricks, structures)
    expect(index.visibleEntities).toEqual([])
    expect(index.visibleStructures).toEqual([])
    expect(index.visibleBricks.map((brick) => brick.id)).toEqual(['public'])
    expect(index.hiddenBrickIds).toContain('secret')
  })

  it('builds the hidden target index without requiring world collections', () => {
    const index = createWorldHiddenTargetIndex([{ kind: 'structure', id: 'room' }], structures)
    expect(index.hiddenStructureIds).toEqual(new Set(['room']))
    expect(index.hiddenBrickIds).toEqual(new Set(['secret']))
  })
})
