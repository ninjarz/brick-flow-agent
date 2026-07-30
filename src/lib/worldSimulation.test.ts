import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity, issueWorldEntityCommand, joinWorldParty } from './worldEntity'
import { findWorldPath, hasWorldLineOfSight, isWorldEntityGroundPointBlockedByBricks, stepWorldSimulation } from './worldSimulation'
import { getWorldEntityCollisionRadius } from './worldEntityCollision'
import { makeBrick } from './planUtils'
import { advanceWorldScenarios } from './worldScenarioRuntime'

describe('WorldEntity simulation', () => {
  it('does not create autonomous orders while directed playback owns the scene', () => {
    const actor = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'actor', controller: 'rule' })
    actor.autonomy.nextDecisionAtSeconds = 0
    const suspended = stepWorldSimulation(
      { ...createEmptyWorldState('plan'), entities: [actor] },
      [],
      0.1,
      [],
      { suspendAutomaticControllers: true },
    )

    expect(suspended.entities[0].activeCommand).toBeUndefined()
    expect(suspended.entities[0].commandQueue).toEqual([])
    expect(suspended.entities[0].behaviorState).toBe('idle')
  })

  it('keeps autonomous combat isolated between independent storylines', () => {
    const first = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'first', factionId: 'blue', transform: { x: 0, z: 0 } })
    const second = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'second', factionId: 'red', transform: { x: 3, z: 0 } })
    first.storylineId = 'story-a'
    second.storylineId = 'story-b'
    const world = stepWorldSimulation({ ...createEmptyWorldState('plan'), entities: [first, second] }, [], 0.1)

    expect(world.entities.every((entity) => entity.activeCommand?.type !== 'attack')).toBe(true)
    expect(world.events.some((event) => event.type === 'attack')).toBe(false)
  })

  it('lets active rule-controlled party members support the leader attack target', () => {
    const knight = createWorldEntity(worldEntityDefinitionById.get('knight')!, {
      id: 'party-leader',
      controller: 'player',
      factionId: 'blue',
      transform: { x: 0, z: 0 },
    })
    const archer = createWorldEntity(worldEntityDefinitionById.get('archer')!, {
      id: 'party-archer',
      controller: 'rule',
      factionId: 'blue',
      transform: { x: 0, z: 2 },
    })
    const enemy = createWorldEntity(worldEntityDefinitionById.get('knight')!, {
      id: 'party-enemy',
      controller: 'player',
      factionId: 'red',
      transform: { x: 8, z: 0 },
    })
    knight.activeCommand = { type: 'attack', target: { kind: 'entity', id: enemy.id } }
    let world = {
      ...createEmptyWorldState('party-combat'),
      entities: [knight, archer, enemy],
    }
    world = joinWorldParty(world, archer.id, knight.id)
    world = stepWorldSimulation(world, [], 0.1)

    expect(world.entities.find((entity) => entity.id === archer.id)?.activeCommand).toEqual({
      type: 'attack',
      target: { kind: 'entity', id: enemy.id },
    })
  })

  it('locks the full cast while scenario dialogue is playing', () => {
    const actor = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'actor' })
    actor.autonomy.nextDecisionAtSeconds = 0
    actor.commandQueue = [{ type: 'wander' }]
    const world = stepWorldSimulation({
      ...createEmptyWorldState('plan'),
      entities: [actor],
      scenarios: [{
        id: 'story', assetId: 'asset', title: 'Story', description: 'Story', castEntityIds: [actor.id], processedEventIds: [],
        activeDialogue: { stageId: 'stage', eventId: 'event', lineIndex: 0, lineEndsAtSeconds: 5 },
        stages: [{ id: 'stage', title: 'Stage', description: 'Stage', status: 'active', trigger: { eventType: 'interaction' }, dialogue: [{ id: 'line', speakerId: actor.id, text: 'Wait', durationSeconds: 5 }] }],
      }],
    }, [], 0.1)

    expect(world.entities[0].activeCommand).toBeUndefined()
    expect(world.entities[0].commandQueue).toEqual([])
    expect(world.entities[0].behaviorState).toBe('idle')
  })

  it('locks branch speakers and prevents outsiders from interrupting active dialogue', () => {
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const actor = createWorldEntity(knightDefinition, { id: 'dialogue-actor', factionId: 'blue' })
    const branchSpeaker = createWorldEntity(knightDefinition, { id: 'branch-speaker', factionId: 'red', transform: { x: 2, z: 0 } })
    const outsider = createWorldEntity(knightDefinition, { id: 'dialogue-outsider', factionId: 'red', transform: { x: 3, z: 0 } })
    actor.activeCommand = { type: 'attack', target: { kind: 'entity', id: branchSpeaker.id } }
    branchSpeaker.commandQueue = [{ type: 'attack', target: { kind: 'entity', id: actor.id } }]
    outsider.activeCommand = { type: 'attack', target: { kind: 'entity', id: actor.id } }
    const world = stepWorldSimulation({
      ...createEmptyWorldState('plan'),
      entities: [actor, branchSpeaker, outsider],
      scenarios: [{
        id: 'branch-story',
        assetId: 'asset',
        title: 'Branch story',
        description: 'Branch story',
        castEntityIds: [actor.id],
        processedEventIds: [],
        activeDialogue: {
          stageId: 'stage',
          branchId: 'branch',
          eventId: 'event',
          lineIndex: 0,
          lineEndsAtSeconds: 5,
        },
        stages: [{
          id: 'stage',
          title: 'Stage',
          description: 'Stage',
          status: 'active',
          trigger: { eventType: 'interaction' },
          branches: [{
            id: 'branch',
            title: 'Branch',
            trigger: { eventType: 'interaction' },
            dialogue: [{ id: 'branch-line', speakerId: branchSpeaker.id, text: 'Wait.', durationSeconds: 5 }],
          }],
        }],
      }],
    }, [], 0.1)

    expect(world.entities[0].activeCommand).toBeUndefined()
    expect(world.entities[1].commandQueue).toEqual([])
    expect(world.entities[1].behaviorState).toBe('idle')
    expect(world.entities[2].activeCommand).toBeUndefined()
    expect(world.entities[0].health).toBe(actor.health)
    expect(world.entities[1].health).toBe(branchSpeaker.health)
    expect(world.events.some((event) => event.type === 'attack')).toBe(false)
  })

  it('returns out-of-bounds units to the visible ground grid', () => {
    const actor = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'actor', transform: { x: 100, z: -100 } })
    const world = stepWorldSimulation({ ...createEmptyWorldState('plan'), entities: [actor] }, [], 0.1)
    expect(world.entities[0].transform.x).toBeLessThan(15)
    expect(world.entities[0].transform.z).toBeGreaterThan(-15)
  })

  it('keeps hidden units dormant and out of autonomous combat', () => {
    const guard = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'guard', factionId: 'blue', transform: { x: 0, z: 0 } })
    const ambusher = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'ambusher', factionId: 'red', transform: { x: 2, z: 0 } })
    ambusher.commandQueue = [{ type: 'attack', target: { kind: 'entity', id: guard.id } }]
    const world = stepWorldSimulation({
      ...createEmptyWorldState('plan'), entities: [guard, ambusher], hiddenTargets: [{ kind: 'entity', id: ambusher.id }],
    }, [], 0.5)

    expect(world.entities.find((entity) => entity.id === ambusher.id)?.commandQueue).toHaveLength(1)
    expect(world.events.some((event) => event.actorId === ambusher.id)).toBe(false)
    expect(world.entities.find((entity) => entity.id === guard.id)?.health).toBe(guard.health)
  })

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

    let next = world
    for (let step = 0; step < 15 && next.entities[1].health === blue.health; step += 1) {
      next = stepWorldSimulation(next, [], 0.1)
    }

    expect(next.entities[1].health).toBeLessThan(blue.health)
    expect(next.events.some((event) => event.type === 'damage')).toBe(true)
  })

  it('paces a standard melee takedown so hits remain readable', () => {
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const archerDefinition = worldEntityDefinitionById.get('archer')!
    const attacker = createWorldEntity(knightDefinition, {
      id: 'paced-attacker', controller: 'player', factionId: 'blue', transform: { x: 0, z: 0 },
    })
    const victim = createWorldEntity(archerDefinition, {
      id: 'paced-victim', controller: 'player', factionId: 'red', transform: { x: 1, z: 0 },
    })
    attacker.activeCommand = { type: 'attack', target: { kind: 'entity', id: victim.id } }
    let world = { ...createEmptyWorldState('plan-1'), entities: [attacker, victim] }

    for (let step = 0; step < 5; step += 1) world = stepWorldSimulation(world, [], 0.1)
    expect(world.entities[1].health).toBe(victim.health)
    for (let step = 0; step < 200 && world.entities[1].health > 0; step += 1) {
      world = stepWorldSimulation(world, [], 0.1)
    }

    expect(world.entities[1].health).toBe(0)
    expect(world.elapsedSeconds).toBeGreaterThanOrEqual(10)
    expect(world.elapsedSeconds).toBeLessThan(16)
  })

  it('lets multiple allied units attack the same target concurrently', () => {
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const archerDefinition = worldEntityDefinitionById.get('archer')!
    const priestDefinition = worldEntityDefinitionById.get('priest')!
    const target = {
      ...createWorldEntity(knightDefinition, {
        id: 'shared-target',
        controller: 'player',
        factionId: 'red',
        transform: { x: 7, z: 0 },
      }),
      health: 1_000,
      maxHealth: 1_000,
    }
    const attackers = [
      createWorldEntity(knightDefinition, {
        id: 'allied-knight', controller: 'player', factionId: 'blue', transform: { x: 0, z: -1.6 },
      }),
      createWorldEntity(archerDefinition, {
        id: 'allied-archer', controller: 'player', factionId: 'blue', transform: { x: 0, z: 0 },
      }),
      createWorldEntity(priestDefinition, {
        id: 'allied-priest', controller: 'player', factionId: 'blue', transform: { x: 0, z: 1.6 },
      }),
    ]
    for (const attacker of attackers) {
      attacker.activeCommand = { type: 'attack', target: { kind: 'entity', id: target.id } }
    }
    let world = { ...createEmptyWorldState('plan-1'), entities: [...attackers, target] }

    for (let step = 0; step < 160; step += 1) world = stepWorldSimulation(world, [], 0.1)

    const attackingActorIds = new Set(
      world.events
        .filter((event) => event.type === 'attack' && event.targetId === target.id)
        .map((event) => event.actorId),
    )
    expect(attackingActorIds).toEqual(new Set(attackers.map((attacker) => attacker.id)))
  })

  it('fans contact attackers into distinct engagement positions around one target', () => {
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const target = {
      ...createWorldEntity(knightDefinition, {
        id: 'formation-target',
        controller: 'player',
        factionId: 'red',
        transform: { x: 8, z: 0 },
      }),
      health: 10_000,
      maxHealth: 10_000,
    }
    const attackers = [-1.6, 0, 1.6].map((z, index) => {
      const attacker = createWorldEntity(knightDefinition, {
        id: `formation-attacker-${index}`,
        controller: 'player',
        factionId: 'blue',
        transform: { x: 0, z },
      })
      attacker.activeCommand = { type: 'attack', target: { kind: 'entity', id: target.id } }
      return attacker
    })
    let world = { ...createEmptyWorldState('plan-1'), entities: [...attackers, target] }

    world = stepWorldSimulation(world, [], 0.1)
    const plannedPositions = world.entities.slice(0, attackers.length)
      .map((entity) => entity.navigation.plannedTargetPoint)
    expect(new Set(plannedPositions.map((point) => `${point?.x.toFixed(2)}:${point?.z.toFixed(2)}`)).size).toBe(3)

    for (let step = 0; step < 180; step += 1) world = stepWorldSimulation(world, [], 0.1)

    const attackEvents = world.events.filter((event) => event.type === 'attack' && event.targetId === target.id)
    expect(new Set(attackEvents.map((event) => event.actorId))).toEqual(new Set(attackers.map((attacker) => attacker.id)))
    const settledAttackers = world.entities.slice(0, attackers.length)
    for (let left = 0; left < settledAttackers.length; left += 1) {
      for (let right = left + 1; right < settledAttackers.length; right += 1) {
        expect(Math.hypot(
          settledAttackers[left].transform.x - settledAttackers[right].transform.x,
          settledAttackers[left].transform.z - settledAttackers[right].transform.z,
        )).toBeGreaterThanOrEqual(
          getWorldEntityCollisionRadius(settledAttackers[left])
          + getWorldEntityCollisionRadius(settledAttackers[right])
          - 0.021,
        )
      }
    }
  })

  it('fans ranged attackers into distinct firing positions at a safe distance', () => {
    const archerDefinition = worldEntityDefinitionById.get('archer')!
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const target = {
      ...createWorldEntity(knightDefinition, {
        id: 'ranged-formation-target',
        controller: 'player',
        factionId: 'red',
        transform: { x: 12, z: 0 },
      }),
      health: 10_000,
      maxHealth: 10_000,
    }
    const attackers = [-1.6, 0, 1.6].map((z, index) => {
      const attacker = createWorldEntity(archerDefinition, {
        id: `ranged-formation-attacker-${index}`,
        controller: 'player',
        factionId: 'blue',
        transform: { x: 0, z },
      })
      attacker.activeCommand = { type: 'attack', target: { kind: 'entity', id: target.id } }
      return attacker
    })
    let world = { ...createEmptyWorldState('plan-1'), entities: [...attackers, target] }

    world = stepWorldSimulation(world, [], 0.1)
    const plannedPositions = world.entities.slice(0, attackers.length)
      .map((entity) => entity.navigation.plannedTargetPoint)
    expect(new Set(plannedPositions.map((point) => `${point?.x.toFixed(2)}:${point?.z.toFixed(2)}`)).size).toBe(3)

    for (let step = 0; step < 180; step += 1) world = stepWorldSimulation(world, [], 0.1)

    const attackEvents = world.events.filter((event) => event.type === 'attack' && event.targetId === target.id)
    expect(new Set(attackEvents.map((event) => event.actorId))).toEqual(new Set(attackers.map((attacker) => attacker.id)))
    for (const attacker of world.entities.slice(0, attackers.length)) {
      const distance = Math.hypot(
        attacker.transform.x - target.transform.x,
        attacker.transform.z - target.transform.z,
      )
      expect(distance).toBeGreaterThanOrEqual(archerDefinition.combat.minimumRangeStuds!)
      expect(distance).toBeLessThanOrEqual(archerDefinition.combat.attackRangeStuds)
    }
  })

  it('retreats instead of firing when a ranged target is inside minimum range', () => {
    const archerDefinition = worldEntityDefinitionById.get('archer')!
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const archer = createWorldEntity(archerDefinition, {
      id: 'retreating-archer',
      controller: 'player',
      factionId: 'blue',
      transform: { x: 0, z: 0 },
    })
    const target = createWorldEntity(knightDefinition, {
      id: 'close-target',
      controller: 'player',
      factionId: 'red',
      transform: { x: 1.8, z: 0 },
    })
    archer.activeCommand = { type: 'attack', target: { kind: 'entity', id: target.id } }
    const startingDistance = Math.hypot(
      archer.transform.x - target.transform.x,
      archer.transform.z - target.transform.z,
    )
    let world = { ...createEmptyWorldState('plan-1'), entities: [archer, target] }

    for (let step = 0; step < 8; step += 1) world = stepWorldSimulation(world, [], 0.1)

    const distance = Math.hypot(
      world.entities[0].transform.x - world.entities[1].transform.x,
      world.entities[0].transform.z - world.entities[1].transform.z,
    )
    expect(distance).toBeGreaterThan(startingDistance)
    expect(world.events.some((event) => event.type === 'attack' && event.actorId === archer.id)).toBe(false)
  })

  it('lets a priest revive a defeated unit after a readable cast time', () => {
    const priestDefinition = worldEntityDefinitionById.get('priest')!
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const priest = createWorldEntity(priestDefinition, {
      id: 'reviving-priest', controller: 'player', factionId: 'blue', transform: { x: 0, z: 0 },
    })
    const fallen = {
      ...createWorldEntity(knightDefinition, {
        id: 'fallen-knight', controller: 'player', factionId: 'blue', transform: { x: 1.5, z: 0 },
      }),
      health: 0,
      behaviorState: 'dead' as const,
    }
    priest.activeCommand = { type: 'revive', target: { kind: 'entity', id: fallen.id } }
    let world = { ...createEmptyWorldState('plan-1'), entities: [priest, fallen] }

    world = stepWorldSimulation(world, [], 0.1)
    expect(world.entities[1].health).toBe(0)
    expect(world.entities[0].behaviorState).toBe('reviving')
    for (let step = 0; step < 30 && world.entities[1].health === 0; step += 1) {
      world = stepWorldSimulation(world, [], 0.1)
    }

    expect(world.elapsedSeconds).toBeGreaterThanOrEqual(priestDefinition.support!.reviveWindupSeconds)
    expect(world.entities[1].health).toBe(Math.round(fallen.maxHealth * priestDefinition.support!.reviveHealthRatio))
    expect(world.entities[1].behaviorState).toBe('idle')
    expect(world.entities[0].activeCommand).toBeUndefined()
    expect(world.entities[0].combat.cooldownRemainingSeconds).toBe(priestDefinition.support!.reviveCooldownSeconds)
    expect(world.events.some((event) => event.type === 'revive' && event.targetId === fallen.id)).toBe(true)
  })

  it('makes an autonomous priest prioritize a defeated ally over a nearby enemy', () => {
    const priest = createWorldEntity(worldEntityDefinitionById.get('priest')!, {
      id: 'auto-priest', factionId: 'blue', transform: { x: 0, z: 0 },
    })
    const fallen = {
      ...createWorldEntity(worldEntityDefinitionById.get('knight')!, {
        id: 'fallen-ally', controller: 'player', factionId: 'blue', transform: { x: 5, z: 0 },
      }),
      health: 0,
      behaviorState: 'dead' as const,
    }
    const enemy = createWorldEntity(worldEntityDefinitionById.get('knight')!, {
      id: 'nearby-enemy', controller: 'player', factionId: 'red', transform: { x: 2, z: 0 },
    })

    const next = stepWorldSimulation({ ...createEmptyWorldState('plan-1'), entities: [priest, fallen, enemy] }, [], 0.1)

    expect(next.entities[0].activeCommand).toEqual({ type: 'revive', target: { kind: 'entity', id: fallen.id } })
    expect(next.entities[0].behaviorState).toBe('moving')
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

  it('keeps AI-controlled units active with local decisions between LLM turns', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const aiUnit = createWorldEntity(knight, {
      id: 'local-ai', controller: 'ai', factionId: 'blue', transform: { x: 0, z: 0 },
    })
    const enemy = createWorldEntity(knight, {
      id: 'local-enemy', controller: 'player', factionId: 'red', transform: { x: 1.4, z: 0 },
    })
    let next = { ...createEmptyWorldState('plan-1'), entities: [aiUnit, enemy] }
    for (let step = 0; step < 15 && next.entities[1].health === enemy.health; step += 1) {
      next = stepWorldSimulation(next, [], 0.1)
    }
    expect(next.entities[1].health).toBeLessThan(enemy.health)
    expect(next.entities[0].behaviorState).toBe('attacking')
  })

  it('prioritizes an enemy threatening an ally over a slightly closer idle enemy', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const defender = createWorldEntity(knight, {
      id: 'smart-defender', factionId: 'blue', transform: { x: 0, z: 0 },
    })
    const ally = createWorldEntity(knight, {
      id: 'threatened-ally', controller: 'player', factionId: 'blue', transform: { x: 2, z: 0 },
    })
    const idleEnemy = createWorldEntity(knight, {
      id: 'idle-enemy', controller: 'player', factionId: 'red', transform: { x: 1.2, z: 0 },
    })
    const threat = createWorldEntity(knight, {
      id: 'active-threat', controller: 'player', factionId: 'red', transform: { x: 2.4, z: 0 },
    })
    threat.activeCommand = { type: 'attack', target: { kind: 'entity', id: ally.id } }
    const next = stepWorldSimulation({
      ...createEmptyWorldState('plan-1'), entities: [defender, ally, idleEnemy, threat],
    }, [], 0.1)
    expect(next.entities[0].activeCommand).toEqual({ type: 'attack', target: { kind: 'entity', id: threat.id } })
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

    let next = world
    for (let step = 0; step < 15 && next.entities[1].health > 0; step += 1) {
      next = stepWorldSimulation(next, [], 0.1)
    }

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

    let next = world
    for (let step = 0; step < 10 && !next.events.some((event) => event.type === 'brick-hit'); step += 1) {
      next = stepWorldSimulation(next, [brick], 0.1)
    }

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

    const structures = [{
      id: 'gate-1',
      name: '城门',
      description: '',
      brickIds: [brick.id],
    }]
    let next = world
    for (let step = 0; step < 10 && !next.events.some((event) => event.type === 'structure-hit'); step += 1) {
      next = stepWorldSimulation(next, [brick], 0.1, structures)
    }

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

  it('shows a short self-talk bubble whenever the next queued command starts', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const actor = createWorldEntity(knight, { id: 'talking-actor', controller: 'player', transform: { x: 0, z: 0 } })
    const target = createWorldEntity(knight, { id: 'named-target', name: '城门守卫', controller: 'player', transform: { x: 1.5, z: 0 } })
    actor.commandQueue = [
      { type: 'move', target: { kind: 'entity', id: target.id } },
      { type: 'guard', target: { kind: 'entity', id: target.id } },
    ]
    let world = { ...createEmptyWorldState('plan-1'), entities: [actor, target] }

    world = stepWorldSimulation(world, [], 0.1)
    expect(world.entities[0].speech).toMatchObject({ message: 'move', targetName: target.name })
    expect(world.entities[0].speech!.expiresAtSeconds).toBeGreaterThan(world.elapsedSeconds)

    world = stepWorldSimulation(world, [], 0.1)
    expect(world.entities[0].speech).toMatchObject({ message: 'guard', targetName: target.name })

    world = stepWorldSimulation(world, [], 3.1)
    expect(world.entities[0].speech).toBeUndefined()
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
    expect(next.entities[0].speech).toMatchObject({ targetName: target.name })
    expect(next.entities[1].speech).toMatchObject({ targetName: actor.name })
  })

  it('normalizes a distant director reply to the active story trigger direction', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const roland = createWorldEntity(knight, { id: 'roland', controller: 'player', transform: { x: 0, z: 0 } })
    const eileen = createWorldEntity(knight, { id: 'eileen', controller: 'player', transform: { x: 0.1, z: 0 } })
    eileen.activeCommand = {
      type: 'interact',
      target: { kind: 'entity', id: roland.id },
      speechText: '断箭上的石粉来自旧采石场。',
    }
    const world = {
      ...createEmptyWorldState('story-plan'),
      entities: [roland, eileen],
      scenarios: [{
        id: 'story',
        assetId: 'story',
        title: '断箭',
        description: '断箭',
        processedEventIds: [],
        stages: [{
          id: 'ask-eileen',
          title: '询问艾琳',
          description: '询问艾琳',
          status: 'active' as const,
          trigger: { eventType: 'interaction' as const, actorId: roland.id, targetId: eileen.id },
          dialogue: [{ id: 'reply', speakerId: eileen.id, text: '旧采石场。', durationSeconds: 2 }],
          nextStageId: null,
        }],
      }],
    }

    const interacted = stepWorldSimulation(world, [], 0.1)
    expect(interacted.events.at(-1)).toMatchObject({
      type: 'interaction',
      actorId: roland.id,
      targetId: eileen.id,
    })
    const advanced = advanceWorldScenarios(interacted, { enableAi: false })
    expect(advanced.scenarios[0].activeDialogue?.stageId).toBe('ask-eileen')
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

    let intercepting = world
    for (let step = 0; step < 15 && intercepting.entities[2].health === intruder.health; step += 1) {
      intercepting = stepWorldSimulation(intercepting, [], 0.1)
    }

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

    let launched = world
    for (let step = 0; step < 15 && launched.pendingImpacts.length === 0; step += 1) {
      launched = stepWorldSimulation(launched, [], 0.1)
    }
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
    let blocked = blockedWorld
    for (let step = 0; step < 5; step += 1) blocked = stepWorldSimulation(blocked, wall, 0.1)
    expect(blocked.entities[1].health).toBe(knight.health)
    expect(blocked.events.some((event) => event.type === 'attack')).toBe(false)

    let flanking = blockedWorld
    for (let step = 0; step < 160 && !flanking.events.some((event) => event.type === 'attack'); step += 1) {
      flanking = stepWorldSimulation(flanking, wall, 0.1)
    }
    expect(flanking.events.some((event) => event.type === 'attack' && event.actorId === archer.id)).toBe(true)
    expect(Math.abs(flanking.entities[0].transform.z)).toBeGreaterThan(1)

    let launched = blockedWorld
    for (let step = 0; step < 15 && launched.pendingImpacts.length === 0; step += 1) {
      launched = stepWorldSimulation(launched, [], 0.1)
    }
    expect(launched.events.some((event) => event.type === 'attack')).toBe(true)
    expect(launched.entities[1].health).toBe(knight.health)
    expect(launched.pendingImpacts).toHaveLength(1)
    const impacted = stepWorldSimulation(launched, [], 0.8)
    expect(impacted.entities[1].health).toBeLessThan(knight.health)
    expect(impacted.pendingImpacts).toHaveLength(0)
  })

  it('lets melee units strike the near edge of a large target body', () => {
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const catapultDefinition = worldEntityDefinitionById.get('catapult')!
    const knight = createWorldEntity(knightDefinition, {
      id: 'large-target-attacker', controller: 'player', factionId: 'blue', transform: { x: 0, z: 0 },
    })
    const catapult = createWorldEntity(catapultDefinition, {
      id: 'large-target-victim', controller: 'player', factionId: 'red', transform: { x: 5, z: 0 },
    })
    knight.activeCommand = { type: 'attack', target: { kind: 'entity', id: catapult.id } }
    let world = { ...createEmptyWorldState('plan-1'), entities: [knight, catapult] }

    for (let step = 0; step < 15 && world.entities[1].health === catapult.health; step += 1) {
      world = stepWorldSimulation(world, [], 0.1)
    }

    expect(world.entities[1].health).toBeLessThan(catapult.health)
    expect(world.entities[1].combat.lastAttackerId).toBe(knight.id)
    expect(world.entities[1].combat.lastDamageAmount).toBe(knightDefinition.combat.damage)
  })

  it('lets a moving target dodge a projectile aimed at its launch position', () => {
    const archerDefinition = worldEntityDefinitionById.get('archer')!
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const archer = createWorldEntity(archerDefinition, {
      id: 'dodge-archer', controller: 'player', factionId: 'red', transform: { x: 0, z: 0 },
    })
    const knight = createWorldEntity(knightDefinition, {
      id: 'dodging-knight', controller: 'player', factionId: 'blue', transform: { x: 7, z: 0 },
    })
    archer.activeCommand = { type: 'attack', target: { kind: 'entity', id: knight.id } }
    let world = { ...createEmptyWorldState('plan-1'), entities: [archer, knight] }
    for (let step = 0; step < 15 && world.pendingImpacts.length === 0; step += 1) {
      world = stepWorldSimulation(world, [], 0.1)
    }
    expect(world.pendingImpacts).toHaveLength(1)
    world = {
      ...world,
      entities: [world.entities[0], {
        ...world.entities[1],
        transform: { ...world.entities[1].transform, x: 10 },
      }],
    }

    world = stepWorldSimulation(world, [], 1)

    expect(world.entities[1].health).toBe(knight.health)
    expect(world.events.some((event) => event.type === 'miss' && event.targetId === knight.id)).toBe(true)
  })

  it('makes a neutral autonomous unit retaliate against a recent attacker', () => {
    const knightDefinition = worldEntityDefinitionById.get('knight')!
    const aggressor = createWorldEntity(knightDefinition, {
      id: 'neutral-aggressor', controller: 'player', factionId: 'red', transform: { x: 0, z: 0 },
    })
    const neutral = createWorldEntity(knightDefinition, {
      id: 'retaliating-neutral', controller: 'rule', factionId: 'neutral', transform: { x: 1, z: 0 },
    })
    aggressor.activeCommand = { type: 'attack', target: { kind: 'entity', id: neutral.id } }
    let world = { ...createEmptyWorldState('plan-1'), entities: [aggressor, neutral] }
    for (let step = 0; step < 15 && world.entities[1].health === neutral.health; step += 1) {
      world = stepWorldSimulation(world, [], 0.1)
    }

    expect(world.entities[1].combat.lastAttackerId).toBe(aggressor.id)
    expect(world.entities[1].activeCommand).toEqual({ type: 'attack', target: { kind: 'entity', id: aggressor.id } })
    expect(world.entities[1].speech?.message).toBe('combat-hurt')
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
    expect(interacted.entities[0].activeCommand?.type).toBe('wander')

    let next = stepWorldSimulation(interacted, [], 0.1)
    expect(next.events.filter((event) => event.type === 'interaction')).toHaveLength(1)
    for (let step = 0; step < 40; step += 1) next = stepWorldSimulation(next, [], 0.1)
    const separation = Math.hypot(
      next.entities[0].transform.x - next.entities[1].transform.x,
      next.entities[0].transform.z - next.entities[1].transform.z,
    )
    expect(separation).toBeGreaterThan(
      getWorldEntityCollisionRadius(next.entities[0]) + getWorldEntityCollisionRadius(next.entities[1]) + 1,
    )
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
