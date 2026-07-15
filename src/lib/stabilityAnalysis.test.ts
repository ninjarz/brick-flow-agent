import { describe, expect, it } from 'vitest'
import { makeBrick } from './planUtils'
import { analyzeBuildStability, createConvexHull } from './stabilityAnalysis'

describe('stability analysis', () => {
  it('builds the outer support hull without interior points', () => {
    expect(createConvexHull([
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 2 },
      { x: 0, z: 2 },
      { x: 1, z: 1 },
    ])).toHaveLength(4)
  })

  it('rates a connected stack above a detached equivalent', () => {
    const base = makeBrick('brick-2x4', 'gray', 0, 0, 0)
    const top = makeBrick('brick-2x2', 'gray', 1, 1.2, 1)
    const detached = { ...top, id: 'detached', pose: { ...top.pose, yStud: 4 } }
    const stable = analyzeBuildStability([base, top])
    const unstable = analyzeBuildStability([base, detached])

    expect(stable.stabilityScore).toBeGreaterThan(unstable.stabilityScore)
    expect(stable.riskByBrickId.get(top.id)?.grounded).toBe(true)
    expect(unstable.riskByBrickId.get(detached.id)?.riskLevel).toBe('detached')
  })

  it('detects cantilever risk at a narrow edge support', () => {
    const support = makeBrick('brick-1x1', 'gray', 0, 0, 0)
    const overhang = makeBrick('brick-1x4', 'gray', 0, 1.2, 0)
    const analysis = analyzeBuildStability([support, overhang])
    const result = analysis.riskByBrickId.get(overhang.id)

    expect(result?.supportCoverage).toBeLessThan(0.4)
    expect(result?.reasons).toContain('cantilever')
  })
})
