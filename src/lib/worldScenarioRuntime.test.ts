import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import type { WorldEvent, WorldScenarioRuntime, WorldState } from '../types/world'
import { createEmptyWorldState, createWorldEntity, joinWorldParty } from './worldEntity'
import { advanceWorldScenarios, evaluateWorldScenarioConditions, getActiveWorldScenarioStages, resolveWorldScenarioAi } from './worldScenarioRuntime'

const commandEvent = (id: string, actorId: string, targetId: string): WorldEvent => ({
  id,
  timeSeconds: 1,
  type: 'command-issued',
  actorId,
  targetId,
  commandType: 'interact',
  commandSource: 'player',
})

describe('world scenario runtime', () => {
  it('evaluates composable world conditions with all, any, and negation', () => {
    const definition = worldEntityDefinitionById.get('knight')!
    const leader = createWorldEntity(definition, { id: 'condition-leader', factionId: 'blue' })
    const companion = {
      ...createWorldEntity(definition, { id: 'condition-companion', factionId: 'blue' }),
      health: 30,
    }
    let world: WorldState = {
      ...createEmptyWorldState('conditions'),
      entities: [leader, companion],
      hiddenTargets: [{ kind: 'structure' as const, id: 'secret-door' }],
      narrative: {
        ...createEmptyWorldState('conditions').narrative,
        relationshipsByEntityId: {
          [leader.id]: {
            [companion.id]: {
              targetEntityId: companion.id,
              affinity: 55,
              encounters: 3,
              lastEventType: 'interaction' as const,
              updatedAtSeconds: 1,
            },
          },
        },
      },
    }
    world = joinWorldParty(world, companion.id, leader.id)
    expect(evaluateWorldScenarioConditions(world, {
      mode: 'all',
      conditions: [
        { type: 'affinity', actorId: leader.id, targetId: companion.id, comparison: 'gte', value: 45 },
        { type: 'health-ratio', entityId: companion.id, comparison: 'lte', value: 0.5 },
        { type: 'party-member', entityId: companion.id, leaderId: leader.id, status: 'active' },
        { type: 'visibility', target: { kind: 'structure', id: 'secret-door' }, visible: false },
        { type: 'entity-alive', entityId: companion.id, alive: true },
      ],
    })).toBe(true)
    expect(evaluateWorldScenarioConditions(world, {
      mode: 'any',
      negate: true,
      conditions: [
        { type: 'faction', entityId: companion.id, factionId: 'red' },
        { type: 'entity-alive', entityId: companion.id, alive: false },
      ],
    })).toBe(true)
  })

  it('keeps multiple story flows active and advances them independently', () => {
    const first: WorldScenarioRuntime = {
      id: 'first-flow',
      assetId: 'authored',
      title: 'First',
      description: 'First',
      processedEventIds: [],
      stages: [{
        id: 'first-node',
        title: 'First node',
        description: 'First node',
        status: 'active',
        trigger: { eventType: 'interaction', actorId: 'hero', targetId: 'first-target' },
      }],
    }
    const second: WorldScenarioRuntime = {
      id: 'second-flow',
      assetId: 'authored',
      title: 'Second',
      description: 'Second',
      processedEventIds: [],
      stages: [{
        id: 'second-node',
        title: 'Second node',
        description: 'Second node',
        status: 'active',
        trigger: { eventType: 'interaction', actorId: 'hero', targetId: 'second-target' },
      }],
    }
    const world = { ...createEmptyWorldState('parallel'), scenarios: [first, second] }
    expect(getActiveWorldScenarioStages(world).map(({ scenario }) => scenario.id)).toEqual(['first-flow', 'second-flow'])

    const advanced = advanceWorldScenarios({
      ...world,
      events: [{ id: 'second-event', timeSeconds: 1, type: 'interaction', actorId: 'hero', targetId: 'second-target' }],
    })
    expect(advanced.scenarios[0].stages[0].status).toBe('active')
    expect(advanced.scenarios[1].stages[0].status).toBe('completed')
  })

  it('keeps draft or paused flows from consuming world events', () => {
    const scenario: WorldScenarioRuntime = {
      id: 'draft-flow',
      assetId: 'authored',
      title: 'Draft',
      description: 'Draft',
      enabled: false,
      processedEventIds: [],
      stages: [{
        id: 'start',
        title: 'Start',
        description: 'Start',
        status: 'active',
        trigger: { eventType: 'interaction', actorId: 'hero', targetId: 'target' },
      }],
    }
    const world = {
      ...createEmptyWorldState('draft'),
      scenarios: [scenario],
      events: [{ id: 'event', timeSeconds: 1, type: 'interaction' as const, actorId: 'hero', targetId: 'target' }],
    }
    expect(advanceWorldScenarios(world)).toBe(world)
    expect(getActiveWorldScenarioStages(world)).toEqual([])
  })

  it('advances one stage once and applies its actions', () => {
    const knight = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'knight', factionId: 'blue' })
    const stranger = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'stranger', factionId: 'neutral' })
    const scenario: WorldScenarioRuntime = {
      id: 'runtime',
      assetId: 'asset',
      title: 'Quest',
      description: 'Quest description',
      processedEventIds: [],
      stages: [{
        id: 'confront',
        title: 'Confront',
        description: 'Talk to the stranger',
        status: 'active',
        trigger: { eventType: 'command-issued', actorId: knight.id, targetId: stranger.id, commandType: 'interact' },
        actions: [
          { type: 'set-faction', entityId: stranger.id, factionId: 'red' },
          { type: 'issue-command', entityId: stranger.id, command: { type: 'attack', target: { kind: 'entity', id: knight.id } } },
          { type: 'add-story', title: 'A fight begins', body: 'The stranger draws a sword.', characterIds: [knight.id, stranger.id] },
        ],
      }],
    }
    const world = {
      ...createEmptyWorldState('plan'),
      entities: [knight, stranger],
      events: [commandEvent('event-1', knight.id, stranger.id)],
      scenarios: [scenario],
    }

    const advanced = advanceWorldScenarios(world)
    expect(advanced.scenarios[0].stages[0].status).toBe('completed')
    expect(advanced.scenarios[0].processedEventIds).toEqual(['event-1'])
    expect(advanced.entities.find((entity) => entity.id === stranger.id)?.factionId).toBe('red')
    expect(advanced.entities.find((entity) => entity.id === stranger.id)?.commandQueue[0]).toEqual({
      type: 'attack', target: { kind: 'entity', id: knight.id },
    })
    expect(advanced.narrative.stories.at(-1)?.title).toBe('A fight begins')
    expect(advanceWorldScenarios(advanced)).toBe(advanced)
  })

  it('does not reuse an event that happened before the next stage unlocked', () => {
    const actor = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'actor' })
    const firstTarget = createWorldEntity(worldEntityDefinitionById.get('archer')!, { id: 'first-target' })
    const secondTarget = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'second-target' })
    const scenario: WorldScenarioRuntime = {
      id: 'ordered-runtime',
      assetId: 'ordered-asset',
      title: 'Ordered quest',
      description: 'Stages must happen in order',
      processedEventIds: [],
      stages: [
        {
          id: 'first', title: 'First', description: 'First', status: 'active',
          trigger: { eventType: 'interaction', actorId: actor.id, targetId: firstTarget.id },
        },
        {
          id: 'second', title: 'Second', description: 'Second', status: 'locked',
          trigger: { eventType: 'interaction', actorId: actor.id, targetId: secondTarget.id },
        },
      ],
    }
    const world = {
      ...createEmptyWorldState('plan'),
      entities: [actor, firstTarget, secondTarget],
      events: [
        { id: 'too-early', timeSeconds: 1, type: 'interaction' as const, actorId: actor.id, targetId: secondTarget.id },
        { id: 'first-done', timeSeconds: 2, type: 'interaction' as const, actorId: actor.id, targetId: firstTarget.id },
      ],
      scenarios: [scenario],
    }

    const firstAdvance = advanceWorldScenarios(world)
    expect(firstAdvance.scenarios[0].stages.map((stage) => stage.status)).toEqual(['completed', 'active'])
    expect(advanceWorldScenarios(firstAdvance)).toBe(firstAdvance)

    const secondAdvance = advanceWorldScenarios({
      ...firstAdvance,
      events: [...firstAdvance.events, {
        id: 'second-done', timeSeconds: 3, type: 'interaction', actorId: actor.id, targetId: secondTarget.id,
      }],
    })
    expect(secondAdvance.scenarios[0].stages.every((stage) => stage.status === 'completed')).toBe(true)
  })

  it('plays readable dialogue before applying hostile actions', () => {
    const knight = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'knight', factionId: 'blue' })
    const stranger = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'stranger', factionId: 'neutral' })
    const scenario: WorldScenarioRuntime = {
      id: 'dialogue-runtime', assetId: 'asset', title: 'Confrontation', description: 'Talk first', processedEventIds: [],
      stages: [{
        id: 'talk', title: 'Talk', description: 'Talk', status: 'active',
        trigger: { eventType: 'interaction', actorId: knight.id, targetId: stranger.id },
        dialogue: [
          { id: 'line-1', speakerId: knight.id, text: 'Explain yourself.', durationSeconds: 3 },
          { id: 'line-2', speakerId: stranger.id, text: 'Then fight me.', durationSeconds: 4 },
        ],
        actions: [
          { type: 'set-faction', entityId: stranger.id, factionId: 'red' },
          { type: 'issue-command', entityId: stranger.id, command: { type: 'attack', target: { kind: 'entity', id: knight.id } } },
        ],
      }],
    }
    let world = advanceWorldScenarios({
      ...createEmptyWorldState('plan'), elapsedSeconds: 10, entities: [knight, stranger], scenarios: [scenario],
      events: [{ id: 'talk-event', timeSeconds: 10, type: 'interaction', actorId: knight.id, targetId: stranger.id }],
    })
    expect(world.scenarios[0].stages[0].status).toBe('active')
    expect(world.entities[0].speech?.text).toBe('Explain yourself.')
    expect(world.entities[1].factionId).toBe('neutral')

    world = advanceWorldScenarios({ ...world, elapsedSeconds: 13 })
    expect(world.entities[1].speech?.text).toBe('Then fight me.')
    expect(world.entities[1].factionId).toBe('neutral')

    world = advanceWorldScenarios({ ...world, elapsedSeconds: 17 })
    expect(world.scenarios[0].stages[0].status).toBe('completed')
    expect(world.narrative.stories.at(-1)?.blocks).toEqual([
      { type: 'dialogue', speakerId: knight.id, text: 'Explain yourself.' },
      { type: 'dialogue', speakerId: stranger.id, text: 'Then fight me.' },
    ])
    expect(world.entities[1].factionId).toBe('red')
    expect(world.entities[1].commandQueue[0]?.type).toBe('attack')
  })

  it('plays delayed scene actions on a timeline before completing the stage', () => {
    const actor = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'actor', factionId: 'blue' })
    const envoy = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'envoy', factionId: 'red' })
    const scenario: WorldScenarioRuntime = {
      id: 'timeline-runtime',
      assetId: 'asset',
      title: 'Retreat',
      description: 'Retreat in order',
      processedEventIds: [],
      stages: [{
        id: 'retreat',
        title: 'Retreat',
        description: 'Retreat',
        status: 'active',
        trigger: { eventType: 'defeated', targetId: actor.id },
        dialogue: [{ id: 'truce', speakerId: envoy.id, text: 'We withdraw.', durationSeconds: 1 }],
        actions: [
          { type: 'set-faction', entityId: envoy.id, factionId: 'neutral' },
          { type: 'add-story', title: 'A brief truce', body: 'The envoy backs away.' },
          {
            type: 'set-visibility',
            target: { kind: 'entity', id: envoy.id },
            visible: false,
            delaySeconds: 2.5,
          },
        ],
      }],
    }
    let world = advanceWorldScenarios({
      ...createEmptyWorldState('timeline'),
      elapsedSeconds: 10,
      entities: [actor, envoy],
      scenarios: [scenario],
      events: [{ id: 'defeat', timeSeconds: 10, type: 'defeated', actorId: envoy.id, targetId: actor.id }],
    })
    expect(world.scenarios[0].activeDialogue?.stageId).toBe('retreat')

    world = advanceWorldScenarios({ ...world, elapsedSeconds: 11 })
    expect(world.scenarios[0].activeTimeline?.actionIndex).toBe(2)
    expect(world.scenarios[0].stages[0].status).toBe('active')
    expect(world.entities[1].factionId).toBe('neutral')
    expect(world.narrative.stories.at(-1)?.title).toBe('A brief truce')
    expect(world.hiddenTargets).not.toContainEqual({ kind: 'entity', id: envoy.id })

    world = advanceWorldScenarios({ ...world, elapsedSeconds: 13.4 })
    expect(world.scenarios[0].stages[0].status).toBe('active')
    expect(world.hiddenTargets).not.toContainEqual({ kind: 'entity', id: envoy.id })

    world = advanceWorldScenarios({ ...world, elapsedSeconds: 13.5 })
    expect(world.scenarios[0].activeTimeline).toBeUndefined()
    expect(world.scenarios[0].stages[0].status).toBe('completed')
    expect(world.hiddenTargets).toContainEqual({ kind: 'entity', id: envoy.id })
  })

  it('defers a new scenario stage while another narrative lane is playing', () => {
    const scenario: WorldScenarioRuntime = {
      id: 'deferred-runtime',
      assetId: 'asset',
      title: 'Deferred',
      description: 'Deferred',
      processedEventIds: [],
      stages: [{
        id: 'talk',
        title: 'Talk',
        description: 'Talk',
        status: 'active',
        trigger: { eventType: 'interaction', actorId: 'hero', targetId: 'guide' },
        dialogue: [{ id: 'line', speakerId: 'guide', text: 'Follow me.', durationSeconds: 2 }],
      }],
    }
    const pending = {
      ...createEmptyWorldState('deferred'),
      scenarios: [scenario],
      events: [{ id: 'talk-event', timeSeconds: 1, type: 'interaction' as const, actorId: 'hero', targetId: 'guide' }],
    }

    const deferred = advanceWorldScenarios(pending, { allowNewStages: false })
    expect(deferred).toBe(pending)
    expect(deferred.scenarios[0].processedEventIds).toEqual([])

    const started = advanceWorldScenarios(deferred)
    expect(started.scenarios[0].activeDialogue?.eventId).toBe('talk-event')
  })

  it('lets only one flow claim a shared event and requires a fresh event for another flow', () => {
    const makeScenario = (id: string): WorldScenarioRuntime => ({
      id,
      assetId: 'asset',
      title: id,
      description: id,
      processedEventIds: [],
      mutexGroup: 'shared-conversation',
      stages: [{
        id: 'talk',
        title: 'Talk',
        description: 'Talk',
        status: 'active',
        trigger: { eventType: 'interaction', actorId: 'hero', targetId: 'guide' },
        dialogue: [{ id: `${id}-line`, speakerId: 'guide', text: id, durationSeconds: 2 }],
      }],
    })
    const world = {
      ...createEmptyWorldState('serial-dialogue'),
      scenarios: [makeScenario('first'), makeScenario('second')],
      events: [{ id: 'shared-event', timeSeconds: 1, type: 'interaction' as const, actorId: 'hero', targetId: 'guide' }],
    }

    const started = advanceWorldScenarios(world)
    expect(started.scenarios.map((scenario) => Boolean(scenario.activeDialogue))).toEqual([true, false])
    expect(started.scenarios[1].processedEventIds).toEqual([])

    const firstFinished = advanceWorldScenarios({ ...started, elapsedSeconds: 2 })
    expect(firstFinished.scenarios[0].activeDialogue).toBeUndefined()
    expect(advanceWorldScenarios(firstFinished)).toBe(firstFinished)

    const secondStarted = advanceWorldScenarios({
      ...firstFinished,
      events: [...firstFinished.events, {
        id: 'fresh-event',
        timeSeconds: 3,
        type: 'interaction',
        actorId: 'hero',
        targetId: 'guide',
      }],
    })
    expect(secondStarted.scenarios[1].activeDialogue?.eventId).toBe('fresh-event')
    expect(secondStarted.scenarios[0].claimedEventIds).toEqual(['shared-event'])
    expect(secondStarted.scenarios[1].claimedEventIds).toEqual(['fresh-event'])
  })

  it('prioritizes independent flows and queues the lower priority dialogue without losing its event', () => {
    const makeScenario = (id: string, priority: number, mutexGroup: string): WorldScenarioRuntime => ({
      id,
      assetId: 'asset',
      title: id,
      description: id,
      priority,
      mutexGroup,
      processedEventIds: [],
      stages: [{
        id: 'talk',
        title: 'Talk',
        description: 'Talk',
        status: 'active',
        trigger: { eventType: 'interaction', actorId: 'hero', targetId: 'guide' },
        dialogue: [{ id: `${id}-line`, speakerId: 'guide', text: id, durationSeconds: 2 }],
      }],
    })
    const world = {
      ...createEmptyWorldState('priority-dialogue'),
      scenarios: [
        makeScenario('low', 10, 'optional'),
        makeScenario('high', 90, 'main'),
      ],
      events: [{ id: 'shared-event', timeSeconds: 1, type: 'interaction' as const, actorId: 'hero', targetId: 'guide' }],
    }

    const started = advanceWorldScenarios(world)
    expect(started.scenarios[1].activeDialogue?.eventId).toBe('shared-event')
    expect(started.scenarios[0].queuedTransition?.eventId).toBe('shared-event')

    const highFinished = advanceWorldScenarios({ ...started, elapsedSeconds: 2 })
    expect(highFinished.scenarios[1].outcomeId).toBe('completed')
    expect(highFinished.scenarios[0].queuedTransition?.eventId).toBe('shared-event')

    const lowStarted = advanceWorldScenarios(highFinished)
    expect(lowStarted.scenarios[0].queuedTransition).toBeUndefined()
    expect(lowStarted.scenarios[0].activeDialogue?.eventId).toBe('shared-event')
  })

  it('plays an older queued flow before a newly triggered higher-priority flow', () => {
    const makeScenario = (id: string, priority: number, targetId: string): WorldScenarioRuntime => ({
      id,
      assetId: 'asset',
      title: id,
      description: id,
      priority,
      processedEventIds: [],
      stages: [{
        id: 'talk',
        title: 'Talk',
        description: 'Talk',
        status: 'active',
        trigger: { eventType: 'interaction', actorId: 'hero', targetId },
        dialogue: [{ id: `${id}-line`, speakerId: targetId, text: id, durationSeconds: 2 }],
      }],
    })
    const queued = {
      ...makeScenario('queued', 1, 'guide'),
      queuedTransition: {
        stageId: 'talk',
        eventId: 'queued-event',
        queuedAtSeconds: 2,
      },
    }
    const fresh = makeScenario('fresh-high', 100, 'envoy')
    const world = {
      ...createEmptyWorldState('fair-dialogue'),
      elapsedSeconds: 5,
      scenarios: [fresh, queued],
      events: [
        { id: 'queued-event', timeSeconds: 1, type: 'interaction' as const, actorId: 'hero', targetId: 'guide' },
        { id: 'fresh-event', timeSeconds: 5, type: 'interaction' as const, actorId: 'hero', targetId: 'envoy' },
      ],
    }

    const advanced = advanceWorldScenarios(world)
    expect(advanced.scenarios[1].activeDialogue?.eventId).toBe('queued-event')
    expect(advanced.scenarios[0].queuedTransition?.eventId).toBe('fresh-event')
  })

  it('resolves a persisted pending AI node through its authored fallback when AI is disabled', () => {
    const scenario: WorldScenarioRuntime = {
      id: 'pending-offline',
      assetId: 'authored',
      title: 'Pending offline',
      description: 'Pending offline',
      processedEventIds: ['event'],
      claimedEventIds: ['event'],
      pendingAi: { stageId: 'choice', eventId: 'event', requestedAtSeconds: 1 },
      stages: [{
        id: 'choice',
        title: 'Choice',
        description: 'Choice',
        status: 'active',
        trigger: { eventType: 'interaction' },
        ai: {
          mode: 'choice',
          instruction: 'Choose a branch.',
          fallbackBranchId: 'safe',
        },
        branches: [{
          id: 'safe',
          title: 'Safe fallback',
          trigger: { eventType: 'interaction' },
        }],
      }],
    }
    const world = {
      ...createEmptyWorldState('pending-offline'),
      scenarios: [scenario],
      events: [{ id: 'event', timeSeconds: 1, type: 'interaction' as const, actorId: 'hero' }],
    }

    const resolved = advanceWorldScenarios(world, { enableAi: false })
    expect(resolved.scenarios[0].pendingAi).toBeUndefined()
    expect(resolved.scenarios[0].outcomeId).toBe('safe')
    expect(resolved.scenarios[0].stages[0].status).toBe('completed')
  })

  it('pauses an AI dialogue node until a validated resolution arrives', () => {
    const guide = createWorldEntity(worldEntityDefinitionById.get('archer')!, { id: 'guide', name: '艾琳' })
    const scenario: WorldScenarioRuntime = {
      id: 'ai-dialogue',
      assetId: 'authored',
      title: 'AI dialogue',
      description: 'AI dialogue',
      castEntityIds: [guide.id],
      processedEventIds: [],
      stages: [{
        id: 'talk',
        title: 'Talk',
        description: 'Talk',
        status: 'active',
        trigger: { eventType: 'interaction', actorId: 'hero', targetId: guide.id },
        ai: {
          mode: 'dialogue',
          instruction: 'Reveal one clue without inventing a new location.',
          speakerIds: [guide.id],
          maxDialogueLines: 2,
        },
        dialogue: [{ id: 'fallback', speakerId: guide.id, text: '先沿旧路调查。', durationSeconds: 2 }],
        nextStageId: null,
      }],
    }
    const world = {
      ...createEmptyWorldState('ai-dialogue'),
      entities: [guide],
      scenarios: [scenario],
      events: [{ id: 'talk-event', timeSeconds: 1, type: 'interaction' as const, actorId: 'hero', targetId: guide.id }],
    }

    const pending = advanceWorldScenarios(world, { enableAi: true })
    expect(pending.scenarios[0].pendingAi?.stageId).toBe('talk')
    expect(pending.scenarios[0].activeDialogue).toBeUndefined()

    const resolved = resolveWorldScenarioAi(pending, scenario.id, {
      dialogue: [
        { speakerId: guide.id, text: '断箭上的灰白石粉来自旧采石场。' },
        { speakerId: 'invented', text: 'This speaker is not allowed.' },
      ],
    })
    expect(resolved.scenarios[0].pendingAi).toBeUndefined()
    expect(resolved.scenarios[0].activeDialogue?.source).toBe('ai')
    expect(resolved.scenarios[0].activeDialogue?.generatedDialogue).toHaveLength(1)
    expect(resolved.entities[0].speech?.text).toContain('旧采石场')
  })

  it('lets AI choose only among authored branches and falls back deterministically', () => {
    const scenario: WorldScenarioRuntime = {
      id: 'ai-choice',
      assetId: 'authored',
      title: 'AI choice',
      description: 'AI choice',
      processedEventIds: [],
      stages: [{
        id: 'choice',
        title: 'Choice',
        description: 'Choice',
        status: 'active',
        trigger: { eventType: 'interaction', actorId: 'hero', targetId: 'stranger' },
        ai: {
          mode: 'choice',
          instruction: 'Choose whether the stranger cooperates.',
          fallbackBranchId: 'refuse',
        },
        branches: [
          { id: 'cooperate', title: 'Cooperate', aiGuidance: 'Choose when trust is high.', trigger: { eventType: 'interaction' }, nextStageId: 'ending' },
          { id: 'refuse', title: 'Refuse', aiGuidance: 'Choose when trust is low.', trigger: { eventType: 'interaction' } },
        ],
      }, {
        id: 'ending',
        title: 'Ending',
        description: 'Ending',
        status: 'locked',
        trigger: { eventType: 'interaction' },
        nextStageId: null,
      }],
    }
    const pending = advanceWorldScenarios({
      ...createEmptyWorldState('ai-choice'),
      scenarios: [scenario],
      events: [{ id: 'choice-event', timeSeconds: 1, type: 'interaction' as const, actorId: 'hero', targetId: 'stranger' }],
    }, { enableAi: true })

    const resolved = resolveWorldScenarioAi(pending, scenario.id, { branchId: 'invented' })
    expect(resolved.scenarios[0].outcomeId).toBe('refuse')
    expect(resolved.scenarios[0].stages[0].status).toBe('completed')
    expect(resolved.scenarios[0].stages[1].status).toBe('locked')
  })

  it('uses the authored fallback branch when an AI choice node runs without an LLM', () => {
    const scenario: WorldScenarioRuntime = {
      id: 'offline-ai-choice',
      assetId: 'authored',
      title: 'Offline choice',
      description: 'Offline choice',
      processedEventIds: [],
      stages: [{
        id: 'choice',
        title: 'Choice',
        description: 'Choice',
        status: 'active',
        trigger: { eventType: 'interaction', actorId: 'hero', targetId: 'stranger' },
        ai: {
          mode: 'choice',
          instruction: 'Choose whether the stranger cooperates.',
          fallbackBranchId: 'refuse',
        },
        branches: [
          { id: 'cooperate', title: 'Cooperate', trigger: { eventType: 'interaction' }, nextStageId: 'ending' },
          { id: 'refuse', title: 'Refuse', trigger: { eventType: 'interaction' } },
        ],
      }, {
        id: 'ending',
        title: 'Ending',
        description: 'Ending',
        status: 'locked',
        trigger: { eventType: 'interaction' },
        nextStageId: null,
      }],
    }
    const advanced = advanceWorldScenarios({
      ...createEmptyWorldState('offline-ai-choice'),
      scenarios: [scenario],
      events: [{ id: 'choice-event', timeSeconds: 1, type: 'interaction', actorId: 'hero', targetId: 'stranger' }],
    })

    expect(advanced.scenarios[0].outcomeId).toBe('refuse')
    expect(advanced.scenarios[0].pendingAi).toBeUndefined()
    expect(advanced.scenarios[0].stages[1].status).toBe('locked')
  })

  it('takes a matching failure branch without unlocking the linear next stage', () => {
    const hero = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'hero', factionId: 'blue' })
    const enemy = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'enemy', factionId: 'red' })
    const scenario: WorldScenarioRuntime = {
      id: 'branching', assetId: 'asset', title: 'Branching', description: 'Branching', processedEventIds: [],
      stages: [
        {
          id: 'battle', title: 'Battle', description: 'Battle', status: 'active', trigger: { eventType: 'defeated', targetId: enemy.id },
          branches: [{
            id: 'retreat', title: 'Retreat', trigger: { eventType: 'defeated', targetId: hero.id },
            actions: [{ type: 'set-faction', entityId: enemy.id, factionId: 'neutral' }],
          }],
        },
        { id: 'victory', title: 'Victory', description: 'Victory', status: 'locked', trigger: { eventType: 'interaction' } },
      ],
    }
    const advanced = advanceWorldScenarios({
      ...createEmptyWorldState('plan'), entities: [hero, enemy], scenarios: [scenario],
      events: [{ id: 'hero-fell', timeSeconds: 3, type: 'defeated', actorId: enemy.id, targetId: hero.id }],
    })

    expect(advanced.scenarios[0].outcomeId).toBe('retreat')
    expect(advanced.scenarios[0].stages.map((stage) => stage.status)).toEqual(['completed', 'locked'])
    expect(advanced.entities[1].factionId).toBe('neutral')
  })

  it('reveals a hidden entity through a scenario action', () => {
    const actor = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'actor' })
    const hidden = createWorldEntity(worldEntityDefinitionById.get('archer')!, { id: 'hidden' })
    const scenario: WorldScenarioRuntime = {
      id: 'reveal', assetId: 'asset', title: 'Reveal', description: 'Reveal', processedEventIds: [],
      stages: [{
        id: 'stage', title: 'Reveal', description: 'Reveal', status: 'active', trigger: { eventType: 'interaction', actorId: actor.id },
        actions: [{ type: 'set-visibility', target: { kind: 'entity', id: hidden.id }, visible: true }],
      }],
    }
    const world = advanceWorldScenarios({
      ...createEmptyWorldState('plan'), entities: [actor, hidden], scenarios: [scenario],
      hiddenTargets: [{ kind: 'entity', id: hidden.id }],
      events: [{ id: 'reveal-event', timeSeconds: 1, type: 'interaction', actorId: actor.id }],
    })

    expect(world.hiddenTargets).toEqual([])
    expect(world.scenarios[0].stages[0].status).toBe('completed')
  })

  it('ends an explicitly terminal stage instead of unlocking the following stage', () => {
    const actor = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'terminal-actor' })
    const scenario: WorldScenarioRuntime = {
      id: 'terminal',
      assetId: 'asset',
      title: 'Terminal',
      description: 'Terminal',
      processedEventIds: [],
      stages: [
        {
          id: 'ending',
          title: 'Ending',
          description: 'Ending',
          status: 'active',
          trigger: { eventType: 'interaction', actorId: actor.id },
          nextStageId: null,
        },
        {
          id: 'unused',
          title: 'Unused',
          description: 'Unused',
          status: 'locked',
          trigger: { eventType: 'interaction' },
        },
      ],
    }
    const advanced = advanceWorldScenarios({
      ...createEmptyWorldState('plan'),
      entities: [actor],
      scenarios: [scenario],
      events: [{ id: 'ending-event', timeSeconds: 1, type: 'interaction', actorId: actor.id }],
    })

    expect(advanced.scenarios[0].outcomeId).toBe('completed')
    expect(advanced.scenarios[0].stages.map((stage) => stage.status)).toEqual(['completed', 'locked'])
  })
})
