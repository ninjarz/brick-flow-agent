import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById, worldEntityDefinitions } from '../data/worldEntityDefinitions'
import type { WorldState } from '../types/world'
import { changeWorldEntityController, createEmptyWorldState, createWorldEntity, generateWorldEntityName, issueWorldEntityCommand, parseStoredWorldState } from './worldEntity'

describe('WorldEntity foundation', () => {
  it('gives every catalog unit a usable name source and physical scale', () => {
    for (const definition of worldEntityDefinitions) {
      expect(definition.nameCandidates.length).toBeGreaterThan(0)
      expect(definition.nameCandidates.every((name) => name.trim().length > 0)).toBe(true)
      expect(definition.visual.heightStuds).toBeGreaterThan(0)
      expect(definition.body.heightStuds).toBeGreaterThan(0)
    }
  })

  it('selects deterministic candidate names and keeps names unique', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    expect(generateWorldEntityName(knight, [], () => 0)).toBe('亚瑟')
    expect(generateWorldEntityName(knight, ['亚瑟'], () => 0)).toBe('罗兰')

    const duplicate = createWorldEntity(knight, {
      name: '亚瑟',
      existingNames: ['亚瑟'],
      id: 'knight-2',
    })
    expect(duplicate.name).toBe('亚瑟 2')
  })

  it('queues high-level target commands without changing runtime coordinates', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const archer = worldEntityDefinitionById.get('archer')!
    const source = createWorldEntity(knight, {
      id: 'knight-1',
      transform: { x: 2, y: 0, z: 4 },
    })
    const target = createWorldEntity(archer, { id: 'archer-1' })
    const world: WorldState = {
      ...createEmptyWorldState('plan-1'),
      id: 'world-1',
      randomSeed: 42,
      entities: [source, target],
    }

    const result = issueWorldEntityCommand(world, source.id, {
      type: 'move',
      target: { kind: 'entity', id: target.id },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.world.entities[0].transform).toEqual(source.transform)
    expect(result.world.entities[0].commandQueue).toEqual([
      { type: 'move', target: { kind: 'entity', id: target.id } },
    ])
  })

  it('reserves structure targets and validates them through a resolver', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const source = createWorldEntity(knight, { id: 'knight-1' })
    const world: WorldState = {
      ...createEmptyWorldState('plan-1'),
      id: 'world-1',
      randomSeed: 42,
      entities: [source],
    }

    const result = issueWorldEntityCommand(
      world,
      source.id,
      { type: 'guard', target: { kind: 'structure', id: 'gate-1' } },
      (target) => target.kind === 'structure' && target.id === 'gate-1',
    )

    expect(result.ok).toBe(true)
  })

  it('clears stale autonomous work when control ownership changes', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const entity = {
      ...createWorldEntity(knight, { id: 'knight-control' }),
      activeCommand: { type: 'attack', target: { kind: 'entity', id: 'enemy' } } as const,
      commandQueue: [{ type: 'stop' } as const],
      behaviorState: 'attacking' as const,
      navigation: {
        status: 'moving' as const,
        target: { kind: 'entity', id: 'enemy' } as const,
        path: [{ x: 1, y: 0, z: 1 }],
        pathIndex: 0,
      },
    }
    const changed = changeWorldEntityController(entity, 'ai')
    expect(changed).toMatchObject({ controller: 'ai', behaviorState: 'idle', commandQueue: [], navigation: { status: 'idle', path: [] } })
    expect(changed.activeCommand).toBeUndefined()
    expect(changeWorldEntityController(changed, 'ai')).toBe(changed)
  })

  it('can replace the active order without directly changing the transform', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const actor = {
      ...createWorldEntity(knight, { id: 'actor', controller: 'ai' }),
      activeCommand: { type: 'move', target: { kind: 'entity', id: 'old-target' } } as const,
      commandQueue: [{ type: 'stop' } as const],
    }
    const target = createWorldEntity(knight, { id: 'target' })
    const world = { ...createEmptyWorldState('plan'), entities: [actor, target] }
    const result = issueWorldEntityCommand(
      world,
      actor.id,
      { type: 'attack', target: { kind: 'entity', id: target.id } },
      undefined,
      'replace',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.world.entities[0].activeCommand).toBeUndefined()
    expect(result.world.entities[0].commandQueue).toEqual([{ type: 'attack', target: { kind: 'entity', id: 'target' } }])
    expect(result.world.entities[0].transform).toEqual(actor.transform)
  })

  it('restores a stored world only for its matching build plan', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const world = {
      ...createEmptyWorldState('plan-1'),
      entities: [createWorldEntity(knight, { id: 'knight-1', name: '守门人' })],
    }

    expect(parseStoredWorldState(world, 'plan-1')).toEqual(world)
    expect(parseStoredWorldState(world, 'plan-2')).toBeUndefined()
  })
})
