import { describe, expect, it } from 'vitest'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { applyTavernDirectorEvent, buildTavernDirectorPrompt, createTavernDirectorStreamParser, parseTavernDirectorEvent, parseTavernDirectorStreamPreview } from './worldTavernDirector'
import { stepWorldSimulation } from './worldSimulation'
import { createWorldAiSnapshot } from './worldAi'

describe('tavern director protocol', () => {
  it('parses complete NDJSON events across arbitrary chunks', () => {
    const events: unknown[] = []
    const parser = createTavernDirectorStreamParser((event) => events.push(event))
    parser.push('{"type":"narration","text":"炉火摇')
    parser.push('曳。"}\n{"type":"choice","label":"追问","suggestedInput":"继续追问。"}\n')
    parser.finish()
    expect(events).toEqual([
      { type: 'narration', text: '炉火摇曳。' },
      { type: 'choice', label: '追问', suggestedInput: '继续追问。' },
    ])
  })

  it('exposes readable partial prose without raw NDJSON syntax', () => {
    expect(parseTavernDirectorStreamPreview('{"type":"narration","text":"雨声敲打窗')).toEqual({
      type: 'narration',
      text: '雨声敲打窗',
    })
    expect(parseTavernDirectorStreamPreview('{"type":"dialogue","speakerId":"mara","text":"别出声')).toEqual({
      type: 'dialogue',
      speakerId: 'mara',
      text: '别出声',
    })
  })

  it('updates and clears partial prose as complete events arrive', () => {
    const previews: Array<string | undefined> = []
    const parser = createTavernDirectorStreamParser(
      () => undefined,
      (preview) => previews.push(preview?.text),
    )
    parser.push('{"type":"narration","text":"炉火')
    parser.push('忽明忽暗"}\n')
    parser.finish()
    expect(previews).toEqual(['炉火', undefined, undefined])
  })

  it('rejects direct mutation and clamps relationship deltas', () => {
    expect(parseTavernDirectorEvent({ type: 'command', entityId: 'a', command: { type: 'move', x: 4 } })).toBeUndefined()
    expect(parseTavernDirectorEvent({
      type: 'relationship',
      fromId: 'a',
      toId: 'b',
      delta: 99,
      reason: 'helped',
    })).toEqual({ type: 'relationship', fromId: 'a', toId: 'b', delta: 10, reason: 'helped' })
  })

  it('parses dialogue listeners while keeping legacy dialogue compatible', () => {
    expect(parseTavernDirectorEvent({
      type: 'dialogue',
      speakerId: 'eileen',
      listenerId: 'roland',
      text: '北路有异动。',
    })).toEqual({
      type: 'dialogue',
      speakerId: 'eileen',
      listenerId: 'roland',
      text: '北路有异动。',
    })
    expect(parseTavernDirectorEvent({
      type: 'dialogue',
      speakerId: 'eileen',
      text: '北路有异动。',
    })).toEqual({
      type: 'dialogue',
      speakerId: 'eileen',
      text: '北路有异动。',
    })
  })

  it('gives the director entity descriptions for resolving indirect references', () => {
    const definition = worldEntityDefinitionById.get('knight')!
    const world = {
      ...createEmptyWorldState('plan'),
      entities: [
        createWorldEntity(definition, {
          id: 'roland',
          name: '罗兰',
          controller: 'player',
          description: '守护酒馆的骑士。',
        }),
        createWorldEntity(definition, {
          id: 'envoy',
          name: '黑岩使者',
          description: '在酒馆外徘徊的陌生武士。',
        }),
      ],
    }
    const prompt = buildTavernDirectorPrompt(
      createWorldAiSnapshot(world, []),
      '和陌生人说说看',
      [],
      'zh-CN',
      { id: 'roland', name: '罗兰' },
    )

    expect(prompt).toContain('"id":"envoy","name":"黑岩使者","description":"在酒馆外徘徊的陌生武士。"')
    expect(prompt).toContain('Prefer the entity whose description explicitly matches the wording')
  })

  it('turns matching story dialogue into one directed scenario conversation fact', () => {
    const definition = worldEntityDefinitionById.values().next().value!
    const roland = createWorldEntity(definition, { id: 'roland', name: '罗兰', controller: 'player' })
    const eileen = createWorldEntity(definition, { id: 'eileen', name: '艾琳' })
    const world = {
      ...createEmptyWorldState('plan'),
      entities: [roland, eileen],
      scenarios: [{
        id: 'story',
        assetId: 'story',
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
    }
    const applied = applyTavernDirectorEvent(world, {
      type: 'dialogue',
      speakerId: eileen.id,
      listenerId: roland.id,
      text: '北路有异动。',
    }, { bricks: [], structures: [] })
    expect(applied.status).toBe('accepted')
    expect(applied.world.entities.find((entity) => entity.id === eileen.id)?.speech).toMatchObject({
      message: 'scenario-dialogue',
      text: '北路有异动。',
      expiresAtSeconds: 5,
    })
    expect(applied.world.events).toHaveLength(1)
    expect(applied.world.events[0]).toMatchObject({
      type: 'interaction',
      actorId: roland.id,
      targetId: eileen.id,
      actorName: '罗兰',
      targetName: '艾琳',
    })

    const duringScenarioDialogue = applyTavernDirectorEvent({
      ...applied.world,
      scenarios: [{
        ...world.scenarios[0],
        activeDialogue: { stageId: 'talk', eventId: 'interaction', lineIndex: 0, lineEndsAtSeconds: 2 },
      }],
    }, {
      type: 'dialogue',
      speakerId: eileen.id,
      listenerId: roland.id,
      text: '听我说完。',
    }, { bricks: [], structures: [] })
    expect(duringScenarioDialogue.world.events).toHaveLength(1)
  })

  it('executes validated commands and bounded relationship changes', () => {
    const definition = worldEntityDefinitionById.values().next().value!
    const first = createWorldEntity(definition, { id: 'first', name: '罗兰' })
    const second = createWorldEntity(definition, { id: 'second', name: '玛拉' })
    const world = { ...createEmptyWorldState('plan'), entities: [first, second] }
    const commanded = applyTavernDirectorEvent(world, {
      type: 'command',
      entityId: first.id,
      command: { type: 'interact', target: { kind: 'entity', id: second.id } },
    }, { bricks: [], structures: [] })
    expect(commanded.status).toBe('accepted')
    expect(commanded.world.entities[0].commandQueue[0]).toEqual({
      type: 'interact',
      target: { kind: 'entity', id: second.id },
    })
    expect(commanded.world.events.at(-1)?.commandSource).toBe('player')

    const related = applyTavernDirectorEvent(commanded.world, {
      type: 'relationship',
      fromId: first.id,
      toId: second.id,
      delta: 10,
      reason: 'shared a clue',
    }, { bricks: [], structures: [] })
    expect(related.before).toBe(0)
    expect(related.after).toBe(10)
    expect(related.world.narrative.relationshipsByEntityId[first.id][second.id].affinity).toBe(10)
  })

  it('keeps a move command and delays distant dialogue until the speaker arrives', () => {
    const definition = worldEntityDefinitionById.get('knight')!
    const speaker = createWorldEntity(definition, {
      id: 'speaker',
      name: '罗兰',
      controller: 'player',
      transform: { x: 0, z: 0 },
    })
    const listener = createWorldEntity(definition, {
      id: 'listener',
      name: '黑岩使者',
      controller: 'player',
      transform: { x: 8, z: 0 },
    })
    let world = { ...createEmptyWorldState('plan'), entities: [speaker, listener] }
    const moved = applyTavernDirectorEvent(world, {
      type: 'command',
      entityId: speaker.id,
      command: { type: 'move', target: { kind: 'entity', id: listener.id } },
    }, { bricks: [], structures: [] })
    const queuedDialogue = applyTavernDirectorEvent(moved.world, {
      type: 'dialogue',
      speakerId: speaker.id,
      listenerId: listener.id,
      text: '阁下可是远道而来？',
    }, { bricks: [], structures: [] })

    expect(queuedDialogue.detail).toBe('WAITING_FOR_PROXIMITY')
    expect(queuedDialogue.world.entities[0].commandQueue).toEqual([
      { type: 'move', target: { kind: 'entity', id: listener.id } },
      {
        type: 'interact',
        target: { kind: 'entity', id: listener.id },
        speechText: '阁下可是远道而来？',
      },
    ])
    expect(queuedDialogue.world.events.some((event) => event.type === 'interaction')).toBe(false)

    world = queuedDialogue.world
    world = stepWorldSimulation(world, [], 0.1)
    expect(world.entities[0].activeCommand).toMatchObject({
      type: 'move',
      target: { kind: 'entity', id: listener.id },
    })
    expect(world.entities[0].speech?.text).toBeUndefined()

    for (let step = 0; step < 120 && !world.events.some((event) => event.type === 'interaction'); step += 1) {
      world = stepWorldSimulation(world, [], 0.1)
    }

    expect(world.entities[0].transform.x).toBeGreaterThan(0)
    expect(world.events.some((event) => event.type === 'interaction')).toBe(true)
    expect(world.entities[0].speech?.text).toBe('阁下可是远道而来？')
    expect(world.entities[0].speech?.message).toBe('scenario-dialogue')
  })

  it('keeps scripted dialogue silent until the speaker reaches the listener', () => {
    const definition = worldEntityDefinitionById.get('knight')!
    const speaker = createWorldEntity(definition, {
      id: 'speaker',
      name: '罗兰',
      controller: 'player',
      transform: { x: 0, z: 0 },
    })
    const listener = createWorldEntity(definition, {
      id: 'listener',
      name: '黑岩使者',
      controller: 'player',
      transform: { x: 8, z: 0 },
    })
    const queued = applyTavernDirectorEvent({
      ...createEmptyWorldState('plan'),
      entities: [speaker, listener],
    }, {
      type: 'dialogue',
      speakerId: speaker.id,
      listenerId: listener.id,
      text: '这里没有你要找的东西，骑士。',
    }, { bricks: [], structures: [] })

    let world = stepWorldSimulation(queued.world, [], 0.1)
    expect(world.entities[0].activeCommand).toMatchObject({
      type: 'interact',
      speechText: '这里没有你要找的东西，骑士。',
    })
    expect(world.entities[0].speech).toBeUndefined()

    for (let step = 0; step < 120 && !world.events.some((event) => event.type === 'interaction'); step += 1) {
      world = stepWorldSimulation(world, [], 0.1)
    }

    expect(world.events.some((event) => event.type === 'interaction')).toBe(true)
    expect(world.entities[0].speech).toMatchObject({
      message: 'scenario-dialogue',
      text: '这里没有你要找的东西，骑士。',
    })
  })
})
