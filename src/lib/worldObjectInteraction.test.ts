import { describe, expect, it } from 'vitest'
import type { BuildPlan, PlacedBrick } from '../types/bricks'
import type { WorldState } from '../types/world'
import { applyWorldObjectInteraction } from './worldObjectInteraction'

const makeBrick = (id: string, brickId: string): PlacedBrick => ({ id, brickId, color: 'brown', pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0 } })
const makePlan = (brick: PlacedBrick): BuildPlan => ({ id: 'plan', title: '', prompt: '', source: 'template-local', bricks: [brick], steps: [], structures: [] })
const makeWorld = (): WorldState => ({ id: 'world', planId: 'plan', randomSeed: 1, elapsedSeconds: 3, paused: true, entities: [], parties: [], events: [], pendingImpacts: [], scenarios: [], hiddenTargets: [], narrative: { processedEventIds: [], memoriesByEntityId: {}, cluesByEntityId: {}, relationshipsByEntityId: {}, stories: [], directorTurns: [] } })

describe('world object interaction', () => {
  it('opens doors and emits a deterministic world event', () => {
    const result = applyWorldObjectInteraction({ plan: makePlan(makeBrick('door', 'minecraft-oak-door')), world: makeWorld(), brickId: 'door', action: 'open', actorId: 'hero' })
    expect(result.ok).toBe(true)
    expect(result.plan.bricks[0].voxelState?.open).toBe(true)
    expect(result.world.events[0]).toMatchObject({ type: 'object-interaction', actorId: 'hero', targetId: 'door', objectAction: 'open' })
  })

  it('inspects chest contents without taking them', () => {
    const chest = { ...makeBrick('chest', 'minecraft-chest'), voxelState: { storyContents: [{ id: 'clue', title: 'Note', description: 'A clue' }] } }
    const result = applyWorldObjectInteraction({ plan: makePlan(chest), world: makeWorld(), brickId: 'chest', action: 'inspect' })
    expect(result.plan.bricks[0].voxelState?.storyContents?.[0]).toMatchObject({ discovered: true })
    expect(result.plan.bricks[0].voxelState?.storyContents?.[0].taken).toBeUndefined()
  })

  it('refuses hidden objects', () => {
    const world = { ...makeWorld(), hiddenTargets: [{ kind: 'brick' as const, id: 'door' }] }
    expect(applyWorldObjectInteraction({ plan: makePlan(makeBrick('door', 'minecraft-oak-door')), world, brickId: 'door', action: 'open' }).reason).toBe('HIDDEN_OBJECT')
  })

  it('refuses to open a door into another voxel block', () => {
    const plan = makePlan(makeBrick('door', 'minecraft-oak-door'))
    plan.bricks.push({ ...makeBrick('lamp', 'minecraft-lantern'), pose: { ...makeBrick('lamp', 'minecraft-lantern').pose, xStud: 0.8, zStud: 0.8 } })
    const world = makeWorld()
    const result = applyWorldObjectInteraction({ plan, world, brickId: 'door', action: 'open' })
    expect(result).toMatchObject({ ok: false, reason: 'BLOCKED' })
    expect(result.plan).toBe(plan)
    expect(result.world).toBe(world)
  })
})
