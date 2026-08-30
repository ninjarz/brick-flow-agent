import { describe, expect, it } from 'vitest'
import { makeBrick, getBlockingBuildPlanIssues, validateBuildPlan } from './planUtils'
import { createReinforcementCandidates, evaluateReinforcementCandidates } from './stabilityReinforcement'
import type { BuildPlan } from '../types/bricks'

const cantileverPlan: BuildPlan = {
  id: 'reinforcement-test',
  title: 'Cantilever',
  prompt: '',
  source: 'template-local',
  bricks: [
    makeBrick('brick-1x1', 'gray', 0, 0, 0),
    makeBrick('brick-1x4', 'gray', 0, 1.2, 0),
  ],
  steps: [{ id: 'initial', title: 'Initial', description: '', brickIds: [] }],
}

cantileverPlan.steps[0].brickIds = cantileverPlan.bricks.map((brick) => brick.id)

describe('structural reinforcement proposals', () => {
  it('creates valid support columns under risky elevated parts', () => {
    const candidates = createReinforcementCandidates(cantileverPlan)
    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      expect(candidate.addedBricks.length).toBeGreaterThan(0)
      expect(getBlockingBuildPlanIssues(validateBuildPlan({
        ...cantileverPlan,
        bricks: [...cantileverPlan.bricks, ...candidate.addedBricks],
        steps: [...cantileverPlan.steps, { id: 'reinforcement', title: 'Reinforcement', description: '', brickIds: candidate.addedBricks.map((brick) => brick.id) }],
      }))).toEqual([])
    }
  })

  it('ranks proposals deterministically using the active hazard case', () => {
    const candidates = createReinforcementCandidates(cantileverPlan)
    const options = { scenario: 'wind' as const, intensity: 80, directionDegrees: 90, physicsProfile: 'challenge' as const }
    const first = evaluateReinforcementCandidates(cantileverPlan, candidates, options)
    const second = evaluateReinforcementCandidates(cantileverPlan, candidates, options)
    expect(first.map((item) => [item.id, item.scoreDelta, item.failureReduction])).toEqual(second.map((item) => [item.id, item.scoreDelta, item.failureReduction]))
    expect(first[0].scoreDelta).toBeGreaterThanOrEqual(first.at(-1)?.scoreDelta ?? 0)
    expect(first.some((item) => item.scoreDelta > 0 || item.failureReduction > 0)).toBe(true)
  })

  it('respects exhausted inventory overrides', () => {
    expect(createReinforcementCandidates(cantileverPlan, { 'brick-1x1': 1, 'plate-1x1': 0 })).toEqual([])
    expect(createReinforcementCandidates(cantileverPlan, { 'brick-1x1': 2, 'plate-1x1': 0 }).every((candidate) => candidate.columnCount === 1)).toBe(true)
  })
})
