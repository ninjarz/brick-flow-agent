import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { findWorldPath, stepWorldSimulation } from './worldSimulation'
import { makeBrick } from './planUtils'

describe('WorldEntity simulation', () => {
  it('finds a deterministic ground path around blocked cells', () => {
    const path = findWorldPath(
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      (x, z) => x > 1 && x < 3 && Math.abs(z) < 0.6,
    )

    expect(path.length).toBeGreaterThan(0)
    expect(path.some((point) => Math.abs(point.z) >= 1)).toBe(true)
    expect(path.at(-1)).toMatchObject({ x: 4, z: 0 })
  })

  it('automatically acquires and damages a nearby hostile unit', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const red = createWorldEntity(knight, {
      id: 'red-knight',
      factionId: 'red',
      transform: { x: 0, z: 0 },
    })
    const blue = createWorldEntity(knight, {
      id: 'blue-knight',
      factionId: 'blue',
      transform: { x: 1, z: 0 },
    })
    const world = {
      ...createEmptyWorldState('plan-1'),
      entities: [red, blue],
    }

    const next = stepWorldSimulation(world, [], 0.1)

    expect(next.entities[1].health).toBeLessThan(blue.health)
    expect(next.events.some((event) => event.type === 'damage')).toBe(true)
  })

  it('emits brick hits without mutating the build bricks', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const brick = makeBrick('brick-1x1', 'gray', 0, 0, 0)
    const attacker = createWorldEntity(knight, {
      id: 'attacker',
      factionId: 'red',
      transform: { x: 0.5, z: 0.5 },
    })
    attacker.activeCommand = { type: 'attack', target: { kind: 'brick', id: brick.id } }
    const world = {
      ...createEmptyWorldState('plan-1'),
      entities: [attacker],
    }
    const before = JSON.stringify(brick)

    const next = stepWorldSimulation(world, [brick], 0.1)

    expect(next.events.some((event) => event.type === 'brick-hit' && event.targetId === brick.id)).toBe(true)
    expect(JSON.stringify(brick)).toBe(before)
  })

  it('resolves solidified structures as stable command targets', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const brick = makeBrick('brick-1x1', 'gray', 0, 0, 0)
    const attacker = createWorldEntity(knight, {
      id: 'attacker',
      factionId: 'red',
      transform: { x: 0.5, z: 0.5 },
    })
    attacker.activeCommand = { type: 'attack', target: { kind: 'structure', id: 'gate-1' } }
    const world = { ...createEmptyWorldState('plan-1'), entities: [attacker] }

    const next = stepWorldSimulation(world, [brick], 0.1, [{
      id: 'gate-1',
      name: '城门',
      description: '',
      brickIds: [brick.id],
    }])

    expect(next.events.some((event) => event.type === 'structure-hit' && event.targetId === 'gate-1')).toBe(true)
  })
})
