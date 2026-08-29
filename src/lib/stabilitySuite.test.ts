import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStabilitySuiteResult, formatStabilitySuiteMarkdown, getStabilitySuiteCases, loadStabilitySuiteResult, saveStabilitySuiteResult, type StabilitySuiteCaseResult } from './stabilitySuite'

const storage = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
}

describe('stability test suites', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('builds deterministic presets without duplicate cases', () => {
    const quick = getStabilitySuiteCases('quick', 'challenge')
    expect(quick).toHaveLength(5)
    expect(new Set(quick.map((item) => item.id)).size).toBe(quick.length)
    expect(getStabilitySuiteCases('standard', 'realistic')).toHaveLength(10)
    expect(getStabilitySuiteCases('stress', 'challenge')).toHaveLength(9)
  })

  it('finds the weakest case, aggregates scores, and persists the report', () => {
    vi.stubGlobal('window', { localStorage: storage() })
    const base = getStabilitySuiteCases('quick', 'challenge')
    const cases: StabilitySuiteCaseResult[] = base.map((item, index) => ({
      ...item,
      score: 90 - index * 10,
      grade: index < 2 ? 'A' : 'B',
      survivedBrickCount: 10 - index,
      failedBrickCount: index,
    }))
    const result = createStabilitySuiteResult({ id: 'plan', title: 'Bridge', brickCount: 10, fingerprint: '10:test' }, 'quick', 'challenge', cases, '2026-08-30T00:00:00.000Z')
    expect(result.resilienceScore).toBe(70)
    expect(result.passedCaseCount).toBe(3)
    expect(result.weakestCaseId).toBe(cases[4].id)
    expect(formatStabilitySuiteMarkdown(result, 'en-US')).toContain('(weakest)')
    saveStabilitySuiteResult(result)
    expect(loadStabilitySuiteResult('plan')).toEqual(result)
  })
})
