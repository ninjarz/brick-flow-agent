import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import type { WorldEvent } from '../types/world'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { addWorldStory, createLocalTavernStory, formatWorldEvent, ingestWorldEvents } from './worldNarrative'

describe('world narrative', () => {
  it('records each event once in both participants memories', () => {
    const world = createEmptyWorldState('plan-1')
    const event: WorldEvent = {
      id: 'event-1',
      timeSeconds: 1,
      type: 'damage',
      actorId: 'knight-1',
      actorName: '亚瑟',
      targetId: 'archer-1',
      targetName: '罗宾',
      amount: 12,
    }
    const once = ingestWorldEvents(world.narrative, [event], new Set(['knight-1', 'archer-1']))
    const twice = ingestWorldEvents(once, [event], new Set(['knight-1', 'archer-1']))

    expect(once.memoriesByEntityId['knight-1']).toHaveLength(1)
    expect(once.memoriesByEntityId['archer-1']).toHaveLength(1)
    expect(twice).toEqual(once)
  })

  it('generates and stores a local story grounded in world events', () => {
    const knight = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'knight-1', name: '亚瑟' })
    const world = {
      ...createEmptyWorldState('plan-1'),
      entities: [knight],
      events: [{
        id: 'event-1',
        timeSeconds: 1,
        type: 'structure-hit' as const,
        actorId: knight.id,
        actorName: knight.name,
        targetId: 'gate-1',
        targetName: '北门',
      }],
    }
    const story = createLocalTavernStory(world, 'zh-CN')
    const next = addWorldStory(world, story)

    expect(story.body).toContain('亚瑟')
    expect(story.body).toContain('北门')
    expect(next.narrative.stories).toContainEqual(story)
  })

  it('creates a focused next chapter from fresh events instead of repeating covered ones', () => {
    const knight = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'knight', name: '亚瑟' })
    const archer = createWorldEntity(worldEntityDefinitionById.get('archer')!, { id: 'archer', name: '罗宾' })
    const oldEvent: WorldEvent = {
      id: 'event-old', timeSeconds: 1, type: 'interaction', actorId: knight.id, actorName: knight.name,
      targetId: archer.id, targetName: archer.name,
    }
    const freshEvent: WorldEvent = {
      id: 'event-fresh', timeSeconds: 2, type: 'revive', actorId: archer.id, actorName: archer.name,
      targetId: knight.id, targetName: knight.name, amount: 63,
    }
    const unrelatedEvent: WorldEvent = {
      id: 'event-unrelated', timeSeconds: 3, type: 'structure-hit', actorId: 'other', targetId: 'gate',
    }
    const world = {
      ...createEmptyWorldState('plan-1'),
      entities: [knight, archer],
      events: [oldEvent, freshEvent, unrelatedEvent],
      narrative: {
        ...createEmptyWorldState('plan-1').narrative,
        stories: [{
          id: 'chapter-1', title: '第一章', body: '旧闻', createdAtSeconds: 1,
          eventIds: [oldEvent.id], characterIds: [knight.id, archer.id], chapterNumber: 1, source: 'local' as const,
        }],
      },
    }

    const story = createLocalTavernStory(world, 'zh-CN', knight.id)

    expect(story.title).toContain('第 2 章')
    expect(story.title).toContain('重燃的生命')
    expect(story.eventIds).toEqual([freshEvent.id])
    expect(story.characterIds).toEqual(expect.arrayContaining([knight.id, archer.id]))
    expect(story.body).toContain('亚瑟')
    expect(story.body).toContain('第一章')
  })

  it('enriches AI stories with chapter and participant metadata', () => {
    const knight = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'knight' })
    const archer = createWorldEntity(worldEntityDefinitionById.get('archer')!, { id: 'archer' })
    const event: WorldEvent = {
      id: 'event-1', timeSeconds: 4, type: 'attack', actorId: knight.id, targetId: archer.id,
    }
    const world = { ...createEmptyWorldState('plan-1'), entities: [knight, archer], events: [event] }

    const next = addWorldStory(world, {
      id: 'ai-story', title: 'A Duel', body: 'They fought.', createdAtSeconds: 4,
      eventIds: [event.id], source: 'ai',
    })

    expect(next.narrative.stories[0]).toMatchObject({
      chapterNumber: 1,
      characterIds: [knight.id, archer.id],
    })
  })

  it('explains who issued a high-level order without exposing coordinates', () => {
    const event: WorldEvent = {
      id: 'event-order',
      timeSeconds: 2,
      type: 'command-issued',
      actorId: 'knight-1',
      actorName: '亚瑟',
      targetId: 'gate-1',
      targetName: '北门',
      commandType: 'guard',
      commandSource: 'player',
    }
    expect(formatWorldEvent(event, 'zh-CN')).toBe('玩家命令亚瑟执行“守卫”，目标是北门。')
    expect(formatWorldEvent(event, 'en-US')).toBe('the player ordered 亚瑟 to guard toward 北门.')
  })

  it('builds persistent two-way relationships from interaction and conflict', () => {
    const world = createEmptyWorldState('plan-1')
    const interaction: WorldEvent = {
      id: 'event-interaction', timeSeconds: 1, type: 'interaction', actorId: 'a', targetId: 'b',
    }
    const damage: WorldEvent = {
      id: 'event-damage', timeSeconds: 2, type: 'damage', actorId: 'a', targetId: 'b', amount: 10,
    }
    const afterInteraction = ingestWorldEvents(world.narrative, [interaction], new Set(['a', 'b']))
    expect(afterInteraction.relationshipsByEntityId.a.b).toMatchObject({ affinity: 5, encounters: 1 })
    expect(afterInteraction.relationshipsByEntityId.b.a).toMatchObject({ affinity: 5, encounters: 1 })

    const afterDamage = ingestWorldEvents(afterInteraction, [damage], new Set(['a', 'b']))
    expect(afterDamage.relationshipsByEntityId.a.b).toMatchObject({ affinity: 2, encounters: 2 })
    expect(afterDamage.relationshipsByEntityId.b.a).toMatchObject({ affinity: -5, encounters: 2 })
  })
})
