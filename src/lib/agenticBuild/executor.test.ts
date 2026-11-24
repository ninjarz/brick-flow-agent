import { describe, expect, it } from 'vitest'
import { createSingleBrickSteps, validateBuildPlan } from '../planUtils'
import { applyAgentAction, createBuildState, formatAgentCatalogue, nearestColor, parseAgentAction, summarizeBuild } from './executor'
import { parseAgentManual } from './loop'

const planOf = (bricks: ReturnType<typeof createBuildState>['bricks']) => ({ id: 'agent', title: 'agent', prompt: '', source: 'llm' as const, bricks, steps: createSingleBrickSteps(bricks) })
const place = (state: ReturnType<typeof createBuildState>, items: unknown[]) => applyAgentAction(state, parseAgentAction({ action: 'place', items }))

describe('agentic build executor', () => {
  it('builds a valid house from primitives dropped onto each other', () => {
    const state = createBuildState()
    expect(place(state, [{ kind: 'deck', x: 0, z: 0, size: [12, 10], color: 'gray' }]).rejected).toEqual([])
    expect(place(state, [{ kind: 'walls', x: 1, z: 1, size: [10, 8], courses: 4, color: 'brown', openings: [{ side: 'front', offset: 4, width: 2, height: 3, color: 'black' }] }]).rejected).toEqual([])
    // The ceiling's lower plates hang from its upper course: valid as a whole.
    expect(place(state, [{ kind: 'deck', x: 1, z: 1, size: [10, 8], color: 'tan' }]).rejected).toEqual([])
    expect(place(state, [{ kind: 'stepped-roof', x: 1, z: 1, size: [10, 8], tiers: 4, style: 'gable', color: 'dark-gray' }]).rejected).toEqual([])
    expect(validateBuildPlan(planOf(state.bricks)).filter(issue => issue.type !== 'disconnected-island')).toEqual([])
    // Walls dropped onto the foundation top, not onto the ground.
    const wall = state.bricks.find(brick => brick.brickId.startsWith('brick-'))!
    expect(wall.pose.yStud).toBeCloseTo(0.8, 6)
  })

  it('keeps valid parts of a batch and rejects the rest with nearby candidates', () => {
    const state = createBuildState()
    place(state, [{ kind: 'deck', x: 0, z: 0, size: [8, 8], color: 'gray' }])
    const result = place(state, [
      { brickId: 'brick-2x2', color: 'red', x: 2, z: 2 },
      { brickId: 'brick-2x2', color: 'red', x: 2, z: 2 },
      { brickId: 'brick-2x4', color: 'red', x: 20, y: 4, z: 20 },
      { brickId: 'not-a-part', color: 'red', x: 0, z: 0 },
    ])
    expect(result.placed).toBe(2)
    expect(result.rejected.map(rejection => rejection.item)).toEqual([2, 3])
    expect(result.rejected[0].candidates?.length).toBeGreaterThan(0)
    // The second identical brick stacked onto the first instead of colliding.
    const stacked = state.bricks.filter(brick => brick.brickId === 'brick-2x2')
    expect(stacked.map(brick => brick.pose.yStud)).toEqual([0.8, 2])
    expect(validateBuildPlan(planOf(state.bricks)).filter(issue => issue.type !== 'disconnected-island')).toEqual([])
  })

  it('rejects a whole primitive that would float and leaves the build unchanged', () => {
    const state = createBuildState()
    place(state, [{ kind: 'deck', x: 0, z: 0, size: [4, 4], color: 'gray' }])
    const before = state.bricks.length
    const result = place(state, [{ kind: 'deck', x: 10, y: 5, z: 10, size: [4, 4], color: 'gray' }])
    expect(result.rejected[0].reason).toContain('would not connect')
    expect(state.bricks).toHaveLength(before)
  })

  it('substitutes the nearest colour a part carries and keeps transparency', () => {
    const state = createBuildState()
    const result = place(state, [{ kind: 'deck', x: 0, z: 0, size: [4, 4], color: 'invented-colour' }, { brickId: 'brick-1x2', color: 'trans_yellow', x: 0, z: 0 }])
    expect(result.placed).toBeGreaterThan(1)
    expect(nearestColor('dark-green', ['trans-green', 'green', 'black'])).not.toBe('trans-green')
    expect(nearestColor('trans-yellow', ['yellow', 'trans-yellow'])).toBe('trans-yellow')
  })

  it('removes parts together with the parts resting on them', () => {
    const state = createBuildState()
    place(state, [{ kind: 'deck', x: 0, z: 0, size: [4, 4], color: 'gray' }])
    const tower = place(state, [{ brickId: 'brick-2x2', color: 'red', x: 1, z: 1, repeat: { count: 3, dy: 1.2 } }])
    expect(tower.placed).toBe(3)
    const result = applyAgentAction(state, { action: 'remove', ids: [tower.placedIds[0]] })
    expect(result.removed).toBe(3)
  })

  it('summarizes the build as a bounded height map', () => {
    const state = createBuildState()
    place(state, [{ kind: 'deck', x: 0, z: 0, size: [6, 4], color: 'gray' }, { brickId: 'brick-2x2', color: 'red', x: 0, z: 0 }])
    const summary = summarizeBuild(state.bricks)
    expect(summary.heightMap?.rows).toHaveLength(4)
    expect(summary.heightMap?.rows[0]).toBe('552222')
    expect(formatAgentCatalogue()).toContain('brick-1x2')
  })

  it('validates action and manual shapes with messages for the model', () => {
    expect(() => parseAgentAction({ action: 'fly' })).toThrow('Unknown action')
    expect(() => parseAgentAction({ action: 'place', items: [] })).toThrow('non-empty')
    expect(parseAgentAction({ action: 'place', parts: [{ brickId: 'brick-1x1' }] }).action).toBe('place')
    expect(() => parseAgentManual({ components: [] })).toThrow('components')
    expect(parseAgentManual({ title: 'Cabin', components: [{ name: 'Base', description: 'deck' }] }).components[0]).toMatchObject({ name: 'Base', goal: 'deck' })
  })
})
