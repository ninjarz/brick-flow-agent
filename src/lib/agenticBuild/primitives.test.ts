import { describe, expect, it } from 'vitest'
import { createSingleBrickSteps, getBrickBounds, validateBuildPlan } from '../planUtils'
import { applyAgentAction, createBuildState, parseAgentAction } from './executor'
import { compileSlopeRoof, compileTiles, compileTree } from './primitives'

const planOf = (bricks: ReturnType<typeof createBuildState>['bricks']) => ({ id: 'agent', title: 'agent', prompt: '', source: 'llm' as const, bricks, steps: createSingleBrickSteps(bricks) })
const place = (state: ReturnType<typeof createBuildState>, items: unknown[]) => applyAgentAction(state, parseAgentAction({ action: 'place', items }))
const blocking = (state: ReturnType<typeof createBuildState>) => validateBuildPlan(planOf(state.bricks))

describe('agentic detail primitives', () => {
  it('builds a house with window frames, a slope roof, trees, a fence, tiles and planting', () => {
    const state = createBuildState()
    const steps: unknown[][] = [
      [{ kind: 'deck', x: 0, z: 0, size: [32, 24], color: 'green' }],
      [{ kind: 'tiles', x: 10, z: 0, size: [3, 6], color: 'tan' }, { kind: 'tiles', x: 22, z: 2, size: [6, 6], color: 'trans-blue' }],
      [{ kind: 'walls', x: 6, z: 6, size: [14, 10], courses: 6, color: 'light-gray', openings: [
        { side: 'front', offset: 2, width: 2, bottom: 2, height: 2, color: 'white', part: 'window' },
        { side: 'front', offset: 9, width: 4, bottom: 2, height: 2, color: 'white', part: 'window' },
        { side: 'front', offset: 5, width: 2, bottom: 0, height: 4, color: 'reddish-brown' },
      ] }],
      [{ kind: 'deck', x: 5, z: 5, size: [16, 12], color: 'tan' }],
      [{ kind: 'slope-roof', x: 5, z: 5, size: [16, 12], ridge: 'x', color: 'tan', gableColor: 'light-gray' }],
      [{ kind: 'tree', x: 2, z: 19, size: 7, trunk: 3, leaves: ['green', 'orange'] }, { kind: 'tree', x: 28, z: 19, style: 'pine', size: 5, trunk: 2 }, { kind: 'tree', x: 2, z: 3, style: 'bush', size: 3 }],
      [{ kind: 'fence', x: 0, z: 0, length: 9, color: 'white' }],
      [{ kind: 'scatter', x: 0, z: 8, size: [5, 10], colors: ['red', 'lime'] }],
    ]
    for (const items of steps) expect(place(state, items).rejected).toEqual([])
    expect(state.bricks.filter(brick => brick.brickId === 'window-1x2x2')).toHaveLength(3)
    expect(state.bricks.some(brick => brick.brickId.startsWith('slope-'))).toBe(true)
    expect(blocking(state)).toEqual([])
  })

  it('faces both slope rows away from the ridge and caps it', () => {
    const parts = compileSlopeRoof({ size: [4, 6], ridge: 'x', color: 'dark-gray' }, 0, 0)
    const tier0 = parts.filter(part => part.y === 0 && part.brickId.startsWith('slope-'))
    expect(new Set(tier0.map(part => part.rotation))).toEqual(new Set([0, 2]))
    expect(parts.some(part => part.brickId === 'slope-double-1x2')).toBe(true)
    expect(() => compileSlopeRoof({ size: [4, 5], ridge: 'x' }, 0, 0)).toThrow(/even/)
  })

  it('makes trees about as tall as they are wide', () => {
    const parts = compileTree({ size: 7, trunk: 3 }, 0, 0)
    const top = Math.max(...parts.map(part => part.y))
    const canopy = parts.filter(part => part.y >= 3.6)
    const xs = canopy.flatMap(part => [part.x])
    expect(top - 3.6).toBeGreaterThan(5)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(5)
  })

  it('covers a rectangle with tiles exactly once', () => {
    const parts = compileTiles({ size: [5, 3], color: 'tan' }, 0, 0)
    const area = parts.reduce((sum, part) => {
      const bounds = getBrickBounds({ id: 't', brickId: part.brickId, color: 'tan', pose: { xStud: part.x, yStud: 0, zStud: part.z, rotationQuarterTurns: part.rotation ?? 0 } } as never)
      return sum + (bounds ? (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ) : 0)
    }, 0)
    expect(area).toBe(15)
  })

  it('rejects window openings that do not fit whole frames', () => {
    const state = createBuildState()
    place(state, [{ kind: 'deck', x: 0, z: 0, size: [12, 10], color: 'gray' }])
    const result = place(state, [{ kind: 'walls', x: 1, z: 1, size: [10, 8], courses: 4, color: 'gray', openings: [{ side: 'front', offset: 2, width: 3, bottom: 1, height: 2, color: 'white', part: 'window' }] }])
    expect(result.rejected[0]?.reason).toMatch(/even width/)
  })
})
