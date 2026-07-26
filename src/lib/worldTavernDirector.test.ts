import { describe, expect, it } from 'vitest'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { applyTavernDirectorEvent, createTavernDirectorStreamParser, parseTavernDirectorEvent } from './worldTavernDirector'

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
})
