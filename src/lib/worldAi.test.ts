import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { applyWorldAiTurn, buildWorldAiTurnPrompt, createWorldAiSnapshot, parseWorldAiJson } from './worldAi'

const makeWorld = () => {
  const definition = worldEntityDefinitionById.get('knight')!
  const world = createEmptyWorldState('plan-test')
  return {
    ...world,
    entities: [
      createWorldEntity(definition, { id: 'ai-knight', name: 'Ada', controller: 'ai', factionId: 'blue', transform: { x: 2 } }),
      createWorldEntity(definition, { id: 'rule-knight', name: 'Bran', controller: 'rule', factionId: 'red', transform: { x: 8 } }),
    ],
  }
}

describe('world AI adapter', () => {
  it('builds a readonly ID-addressable snapshot and prompt', () => {
    const world = makeWorld()
    const snapshot = createWorldAiSnapshot(world, [{
      id: 'brick-1', brickId: 'lego-brick-2x2', color: 'gray',
      pose: { xStud: 4, yStud: 0, zStud: 2, rotationQuarterTurns: 0 },
    }], [{ id: 'tower-1', name: 'Tower', description: 'A tower', brickIds: ['brick-1'] }])
    expect(snapshot.entities[0]).toMatchObject({ id: 'ai-knight', position: { x: 2, y: 0, z: 0 } })
    expect(snapshot.structures[0]).toMatchObject({ id: 'tower-1', brickCount: 1, position: { x: 4, y: 0, z: 2 } })
    expect(buildWorldAiTurnPrompt(snapshot)).toContain('Never return coordinates')
  })

  it('caps large brick snapshots to the nearest relevant targets', () => {
    const world = makeWorld()
    const bricks = Array.from({ length: 300 }, (_, index) => ({
      id: `brick-${index}`,
      brickId: 'lego-brick-1x1',
      color: 'gray' as const,
      pose: { xStud: index, yStud: 0, zStud: 0, rotationQuarterTurns: 0 as const },
    }))
    const snapshot = createWorldAiSnapshot(world, bricks)
    expect(snapshot.brickCount).toBe(300)
    expect(snapshot.brickSnapshotTruncated).toBe(true)
    expect(snapshot.bricks).toHaveLength(240)
    expect(snapshot.bricks.some((brick) => brick.id === 'brick-2')).toBe(true)
    expect(snapshot.bricks.some((brick) => brick.id === 'brick-299')).toBe(false)
  })

  it('accepts an ID-based command without directly changing the transform', () => {
    const world = makeWorld()
    const result = applyWorldAiTurn(world, {
      commands: [{ entityId: 'ai-knight', type: 'attack', target: { kind: 'entity', id: 'rule-knight' } }],
      story: { title: 'A Challenge', body: 'Ada challenged Bran.' },
    })
    expect(result.accepted).toBe(1)
    expect(result.rejected).toEqual([])
    expect(result.world.entities[0].transform).toEqual(world.entities[0].transform)
    expect(result.world.entities[0].commandQueue).toEqual([{ type: 'attack', target: { kind: 'entity', id: 'rule-knight' } }])
    expect(result.story).toMatchObject({ source: 'ai', title: 'A Challenge' })
  })

  it('rejects direct state mutation, unknown IDs, self targets, and non-AI actors', () => {
    const world = makeWorld()
    const result = applyWorldAiTurn(world, { commands: [
      { entityId: 'ai-knight', type: 'move', target: { kind: 'entity', id: 'rule-knight' }, position: { x: 999 } },
      { entityId: 'missing', type: 'stop' },
      { entityId: 'ai-knight', type: 'follow', target: { kind: 'entity', id: 'ai-knight' } },
      { entityId: 'rule-knight', type: 'stop' },
    ] })
    expect(result.accepted).toBe(0)
    expect(result.rejected.map((rejection) => rejection.issue)).toEqual([
      'DIRECT_STATE_MUTATION', 'ENTITY_NOT_FOUND', 'SELF_TARGET', 'ENTITY_NOT_AI_CONTROLLED',
    ])
    expect(result.world).toBe(world)
  })

  it('validates brick and structure target IDs', () => {
    const world = makeWorld()
    const accepted = applyWorldAiTurn(world, {
      commands: [{ entityId: 'ai-knight', type: 'guard', target: { kind: 'structure', id: 'tower-1' } }],
    }, { structures: [{ id: 'tower-1', name: 'Tower', description: '', brickIds: [] }] })
    expect(accepted.accepted).toBe(1)

    const rejected = applyWorldAiTurn(world, {
      commands: [{ entityId: 'ai-knight', type: 'interact', target: { kind: 'brick', id: 'missing' } }],
    })
    expect(rejected.rejected[0].issue).toBe('TARGET_NOT_FOUND')
  })

  it('parses plain and fenced JSON responses', () => {
    expect(parseWorldAiJson('{"commands":[]}')).toEqual({ commands: [] })
    expect(parseWorldAiJson('```json\n{"commands":[]}\n```')).toEqual({ commands: [] })
  })
})
