import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById, worldEntityDefinitions } from '../data/worldEntityDefinitions'
import type { WorldState } from '../types/world'
import { changeAllWorldEntityControllers, changeWorldEntityController, createEmptyWorldState, createWorldEntity, generateWorldEntityName, issueWorldEntityCommand, issueWorldPartyOrder, joinWorldParty, leaveWorldParty, parseStoredWorldState, setWorldPartyMemberStatus } from './worldEntity'
import { getWorldEntityCollisionRadius } from './worldEntityCollision'

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
    expect(result.world.entities[0].mind.goals).toEqual([
      expect.objectContaining({
        summary: `move ${target.name}`,
        commandType: 'move',
        status: 'active',
        target: { kind: 'entity', id: target.id },
      }),
    ])
    expect(result.world.events.at(-1)).toMatchObject({
      type: 'command-issued',
      actorId: source.id,
      actorName: source.name,
      targetId: target.id,
      targetName: target.name,
      commandType: 'move',
      commandSource: 'rule',
    })
  })

  it('queues a targetless wander command without changing runtime coordinates', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const source = createWorldEntity(knight, {
      id: 'wandering-knight',
      transform: { x: 2, y: 0, z: 4 },
    })
    const world = { ...createEmptyWorldState('plan-1'), entities: [source] }

    const result = issueWorldEntityCommand(world, source.id, { type: 'wander' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.world.entities[0].transform).toEqual(source.transform)
    expect(result.world.entities[0].commandQueue).toEqual([{ type: 'wander' }])
    expect(result.world.entities[0].mind.goals).toEqual([
      expect.objectContaining({ summary: 'wander', commandType: 'wander', status: 'active' }),
    ])
    expect(result.world.events.at(-1)).toMatchObject({
      type: 'command-issued',
      actorId: source.id,
      commandType: 'wander',
    })
  })

  it('allows only support units to target defeated entities for revival', () => {
    const priest = createWorldEntity(worldEntityDefinitionById.get('priest')!, { id: 'priest' })
    const knight = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'knight' })
    const fallen = { ...createWorldEntity(worldEntityDefinitionById.get('archer')!, { id: 'fallen' }), health: 0 }
    const world = { ...createEmptyWorldState('plan-1'), entities: [priest, knight, fallen] }

    const accepted = issueWorldEntityCommand(world, priest.id, {
      type: 'revive', target: { kind: 'entity', id: fallen.id },
    })
    expect(accepted.ok).toBe(true)

    const unsupported = issueWorldEntityCommand(world, knight.id, {
      type: 'revive', target: { kind: 'entity', id: fallen.id },
    })
    expect(unsupported).toMatchObject({ ok: false, issue: 'UNSUPPORTED_COMMAND' })

    const livingTarget = issueWorldEntityCommand(world, priest.id, {
      type: 'revive', target: { kind: 'entity', id: knight.id },
    })
    expect(livingTarget).toMatchObject({ ok: false, issue: 'TARGET_NOT_DEFEATED' })
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

  it('changes every unit controller through the global control mode', () => {
    const knight = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'global-knight', controller: 'player' })
    const archer = {
      ...createWorldEntity(worldEntityDefinitionById.get('archer')!, { id: 'global-archer', controller: 'rule' }),
      commandQueue: [{ type: 'wander' } as const],
      behaviorState: 'moving' as const,
    }
    const world = { ...createEmptyWorldState('global-plan'), entities: [knight, archer] }

    const changed = changeAllWorldEntityControllers(world, 'ai')
    expect(changed.entities.map((entity) => entity.controller)).toEqual(['ai', 'ai'])
    expect(changed.entities.every((entity) => entity.commandQueue.length === 0 && entity.behaviorState === 'idle')).toBe(true)
    expect(changeAllWorldEntityControllers(changed, 'ai')).toBe(changed)
  })

  it('creates a formal party, manages reserves, and issues group orders', () => {
    const definition = worldEntityDefinitionById.get('knight')!
    const leader = createWorldEntity(definition, { id: 'party-leader', controller: 'player' })
    const member = createWorldEntity(definition, { id: 'party-member', controller: 'player' })
    let world = {
      ...createEmptyWorldState('party-plan'),
      entities: [leader, member],
    }

    world = joinWorldParty(world, member.id, leader.id, { partyName: '灰鸦调查队' })
    expect(world.parties[0]).toMatchObject({
      name: '灰鸦调查队',
      leaderId: leader.id,
      members: [
        { entityId: leader.id, status: 'active' },
        { entityId: member.id, status: 'active' },
      ],
    })
    expect(world.entities.map((entity) => entity.partyId)).toEqual([
      `party-${leader.id}`,
      `party-${leader.id}`,
    ])

    world = issueWorldPartyOrder(world, world.parties[0].id, 'follow-leader')
    expect(world.entities[0].commandQueue).toEqual([{ type: 'stop' }])
    expect(world.entities[1].commandQueue).toEqual([{
      type: 'follow',
      target: { kind: 'entity', id: leader.id },
    }])

    world = setWorldPartyMemberStatus(world, world.parties[0].id, member.id, 'reserve')
    expect(world.parties[0].members[1].status).toBe('reserve')
    world = leaveWorldParty(world, member.id)
    expect(world.parties[0].members).toHaveLength(1)
    expect(world.entities[1].partyId).toBeUndefined()
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

  it('migrates the removed AI unit controller to rule control', () => {
    const legacyEntity = createWorldEntity(worldEntityDefinitionById.get('knight')!, {
      id: 'legacy-ai',
      controller: 'ai',
    })
    const restored = parseStoredWorldState({
      ...createEmptyWorldState('legacy-controller'),
      entities: [legacyEntity],
    }, 'legacy-controller')

    expect(restored?.entities[0].controller).toBe('rule')
  })

  it('migrates the legacy single focus into a bounded goal agenda', () => {
    const legacyEntity = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'legacy-focus' })
    const storedEntity = {
      ...legacyEntity,
      mind: {
        spark: legacyEntity.mind.spark,
        focus: {
          summary: '调查旧采石场',
          source: 'player',
          updatedAtSeconds: 12,
          target: { kind: 'structure', id: 'quarry' },
        },
      },
    }
    const restored = parseStoredWorldState({
      ...createEmptyWorldState('legacy-focus-plan'),
      entities: [storedEntity],
    }, 'legacy-focus-plan')

    expect(restored?.entities[0].mind.goals).toEqual([
      expect.objectContaining({
        summary: '调查旧采石场',
        source: 'player',
        status: 'active',
        target: { kind: 'structure', id: 'quarry' },
      }),
    ])
  })

  it('upgrades legacy Gray Raven stages with contact-triggered dialogue', () => {
    const world = {
      ...createEmptyWorldState('gray-raven-plan'),
      scenarios: [{
        id: 'legacy-runtime', assetId: 'scenario-border-tavern', title: '没有归来的商队', description: '旧存档', processedEventIds: [],
        stages: [
          { id: 'scenario-border-tavern-investigate', title: '询问', description: '询问', status: 'active' as const, trigger: { eventType: 'command-issued' as const, actorId: 'roland', targetId: 'eileen', commandType: 'interact' as const } },
          { id: 'scenario-border-tavern-confront', title: '对质', description: '对质', status: 'locked' as const, trigger: { eventType: 'command-issued' as const, actorId: 'roland', targetId: 'envoy', commandType: 'interact' as const } },
        ],
      }],
    }

    const restored = parseStoredWorldState(world, world.planId)!
    expect(restored.scenarios[0].authoringVersion).toBe(6)
    expect(restored.scenarios[0].stages[0].trigger).toMatchObject({ eventType: 'interaction', actorId: 'roland', targetId: 'eileen' })
    expect(restored.scenarios[0].stages[0].trigger.commandType).toBeUndefined()
    expect(restored.scenarios[0].stages[0].dialogue).toHaveLength(3)
    expect(restored.scenarios[0].stages[1].dialogue?.at(-1)?.speakerId).toBe('envoy')
    expect(restored.scenarios[0].stages[1].branches).toBeUndefined()
    expect(restored.scenarios[1]).toMatchObject({
      assetId: 'scenario-border-tavern-eileen-companion',
      castEntityIds: ['roland', 'eileen'],
    })
    expect(restored.scenarios[1].stages[0].trigger.conditions?.mode).toBe('all')
    expect(restored.scenarios[1].stages[0].trigger.conditions?.conditions[0]).toMatchObject({
      type: 'affinity',
      actorId: 'roland',
      targetId: 'eileen',
      value: 45,
    })
  })

  it('repairs a completed Gray Raven retreat so the envoy exits and stops fighting', () => {
    const definition = worldEntityDefinitionById.get('knight')!
    const roland = createWorldEntity(definition, { id: 'roland', name: '罗兰' })
    const eileen = createWorldEntity(definition, { id: 'eileen', name: '艾琳' })
    const envoy = {
      ...createWorldEntity(definition, { id: 'envoy', name: '黑岩使者', factionId: 'neutral' }),
      activeCommand: { type: 'attack', target: { kind: 'entity', id: eileen.id } } as const,
      commandQueue: [{ type: 'attack', target: { kind: 'entity', id: eileen.id } } as const],
      behaviorState: 'attacking' as const,
    }
    const world = {
      ...createEmptyWorldState('gray-raven-retreat-plan'),
      entities: [roland, eileen, envoy],
      scenarios: [{
        id: 'legacy-runtime',
        assetId: 'scenario-border-tavern',
        title: '没有归来的商队',
        description: '旧存档',
        processedEventIds: [],
        authoringVersion: 3,
        outcomeId: 'gray-raven-retreat',
        stages: [
          { id: 'scenario-border-tavern-investigate', title: '询问', description: '询问', status: 'completed' as const, trigger: { eventType: 'interaction' as const, actorId: roland.id, targetId: eileen.id } },
          { id: 'scenario-border-tavern-confront', title: '对质', description: '对质', status: 'completed' as const, trigger: { eventType: 'interaction' as const, actorId: roland.id, targetId: envoy.id } },
          {
            id: 'scenario-border-tavern-defend',
            title: '守卫',
            description: '守卫',
            status: 'completed' as const,
            trigger: { eventType: 'defeated' as const, targetId: envoy.id },
            branches: [{
              id: 'gray-raven-retreat',
              title: '撤退',
              trigger: { eventType: 'defeated' as const, targetId: roland.id },
              actions: [
                { type: 'set-faction' as const, entityId: envoy.id, factionId: 'neutral' },
                { type: 'issue-command' as const, entityId: envoy.id, command: { type: 'stop' as const } },
              ],
            }],
          },
        ],
      }],
    }

    const restored = parseStoredWorldState(world, world.planId)!
    const restoredEnvoy = restored.entities.find((entity) => entity.id === envoy.id)!
    expect(restored.scenarios[0].authoringVersion).toBe(6)
    expect(restored.scenarios[0].stages[2].branches?.[0].actions).toContainEqual({
      type: 'set-visibility',
      target: { kind: 'entity', id: envoy.id },
      visible: false,
      delaySeconds: 2.5,
    })
    expect(restored.hiddenTargets).toContainEqual({ kind: 'entity', id: envoy.id })
    expect(restoredEnvoy.activeCommand).toBeUndefined()
    expect(restoredEnvoy.commandQueue).toEqual([])
    expect(restoredEnvoy.behaviorState).toBe('idle')
  })

  it('migrates matching stored director dialogue into a pending conversation fact', () => {
    const definition = worldEntityDefinitionById.get('knight')!
    const roland = createWorldEntity(definition, { id: 'roland', name: '罗兰', controller: 'player' })
    const eileen = createWorldEntity(definition, { id: 'eileen', name: '艾琳' })
    const stored = {
      ...createEmptyWorldState('dialogue-plan'),
      entities: [roland, eileen],
      scenarios: [{
        id: 'story',
        assetId: 'custom',
        title: 'Story',
        description: 'Story',
        processedEventIds: [],
        stages: [{
          id: 'talk',
          title: 'Talk',
          description: 'Talk',
          status: 'active' as const,
          trigger: { eventType: 'interaction' as const, actorId: roland.id, targetId: eileen.id },
        }],
      }],
      narrative: {
        ...createEmptyWorldState('dialogue-plan').narrative,
        directorTurns: [{
          id: 'old-turn',
          playerText: '和艾琳聊聊。',
          createdAtSeconds: 12,
          status: 'completed' as const,
          entries: [{ id: 'line', type: 'dialogue' as const, speakerId: eileen.id, text: '北路有异动。' }],
        }],
      },
    }
    const restored = parseStoredWorldState(stored, stored.planId)!
    expect(restored.events).toContainEqual(expect.objectContaining({
      type: 'interaction',
      actorId: roland.id,
      targetId: eileen.id,
      timeSeconds: 12,
    }))
  })

  it('preserves explicitly terminal authored stages while restoring storage', () => {
    const stored = {
      ...createEmptyWorldState('terminal-plan'),
      scenarios: [{
        id: 'terminal-story',
        assetId: 'custom',
        title: 'Terminal story',
        description: 'Terminal story',
        processedEventIds: [],
        stages: [{
          id: 'ending',
          title: 'Ending',
          description: 'Ending',
          status: 'active',
          trigger: { eventType: 'interaction' },
          nextStageId: null,
        }],
      }],
    }

    const restored = parseStoredWorldState(JSON.parse(JSON.stringify(stored)), stored.planId)!

    expect(restored.scenarios[0].stages[0].nextStageId).toBeNull()
  })

  it('separates overlapping units while restoring a paused stored world', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const first = createWorldEntity(knight, { id: 'stored-a', transform: { x: 0, z: 0 } })
    const second = createWorldEntity(knight, { id: 'stored-b', transform: { x: 0, z: 0 } })
    const restored = parseStoredWorldState({
      ...createEmptyWorldState('plan-overlap'),
      paused: true,
      entities: [first, second],
    }, 'plan-overlap')!

    const distance = Math.hypot(
      restored.entities[0].transform.x - restored.entities[1].transform.x,
      restored.entities[0].transform.z - restored.entities[1].transform.z,
    )
    expect(distance).toBeGreaterThanOrEqual(
      getWorldEntityCollisionRadius(first) + getWorldEntityCollisionRadius(second) - 0.021,
    )
  })

  it('rejects non-finite entity transforms and sanitizes unsafe runtime state', () => {
    const knight = worldEntityDefinitionById.get('knight')!
    const entity = createWorldEntity(knight, { id: 'safe-knight', name: '守门人' })
    const world = createEmptyWorldState('plan-1')
    expect(parseStoredWorldState({
      ...world,
      entities: [{ ...entity, transform: { ...entity.transform, x: Number.NaN } }],
    }, world.planId)).toBeUndefined()

    const restored = parseStoredWorldState({
      ...world,
      randomSeed: Number.POSITIVE_INFINITY,
      entities: [{
        ...entity,
        navigation: null,
        autonomy: undefined,
        commandQueue: [
          { type: 'move', target: { kind: 'entity', id: 'target' } },
          { type: 'teleport', x: 999 },
        ],
      }],
      pendingImpacts: [{
        id: 'bad-impact', actorId: entity.id, target: { kind: 'waypoint', id: 'x' },
        damage: 10, projectileKind: 'arrow', impactAtSeconds: 2,
      }],
      narrative: {
        processedEventIds: ['event-1', 3],
        memoriesByEntityId: { [entity.id]: 'broken' },
        relationshipsByEntityId: { [entity.id]: { broken: { affinity: 'high' } } },
        stories: [{ id: 'broken' }],
      },
    }, world.planId)
    expect(restored).toBeDefined()
    expect(restored?.randomSeed).toBe(1)
    expect(restored?.entities[0].navigation).toEqual({ status: 'idle', path: [], pathIndex: 0 })
    expect(restored?.entities[0].commandQueue).toEqual([{ type: 'move', target: { kind: 'entity', id: 'target' } }])
    expect(restored?.entities[0].autonomy.nextDecisionAtSeconds).toBeGreaterThanOrEqual(2)
    expect(restored?.pendingImpacts).toEqual([])
    expect(restored?.narrative).toMatchObject({
      processedEventIds: ['event-1'],
      memoriesByEntityId: { [entity.id]: [] },
      relationshipsByEntityId: { [entity.id]: {} },
      stories: [],
      directorTurns: [],
    })
  })

  it('restores bounded director history and filters unsafe entries', () => {
    const world = createEmptyWorldState('director-history')
    const knight = worldEntityDefinitionById.get('knight')!
    const entity = createWorldEntity(knight, { id: 'director-actor', name: '罗兰' })
    const restored = parseStoredWorldState({
      ...world,
      entities: [entity],
      narrative: {
        ...world.narrative,
        directorTurns: [{
          id: 'turn-1',
          playerText: '让罗兰停下来。',
          origin: 'autonomous',
          createdAtSeconds: 12,
          status: 'completed',
          contextStats: {
            messageCount: 6,
            estimatedInputTokens: 1400,
            rawTurnCount: 2,
            memoryTurnCount: 4,
            inputTokens: 1320,
            outputTokens: 120,
            cachedTokens: 896,
          },
          entries: [
            { id: 'entry-1', type: 'dialogue', speakerId: entity.id, text: '先等等。', status: 'accepted' },
            { id: 'entry-2', type: 'command', entityId: entity.id, command: { type: 'stop' }, status: 'accepted' },
            { id: 'unsafe', type: 'command', entityId: entity.id, command: { type: 'teleport', x: 999 } },
          ],
        }],
      },
    }, world.planId)
    expect(restored?.narrative.directorTurns).toEqual([{
      id: 'turn-1',
      playerText: '让罗兰停下来。',
      origin: 'autonomous',
      createdAtSeconds: 12,
      status: 'completed',
      contextStats: {
        messageCount: 6,
        estimatedInputTokens: 1400,
        rawTurnCount: 2,
        memoryTurnCount: 4,
        inputTokens: 1320,
        outputTokens: 120,
        cachedTokens: 896,
      },
      entries: [
        { id: 'entry-1', type: 'dialogue', speakerId: entity.id, text: '先等等。', status: 'accepted' },
        { id: 'entry-2', type: 'command', entityId: entity.id, command: { type: 'stop' }, status: 'accepted' },
      ],
    }])
  })

  it('restores bounded locked story facts', () => {
    const world = createEmptyWorldState('director-memory')
    const restored = parseStoredWorldState({
      ...world,
      narrative: {
        ...world.narrative,
        directorMemory: {
          summary: '罗兰正在追查商队。',
          lockedFacts: [' 罗兰是玩家角色 ', '', 3, '黑岩使者尚未招供'],
          throughTurnId: 'turn-4',
          sourceTurnCount: 4,
          updatedAtSeconds: 12,
        },
      },
    }, world.planId)

    expect(restored?.narrative.directorMemory).toEqual({
      summary: '罗兰正在追查商队。',
      lockedFacts: ['罗兰是玩家角色', '黑岩使者尚未招供'],
      throughTurnId: 'turn-4',
      sourceTurnCount: 4,
      updatedAtSeconds: 12,
    })
  })
})
