import { describe, expect, it } from 'vitest'
import {
  buildContinuousDirectorIntent,
  getContinuousDirectorBackoffMs,
  getContinuousDirectorCadenceMs,
  shouldRunContinuousDirectorPulse,
} from './worldContinuousDirector'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'

describe('continuous world director scheduling', () => {
  it('runs only while the world is live and no other performance owns the scene', () => {
    const base = {
      enabled: true,
      llmConfigured: true,
      worldPaused: false,
      directorThinking: false,
      llmTesting: false,
      scenarioPerformanceActive: false,
      inputInProgress: false,
      now: 10_000,
      nextAllowedAt: 9_000,
    }
    expect(shouldRunContinuousDirectorPulse(base)).toBe(true)
    expect(shouldRunContinuousDirectorPulse({ ...base, worldPaused: true })).toBe(false)
    expect(shouldRunContinuousDirectorPulse({ ...base, scenarioPerformanceActive: true })).toBe(false)
    expect(shouldRunContinuousDirectorPulse({ ...base, inputInProgress: true })).toBe(false)
    expect(shouldRunContinuousDirectorPulse({ ...base, nextAllowedAt: 11_000 })).toBe(false)
  })

  it('backs off repeated failures and gives the model a non-chat-only brief', () => {
    expect(getContinuousDirectorBackoffMs(0)).toBe(6_000)
    expect(getContinuousDirectorBackoffMs(4)).toBe(60_000)
    const intent = buildContinuousDirectorIntent('zh-CN', 12.5)
    expect(intent).toContain('所有可见且存活的角色')
    expect(intent).toContain('不要为了凑数让所有人闲聊')
    expect(intent).toContain('12.5')
  })

  it('reacts quickly to events and slows down in a quiet world', () => {
    const entity = createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'guard' })
    const quiet = { ...createEmptyWorldState('cadence'), elapsedSeconds: 20, entities: [entity] }
    expect(getContinuousDirectorCadenceMs(quiet)).toBe(14_000)
    expect(getContinuousDirectorCadenceMs({
      ...quiet,
      events: [{
        id: 'hit',
        timeSeconds: 19,
        type: 'damage',
        actorId: 'enemy',
        targetId: entity.id,
      }],
    })).toBe(4_000)
  })
})
