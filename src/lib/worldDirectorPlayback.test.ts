import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { getWorldDirectorPlaybackEntityIds, isWorldDirectorPlaybackSettled, shouldStartWorldDirectorPlayback } from './worldDirectorPlayback'

const createWorld = () => {
  const world = createEmptyWorldState('plan')
  const knight = worldEntityDefinitionById.get('knight')!
  const archer = worldEntityDefinitionById.get('archer')!
  return {
    ...world,
    entities: [
      createWorldEntity(knight, { id: 'roland', name: '罗兰', transform: { x: 0, y: 0, z: 0 } }),
      createWorldEntity(archer, { id: 'erin', name: '艾琳', transform: { x: 8, y: 0, z: 0 } }),
    ],
  }
}

describe('world director playback', () => {
  it('starts simulation only for accepted event kinds that need world time', () => {
    expect(shouldStartWorldDirectorPlayback({
      type: 'dialogue',
      speakerId: 'speaker',
      listenerId: 'listener',
      text: '走吧。',
    })).toBe(true)
    expect(shouldStartWorldDirectorPlayback({
      type: 'command',
      entityId: 'speaker',
      command: { type: 'wander' },
    })).toBe(true)
    expect(shouldStartWorldDirectorPlayback({ type: 'narration', text: '风吹过酒馆。' })).toBe(false)
    expect(shouldStartWorldDirectorPlayback({ type: 'end', summary: '思考结束。' })).toBe(false)
  })

  it('tracks command actors and both dialogue participants', () => {
    expect(getWorldDirectorPlaybackEntityIds({
      type: 'command',
      entityId: 'roland',
      command: { type: 'move', target: { kind: 'entity', id: 'erin' } },
    })).toEqual(['roland'])
    expect(getWorldDirectorPlaybackEntityIds({
      type: 'dialogue',
      speakerId: 'roland',
      listenerId: 'erin',
      text: '等等。',
    })).toEqual(['roland', 'erin'])
  })

  it('waits for finite commands and speech, but not persistent guard behavior', () => {
    const world = createWorld()
    const entityIds = new Set(['roland'])
    const moving = {
      ...world,
      entities: world.entities.map((entity) => entity.id === 'roland'
        ? { ...entity, activeCommand: { type: 'move' as const, target: { kind: 'entity' as const, id: 'erin' } } }
        : entity),
    }
    expect(isWorldDirectorPlaybackSettled(moving, entityIds)).toBe(false)

    const speaking = {
      ...world,
      entities: world.entities.map((entity) => entity.id === 'roland'
        ? { ...entity, speech: { message: 'scenario-dialogue' as const, text: '等等。', expiresAtSeconds: 3 } }
        : entity),
    }
    expect(isWorldDirectorPlaybackSettled(speaking, entityIds)).toBe(false)
    expect(isWorldDirectorPlaybackSettled({ ...speaking, elapsedSeconds: 3 }, entityIds)).toBe(true)

    const guarding = {
      ...world,
      entities: world.entities.map((entity) => entity.id === 'roland'
        ? { ...entity, activeCommand: { type: 'guard' as const, target: { kind: 'entity' as const, id: 'erin' } } }
        : entity),
    }
    expect(isWorldDirectorPlaybackSettled(guarding, entityIds)).toBe(true)
  })
})
