import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity, issueWorldEntityCommand } from './worldEntity'
import { findWorldPath, hasWorldLineOfSight, isWorldEntityGroundPointBlockedByBricks, stepWorldSimulation } from './worldSimulation'
import { getWorldEntityCollisionRadius } from './worldEntityCollision'
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

  it('approaches the near edge of a large occupied target area', () => {
    const path = findWorldPath(
      { x: -20, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      (x, z) => Math.abs(x) <= 16 && Math.abs(z) <= 16,
    )

    expect(path.length).toBeGreaterThan(0)
    expect(path.at(-1)).toMatchObject({ x: -16.5, z: 0 })
  })

  it('uses the navigation body footprint when validating NPC placement against bricks', () => {
    const knight = createWorldEntity(worldEntityDefinitionById.get('knight')!)
    const brick = makeBrick('brick-1x1', 'gray', 0, 0, 0)

    expect(isWorldEntityGroundPointBlockedByBricks(knight, { x: 0.5, z: 0.5 }, [brick])).toBe(true)
    expect(isWorldEntityGroundPointBlockedByBricks(knight, { x: 4, z: 4 }, [brick])).toBe(false)
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

  it('does not acquire hostile units outside its perception radius', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const observer = createWorldEntity(knight, {
      id: 'observer',
      factionId: 'blue',
      transform: { x: 0, z: 0 },
    })
    const distantEnemy = createWorldEntity(knight, {
      id: 'distant-enemy',
      controller: 'player',
      factionId: 'red',
      transform: { x: knight.perception.detectionRangeStuds + 2, z: 0 },
    })
    const world = { ...createEmptyWorldState('plan-1'), entities: [observer, distantEnemy] }

    const next = stepWorldSimulation(world, [], 0.1)

    expect(next.entities[0].activeCommand).toBeUndefined()
    expect(next.entities[0].behaviorState).toBe('idle')
  })

  it('makes ranged units retreat before firing at a target that is too close', () => {
    const archer = worldEntityDefinitionById.get('archer')!
    const knight = worldEntityDefinitionById.get('knight')!
    const ranged = createWorldEntity(archer, {
      id: 'retreating-archer',
      controller: 'player',
      factionId: 'blue',
      transform: { x: 0, z: 0 },
    })
    const enemy = createWorldEntity(knight, {
      id: 'close-enemy',
      controller: 'player',
      factionId: 'red',
      transform: { x: 2, z: 0 },
    })
    ranged.activeCommand = { type: 'attack', target: { kind: 'entity', id: enemy.id } }
    const world = { ...createEmptyWorldState('plan-1'), entities: [ranged, enemy] }

    const next = stepWorldSimulation(world, [], 0.1)

    expect(next.entities[0].transform.x).toBeLessThan(ranged.transform.x)
    expect(next.entities[0].behaviorState).toBe('moving')
    expect(next.events.some((event) => event.type === 'attack')).toBe(false)
  })

  it('turns slow vehicles toward their target without snapping their heading', () => {
    const catapult = worldEntityDefinitionById.get('catapult')!
    const knight = worldEntityDefinitionById.get('knight')!
    const attacker = createWorldEntity(catapult, {
      id: 'turning-catapult',
      controller: 'player',
      factionId: 'blue',
      transform: { x: 0, z: 0, rotationRadians: 0 },
    })
    const target = createWorldEntity(knight, {
      id: 'rear-target',
      controller: 'player',
      factionId: 'red',
      transform: { x: 0, z: -10 },
    })
    attacker.activeCommand = { type: 'attack', target: { kind: 'entity', id: target.id } }
    const world = { ...createEmptyWorldState('plan-1'), entities: [attacker, target] }

    const next = stepWorldSimulation(world, [], 0.1)
    const maximumTurn = catapult.movement.turningRadiansPerSecond * 0.1

    expect(Math.abs(next.entities[0].transform.rotationRadians)).toBeGreaterThan(0)
    expect(Math.abs(next.entities[0].transform.rotationRadians)).toBeLessThanOrEqual(maximumTurn + 0.000001)
  })

  it('turns a vehicle around before translating toward a path behind it', () => {
    const catapult = worldEntityDefinitionById.get('catapult')!
    const vehicle = createWorldEntity(catapult, {
      id: 'turn-before-moving',
      controller: 'player',
      transform: { x: 0, z: 0, rotationRadians: 0 },
    })
    const target = createWorldEntity(catapult, {
      id: 'rear-move-target',
      controller: 'player',
      transform: { x: 0, z: -12, rotationRadians: 0 },
    })
    vehicle.activeCommand = { type: 'move', target: { kind: 'entity', id: target.id } }
    const world = { ...createEmptyWorldState('plan-1'), entities: [vehicle, target] }

    const first = stepWorldSimulation(world, [], 0.1)

    expect(first.entities[0].transform.x).toBeCloseTo(vehicle.transform.x)
    expect(first.entities[0].transform.z).toBeCloseTo(vehicle.transform.z)
    expect(Math.abs(first.entities[0].transform.rotationRadians)).toBeGreaterThan(0)

    let turned = first
    for (let step = 0; step < 12; step += 1) turned = stepWorldSimulation(turned, [], 0.1)
    expect(turned.entities[0].transform.z).toBeLessThan(vehicle.transform.z)
  })

  it('clears behavior and queued orders when a unit is defeated', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const attacker = createWorldEntity(knight, {
      id: 'finisher',
      controller: 'player',
      factionId: 'blue',
      transform: { x: 0, z: 0 },
    })
    const victim = {
      ...createWorldEntity(knight, {
        id: 'ordered-victim',
        controller: 'player',
        factionId: 'red',
        transform: { x: 1.5, z: 0 },
      }),
      health: 1,
      activeCommand: { type: 'follow', target: { kind: 'entity', id: attacker.id } } as const,
      commandQueue: [{ type: 'attack', target: { kind: 'entity', id: attacker.id } } as const],
    }
    attacker.activeCommand = { type: 'attack', target: { kind: 'entity', id: victim.id } }
    const world = { ...createEmptyWorldState('plan-1'), entities: [attacker, victim] }

    const next = stepWorldSimulation(world, [], 0.1)

    expect(next.entities[1]).toMatchObject({
      health: 0,
      behaviorState: 'dead',
      commandQueue: [],
      navigation: { status: 'idle', path: [] },
    })
    expect(next.entities[1].activeCommand).toBeUndefined()
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

  it('ingests externally issued orders into character memory on the next fixed step', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const actor = createWorldEntity(knight, { id: 'actor', controller: 'player' })
    const world = { ...createEmptyWorldState('plan-1'), entities: [actor] }
    const issued = issueWorldEntityCommand(world, actor.id, { type: 'stop' }, undefined, 'replace')
    expect(issued.ok).toBe(true)
    if (!issued.ok) return

    const next = stepWorldSimulation(issued.world, [], 0.1)
    expect(next.narrative.memoriesByEntityId[actor.id]?.at(-1)).toMatchObject({ type: 'command-issued' })
  })

  it('turns a completed interaction order into social memory and affinity', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const actor = createWorldEntity(knight, { id: 'actor', controller: 'player', transform: { x: 0, z: 0 } })
    const target = createWorldEntity(knight, { id: 'target', controller: 'player', transform: { x: 0.1, z: 0 } })
    actor.activeCommand = { type: 'interact', target: { kind: 'entity', id: target.id } }
    const world = { ...createEmptyWorldState('plan-1'), entities: [actor, target] }

    const next = stepWorldSimulation(world, [], 0.1)
    expect(next.events.at(-1)).toMatchObject({ type: 'interaction', actorId: actor.id, targetId: target.id })
    expect(next.narrative.relationshipsByEntityId[actor.id][target.id].affinity).toBe(5)
    expect(next.narrative.relationshipsByEntityId[target.id][actor.id].affinity).toBe(5)
  })

  it('keeps follow orders active after reaching a safe following distance', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const follower = createWorldEntity(knight, { id: 'follower', controller: 'player', transform: { x: 0, z: 0 } })
    const leader = createWorldEntity(knight, { id: 'leader', controller: 'player', transform: { x: 1.5, z: 0 } })
    follower.activeCommand = { type: 'follow', target: { kind: 'entity', id: leader.id } }
    const world = { ...createEmptyWorldState('plan-1'), entities: [follower, leader] }

    const next = stepWorldSimulation(world, [], 0.1)

    expect(next.entities[0].activeCommand).toEqual(follower.activeCommand)
    expect(next.entities[0].behaviorState).toBe('following')
  })

  it('replans a completed follow path when the followed unit moves again', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const follower = createWorldEntity(knight, { id: 'dynamic-follower', controller: 'player', transform: { x: 0, z: 0 } })
    const leader = createWorldEntity(knight, { id: 'dynamic-leader', controller: 'player', transform: { x: 1.5, z: 0 } })
    follower.activeCommand = { type: 'follow', target: { kind: 'entity', id: leader.id } }
    let world = { ...createEmptyWorldState('plan-1'), entities: [follower, leader] }

    world = stepWorldSimulation(world, [], 0.1)
    expect(world.entities[0].behaviorState).toBe('following')

    world = {
      ...world,
      entities: [
        world.entities[0],
        { ...world.entities[1], transform: { ...world.entities[1].transform, x: 5 } },
      ],
    }
    const resumed = stepWorldSimulation(world, [], 0.1)

    expect(resumed.entities[0].behaviorState).toBe('moving')
    expect(resumed.entities[0].transform.x).toBeGreaterThan(world.entities[0].transform.x)
    expect(resumed.entities[0].activeCommand).toEqual(follower.activeCommand)
  })

  it('keeps guarding its post and intercepts hostile units inside the guard radius', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const guard = createWorldEntity(knight, {
      id: 'guard',
      controller: 'player',
      factionId: 'blue',
      transform: { x: 2, z: 0 },
    })
    const protectedUnit = createWorldEntity(knight, {
      id: 'protected',
      controller: 'player',
      factionId: 'blue',
      transform: { x: 0, z: 0 },
    })
    const intruder = createWorldEntity(knight, {
      id: 'intruder',
      controller: 'player',
      factionId: 'red',
      transform: { x: 3.5, z: 0 },
    })
    guard.activeCommand = { type: 'guard', target: { kind: 'entity', id: protectedUnit.id } }
    const world = { ...createEmptyWorldState('plan-1'), entities: [guard, protectedUnit, intruder] }

    const intercepting = stepWorldSimulation(world, [], 0.1)

    expect(intercepting.entities[2].health).toBeLessThan(intruder.health)
    expect(intercepting.entities[0].activeCommand).toEqual(guard.activeCommand)
    expect(intercepting.entities[0].behaviorState).toBe('attacking')

    const safeWorld = {
      ...world,
      entities: [
        { ...guard, transform: { ...guard.transform, x: 1.5 } },
        protectedUnit,
        { ...intruder, transform: { ...intruder.transform, x: 20 } },
      ],
    }
    const guarding = stepWorldSimulation(safeWorld, [], 0.1)
    expect(guarding.entities[0].activeCommand).toEqual(guard.activeCommand)
    expect(guarding.entities[0].behaviorState).toBe('guarding')
  })

  it('keeps a guard order after a delayed projectile defeats an intruder', () => {
    const archerDefinition = worldEntityDefinitionById.get('archer')!
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const guard = createWorldEntity(archerDefinition, {
      id: 'archer-guard',
      controller: 'player',
      factionId: 'blue',
      transform: { x: 0, z: 0 },
    })
    const protectedUnit = createWorldEntity(knightDefinition, {
      id: 'protected-archer-post',
      controller: 'player',
      factionId: 'blue',
      transform: { x: -2, z: 0 },
    })
    const intruder = {
      ...createWorldEntity(knightDefinition, {
        id: 'fragile-intruder',
        controller: 'player',
        factionId: 'red',
        transform: { x: 5, z: 0 },
      }),
      health: 1,
    }
    guard.activeCommand = { type: 'guard', target: { kind: 'entity', id: protectedUnit.id } }
    const world = { ...createEmptyWorldState('plan-1'), entities: [guard, protectedUnit, intruder] }

    const launched = stepWorldSimulation(world, [], 0.1)
    expect(launched.pendingImpacts).toHaveLength(1)

    const impacted = stepWorldSimulation(launched, [], 1)
    expect(impacted.entities[2].health).toBe(0)
    expect(impacted.entities[0].activeCommand).toEqual(guard.activeCommand)
  })

  it('blocks arrows with tall brick cover while leaving an open shot valid', () => {
    const archerDefinition = worldEntityDefinitionById.get('archer')!
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const archer = createWorldEntity(archerDefinition, { id: 'archer', factionId: 'red', transform: { x: 0, z: 0 } })
    const knight = createWorldEntity(knightDefinition, { id: 'knight', factionId: 'blue', transform: { x: 7, z: 0 } })
    archer.activeCommand = { type: 'attack', target: { kind: 'entity', id: knight.id } }
    const wall = [0, 1.2, 2.4, 3.6].map((y) => makeBrick('brick-2x2', 'gray', 3, y, -1))
    expect(hasWorldLineOfSight(archer, knight, [])).toBe(true)
    expect(hasWorldLineOfSight(archer, knight, wall)).toBe(false)

    const blockedWorld = { ...createEmptyWorldState('plan-1'), entities: [archer, knight] }
    const blocked = stepWorldSimulation(blockedWorld, wall, 0.1)
    expect(blocked.entities[1].health).toBe(knight.health)
    expect(blocked.events.some((event) => event.type === 'attack')).toBe(false)

    const launched = stepWorldSimulation(blockedWorld, [], 0.1)
    expect(launched.events.some((event) => event.type === 'attack')).toBe(true)
    expect(launched.entities[1].health).toBe(knight.health)
    expect(launched.pendingImpacts).toHaveLength(1)
    const impacted = stepWorldSimulation(launched, [], 0.8)
    expect(impacted.entities[1].health).toBeLessThan(knight.health)
    expect(impacted.pendingImpacts).toHaveLength(0)
  })

  it('lets idle rule-controlled allies socialize at a throttled deterministic cadence', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const first = createWorldEntity(knight, { id: 'first', factionId: 'neutral', transform: { x: 0, z: 0 } })
    const second = createWorldEntity(knight, { id: 'second', factionId: 'neutral', transform: { x: 0.1, z: 0 } })
    first.autonomy.nextDecisionAtSeconds = 0
    second.autonomy.nextDecisionAtSeconds = 100
    const world = { ...createEmptyWorldState('plan-1'), entities: [first, second] }

    const interacted = stepWorldSimulation(world, [], 0.1)
    expect(interacted.events.some((event) => event.type === 'interaction' && event.actorId === first.id)).toBe(true)
    expect(interacted.narrative.relationshipsByEntityId[first.id][second.id].affinity).toBe(5)
    expect(interacted.entities[0].autonomy.nextDecisionAtSeconds).toBeGreaterThan(interacted.elapsedSeconds + 6)

    const next = stepWorldSimulation(interacted, [], 0.1)
    expect(next.events.filter((event) => event.type === 'interaction')).toHaveLength(1)
  })

  it('keeps moving units outside each other body radius', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const red = createWorldEntity(knight, {
      id: 'red-moving',
      factionId: 'red',
      transform: { x: -5, z: 0 },
    })
    const blue = createWorldEntity(knight, {
      id: 'blue-moving',
      factionId: 'blue',
      transform: { x: 5, z: 0 },
    })
    let world = { ...createEmptyWorldState('plan-1'), entities: [red, blue] }

    for (let step = 0; step < 80; step += 1) world = stepWorldSimulation(world, [], 0.1)

    const distance = Math.hypot(
      world.entities[0].transform.x - world.entities[1].transform.x,
      world.entities[0].transform.z - world.entities[1].transform.z,
    )
    expect(distance).toBeGreaterThanOrEqual(
      getWorldEntityCollisionRadius(world.entities[0])
      + getWorldEntityCollisionRadius(world.entities[1])
      - 0.021,
    )
  })

  it('moves toward large occupied targets without getting stuck at their center', () => {
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const catapultDefinition = worldEntityDefinitionById.get('catapult')!
    const actor = createWorldEntity(knightDefinition, {
      id: 'commanded-knight',
      controller: 'player',
      transform: { x: 0, z: 0 },
    })
    const target = createWorldEntity(catapultDefinition, {
      id: 'large-target',
      controller: 'player',
      transform: { x: 12, z: 0 },
    })
    actor.activeCommand = { type: 'move', target: { kind: 'entity', id: target.id } }
    let world = { ...createEmptyWorldState('plan-1'), entities: [actor, target] }

    world = stepWorldSimulation(world, [], 0.1)
    expect(world.entities[0].behaviorState).toBe('moving')
    expect(world.entities[0].transform.x).toBeGreaterThan(actor.transform.x)

    for (let step = 0; step < 80; step += 1) world = stepWorldSimulation(world, [], 0.1)

    const movedActor = world.entities[0]
    const distance = Math.hypot(
      movedActor.transform.x - target.transform.x,
      movedActor.transform.z - target.transform.z,
    )
    expect(movedActor.activeCommand).toBeUndefined()
    expect(movedActor.behaviorState).toBe('idle')
    expect(distance).toBeGreaterThanOrEqual(
      getWorldEntityCollisionRadius(movedActor)
      + getWorldEntityCollisionRadius(target)
      - 0.021,
    )
  })

  it('repairs overlapping stored units before processing the next step', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const first = createWorldEntity(knight, { id: 'overlap-a', controller: 'player', transform: { x: 0, z: 0 } })
    const second = createWorldEntity(knight, { id: 'overlap-b', controller: 'player', transform: { x: 0, z: 0 } })
    const world = { ...createEmptyWorldState('plan-1'), entities: [first, second] }

    const next = stepWorldSimulation(world, [], 0.1)
    const distance = Math.hypot(
      next.entities[0].transform.x - next.entities[1].transform.x,
      next.entities[0].transform.z - next.entities[1].transform.z,
    )
    expect(distance).toBeGreaterThanOrEqual(
      getWorldEntityCollisionRadius(first) + getWorldEntityCollisionRadius(second) - 0.021,
    )
  })
})
