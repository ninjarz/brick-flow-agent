import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { buildWorldCognitionTraceEntry, createWorldCognitionTraceStore } from './worldCognitionTrace'

const knightDefinition = worldEntityDefinitionById.get('knight')!

const buildWorld = (entityIds: string[]) => ({
  ...createEmptyWorldState('trace'),
  entities: entityIds.map((id) => createWorldEntity(knightDefinition, { id, name: `角色${id}` })),
})

describe('world cognition trace', () => {
  it('ranks every eligible candidate and marks only the top slice as selected', () => {
    const world = {
      ...buildWorld(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']),
      entities: [
        ...buildWorld(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']).entities,
        createWorldEntity(knightDefinition, { id: 'hero', name: '玩家', controller: 'player' }),
      ],
    }
    const entry = buildWorldCognitionTraceEntry(world, 4, 8_000)
    expect(entry.candidates).toHaveLength(6)
    expect(entry.candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.entityId))
      .toEqual(['e1', 'e2', 'e3', 'e4'])
    expect(entry.candidates.find((candidate) => candidate.entityId === 'hero')).toBeUndefined()
    expect(entry.candidates[0].name).toBe('角色e1')
    expect(entry.candidates[0].reasons).toContain('idle')
    expect(entry.cadenceMs).toBe(8_000)
  })

  it('includes speaker candidates ranked for the protagonist listener', () => {
    const world = {
      ...buildWorld(['e1', 'e2', 'e3', 'e4']),
      entities: [
        ...buildWorld(['e1', 'e2', 'e3', 'e4']).entities,
        createWorldEntity(knightDefinition, { id: 'hero', name: '玩家', controller: 'player' }),
      ],
    }
    const entry = buildWorldCognitionTraceEntry(world, 4)
    expect(entry.speakers).toHaveLength(4)
    expect(entry.speakers.filter((speaker) => speaker.selected)).toHaveLength(3)
    expect(entry.speakers.every((speaker) => speaker.entityId !== 'hero')).toBe(true)
    expect(entry.speakers[0].name).toBeTruthy()
  })

  it('omits speaker candidates when no living protagonist exists', () => {
    const entry = buildWorldCognitionTraceEntry(buildWorld(['e1', 'e2']), 4)
    expect(entry.speakers).toEqual([])
  })

  it('annotates score deltas against the previous recorded entry', () => {
    const store = createWorldCognitionTraceStore()
    const world = buildWorld(['e1', 'e2'])
    store.record(buildWorldCognitionTraceEntry(world, 4))

    const pressured = buildWorld(['e1', 'e2'])
    pressured.entities[0].navigation.status = 'blocked'
    pressured.entities[0].behaviorState = 'blocked'
    const second = store.record(buildWorldCognitionTraceEntry(pressured, 4))

    const blocked = second.candidates.find((candidate) => candidate.entityId === 'e1')!
    const calm = second.candidates.find((candidate) => candidate.entityId === 'e2')!
    expect(blocked.deltaScore).toBeCloseTo(2, 3)
    expect(blocked.reasons).toContain('blocked')
    expect(calm.deltaScore).toBe(0)
  })

  it('keeps only the most recent entries within the ring buffer capacity', () => {
    const store = createWorldCognitionTraceStore(2)
    const world = buildWorld(['e1'])
    const first = store.record(buildWorldCognitionTraceEntry(world, 4))
    store.record(buildWorldCognitionTraceEntry({ ...world, elapsedSeconds: 5 }, 4))
    const third = store.record(buildWorldCognitionTraceEntry({ ...world, elapsedSeconds: 9 }, 4))

    const entries = store.entries()
    expect(entries).toHaveLength(2)
    expect(entries.some((entry) => entry.id === first.id)).toBe(false)
    expect(entries.at(-1)?.id).toBe(third.id)
  })

  it('clears recorded entries', () => {
    const store = createWorldCognitionTraceStore()
    store.record(buildWorldCognitionTraceEntry(buildWorld(['e1']), 4))
    expect(store.entries()).toHaveLength(1)
    store.clear()
    expect(store.entries()).toHaveLength(0)
  })
})
