import { describe, expect, it } from 'vitest'
import type { WorldState } from '../types/world'
import { createEmptyWorldState } from './worldEntity'
import {
  buildWorldNarrativeFeed,
  makeScenarioDialogueStoryId,
} from './worldNarrativeFeed'

const makeWorld = (): WorldState => createEmptyWorldState('feed-test')

describe('buildWorldNarrativeFeed', () => {
  it('merges stories and director turns in ascending time order', () => {
    const world = makeWorld()
    world.narrative.stories = [{
      id: 'story-later',
      title: 'Later',
      body: 'Later narration',
      createdAtSeconds: 9,
      eventIds: [],
      source: 'local',
    }]
    world.narrative.directorTurns = [{
      id: 'turn-earlier',
      playerText: 'Go',
      entries: [{ id: 'entry-1', type: 'narration', text: 'Earlier narration' }],
      createdAtSeconds: 3,
      status: 'completed',
    }]

    expect(buildWorldNarrativeFeed(world).map((item) => item.id)).toEqual([
      'turn-earlier',
      'story-later',
    ])
  })

  it('prefers structured story blocks and falls back to legacy body paragraphs', () => {
    const world = makeWorld()
    world.narrative.stories = [
      {
        id: 'legacy',
        title: 'Legacy',
        body: 'First paragraph.\n\nSecond paragraph.',
        createdAtSeconds: 1,
        eventIds: [],
        source: 'local',
      },
      {
        id: 'structured',
        title: 'Structured',
        body: 'This legacy body must not be rendered.',
        blocks: [
          { type: 'narration', text: 'The room falls quiet.' },
          { type: 'dialogue', speakerId: 'roland', text: 'Listen.' },
        ],
        createdAtSeconds: 2,
        eventIds: [],
        source: 'ai',
      },
    ]

    const feed = buildWorldNarrativeFeed(world)
    expect(feed[0].blocks).toMatchObject([
      { type: 'narration', text: 'First paragraph.' },
      { type: 'narration', text: 'Second paragraph.' },
    ])
    expect(feed[1].blocks).toMatchObject([
      { type: 'narration', text: 'The room falls quiet.' },
      { type: 'dialogue', speakerId: 'roland', text: 'Listen.' },
    ])
    expect(feed[1].blocks).not.toContainEqual(expect.objectContaining({
      text: 'This legacy body must not be rendered.',
    }))
  })

  it('shows active scenario dialogue only through the current line', () => {
    const world = makeWorld()
    world.elapsedSeconds = 20
    world.events = [{
      id: 'trigger-event',
      timeSeconds: 12,
      type: 'interaction',
      actorId: 'roland',
      targetId: 'eileen',
    }]
    world.scenarios = [{
      id: 'scenario',
      assetId: 'asset',
      title: 'A meeting',
      description: '',
      processedEventIds: [],
      activeDialogue: {
        stageId: 'meeting',
        eventId: 'trigger-event',
        lineIndex: 1,
        lineEndsAtSeconds: 25,
      },
      stages: [{
        id: 'meeting',
        title: 'Meet by the road',
        description: '',
        status: 'active',
        trigger: { eventType: 'interaction' },
        dialogue: [
          { id: 'line-1', speakerId: 'roland', text: 'Who goes there?', durationSeconds: 2 },
          { id: 'line-2', speakerId: 'eileen', text: 'A friend.', durationSeconds: 2 },
          { id: 'line-3', speakerId: 'roland', text: 'Prove it.', durationSeconds: 2 },
        ],
      }],
    }]

    const [item] = buildWorldNarrativeFeed(world)
    expect(item.kind).toBe('active-dialogue')
    expect(item.createdAtSeconds).toBe(12)
    expect(item.blocks.map((block) => block.type)).toEqual(['dialogue', 'dialogue'])
    expect(item.blocks.map((block) => 'text' in block ? block.text : '')).toEqual([
      'Who goes there?',
      'A friend.',
    ])
  })

  it('uses branch dialogue and omits an active duplicate after it is persisted', () => {
    const world = makeWorld()
    const storyId = makeScenarioDialogueStoryId('scenario', 'choice', 'event', 'peace')
    world.narrative.stories = [{
      id: storyId,
      title: 'Peace',
      body: '',
      blocks: [{ type: 'dialogue', speakerId: 'roland', text: 'Stand down.' }],
      createdAtSeconds: 4,
      eventIds: ['event'],
      source: 'local',
    }]
    world.scenarios = [{
      id: 'scenario',
      assetId: 'asset',
      title: 'Choice',
      description: '',
      processedEventIds: [],
      activeDialogue: {
        stageId: 'choice',
        eventId: 'event',
        branchId: 'peace',
        lineIndex: 0,
        lineEndsAtSeconds: 8,
      },
      stages: [{
        id: 'choice',
        title: 'Choose',
        description: '',
        status: 'active',
        trigger: { eventType: 'interaction' },
        dialogue: [{ id: 'main', speakerId: 'roland', text: 'Main line', durationSeconds: 2 }],
        branches: [{
          id: 'peace',
          title: 'Peace',
          trigger: { eventType: 'interaction' },
          dialogue: [{ id: 'branch', speakerId: 'roland', text: 'Stand down.', durationSeconds: 2 }],
        }],
      }],
    }]

    const feed = buildWorldNarrativeFeed(world)
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({ id: storyId, kind: 'story' })
    expect(feed[0].blocks).toMatchObject([
      { type: 'dialogue', text: 'Stand down.' },
    ])
  })

  it('includes a streaming director turn after persisted history at the same time', () => {
    const world = makeWorld()
    world.narrative.directorTurns = [{
      id: 'saved',
      playerText: 'Wait',
      entries: [],
      createdAtSeconds: 5,
      status: 'completed',
    }]

    const feed = buildWorldNarrativeFeed(world, {
      id: 'streaming',
      playerText: 'Speak',
      entries: [{ id: 'line', type: 'dialogue', speakerId: 'roland', text: 'Hello.' }],
      createdAtSeconds: 5,
      status: 'streaming',
    })

    expect(feed.map((item) => item.id)).toEqual(['saved', 'streaming'])
    expect(feed[1].status).toBe('streaming')
  })
})
