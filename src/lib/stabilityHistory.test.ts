import { afterEach, describe, expect, it, vi } from 'vitest'
import { compareStabilityReports, createPlanFingerprint, deleteStabilitySnapshot, loadStabilityHistory, maxStabilityHistoryEntries, renameStabilitySnapshot, saveStabilitySnapshot, type StabilitySnapshot } from './stabilityHistory'
import { generateBuildPlan } from './localGenerator'
import { analyzeBuildStability } from './stabilityAnalysis'
import { createStabilityReport } from './stabilityReport'

const createLocalStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('stability history', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fingerprints structural edits deterministically', () => {
    const plan = generateBuildPlan({ prompt: '一座小桥' })
    expect(createPlanFingerprint(plan)).toBe(createPlanFingerprint({ ...plan, bricks: [...plan.bricks].reverse() }))
    expect(createPlanFingerprint(plan)).not.toBe(createPlanFingerprint({ ...plan, bricks: plan.bricks.slice(1) }))
  })

  it('deduplicates, renames, limits, and deletes snapshots', () => {
    vi.stubGlobal('window', { localStorage: createLocalStorage() })
    const plan = generateBuildPlan({ prompt: '一座小桥' })
    const report = createStabilityReport(plan, analyzeBuildStability(plan.bricks), 'en-US')
    const base: StabilitySnapshot = { id: '0', planId: plan.id, name: 'Base', createdAt: '2026-08-30', planFingerprint: createPlanFingerprint(plan), report }
    expect(saveStabilitySnapshot(base).created).toBe(true)
    expect(saveStabilitySnapshot({ ...base, id: 'duplicate' }).created).toBe(false)
    for (let index = 1; index <= 12; index += 1) saveStabilitySnapshot({ ...base, id: String(index), planFingerprint: `${index}` })
    expect(loadStabilityHistory(plan.id)).toHaveLength(maxStabilityHistoryEntries)
    renameStabilitySnapshot(plan.id, '12', 'Improved')
    expect(loadStabilityHistory(plan.id)[0].name).toBe('Improved')
    deleteStabilitySnapshot(plan.id, '12')
    expect(loadStabilityHistory(plan.id).some((item) => item.id === '12')).toBe(false)
  })

  it('marks lower risk counts and higher scores as improvements', () => {
    const plan = generateBuildPlan({ prompt: '一个小房子' })
    const before = createStabilityReport(plan, analyzeBuildStability(plan.bricks), 'en-US')
    const after = { ...before, summary: { ...before.summary, score: before.summary.score + 5, criticalBrickCount: Math.max(0, before.summary.criticalBrickCount - 1) } }
    const comparison = compareStabilityReports(before, after)
    expect(comparison.find((item) => item.key === 'score')?.outcome).toBe('improved')
    expect(comparison.find((item) => item.key === 'criticalBrickCount')?.outcome).not.toBe('declined')
  })
})
