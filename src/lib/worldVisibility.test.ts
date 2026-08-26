import { describe, expect, it } from 'vitest'
import type { BrickStructure, PlacedBrick } from '../types/bricks'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createWorldHiddenTargetIndex, createWorldVisibilityIndex, isWorldEventVisible, isWorldStoryVisible } from './worldVisibility'

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

  it('keeps hidden participants out of visible events and stories', () => {
    const entity = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'secret-guard' })
    const world = {
      ...createEmptyWorldState('plan'),
      entities: [entity],
      events: [
        { id: 'public-event', timeSeconds: 1, type: 'interaction' as const, actorId: 'public' },
        { id: 'actor-hidden', timeSeconds: 2, type: 'interaction' as const, actorId: 'secret-guard' },
        { id: 'target-hidden', timeSeconds: 3, type: 'interaction' as const, actorId: 'public', targetId: 'secret-guard' },
      ],
      narrative: {
        ...createEmptyWorldState('plan').narrative,
        stories: [
          { id: 'unattributed-story', title: 'Unattributed', body: 'A public tale without authored participants.', createdAtSeconds: 1, eventIds: [], characterIds: undefined, blocks: [{ type: 'narration' as const, text: 'Visible.' }], source: 'local' as const },
          { id: 'legacy-unattributed-story', title: 'Legacy Unattributed', body: 'A public tale without authored participants.', createdAtSeconds: 2, eventIds: [], source: 'local' as const },
          { id: 'block-secret', title: 'Block Secret', body: '', createdAtSeconds: 3, eventIds: [], blocks: [{ type: 'dialogue' as const, speakerId: 'secret-guard', text: 'Secret' }], source: 'local' as const },
        ],
      },
      hiddenTargets: [{ kind: 'entity' as const, id: 'secret-guard' }],
    }
    const index = createWorldVisibilityIndex(world, bricks, structures)

    expect(index.visibleEntities).toEqual([])
    expect(index.visibleEvents.map((event) => event.id)).toEqual(['public-event'])
    expect(index.visibleStories.map((story) => story.id)).toEqual(['unattributed-story', 'legacy-unattributed-story'])
    expect(isWorldEventVisible(world.events[2], index.hiddenEntityIds)).toBe(false)
    expect(isWorldStoryVisible({ characterIds: [], blocks: [], body: '' }, new Set(['public']))).toBe(true)
  })

  it('preserves event and story identity when no entities are hidden', () => {
    const world = createEmptyWorldState('plan')
    const index = createWorldVisibilityIndex(world, bricks, structures)
    expect(index.visibleEvents).toBe(world.events)
  })

  it('hides stories only when authored participants are absent', () => {
    expect(isWorldStoryVisible({
      body: 'A public tale',
      blocks: undefined,
      characterIds: undefined,
    }, new Set())).toBe(true)
  })
})
