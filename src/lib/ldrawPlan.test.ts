import { describe, expect, it } from 'vitest'
import { formatLDrawPlan, ldrawImportLimits, parseLDrawPlan } from './ldrawPlan'
import { makeBrick } from './planUtils'
import type { BuildPlan } from '../types/bricks'

const plan: BuildPlan = {
  id: 'ldraw-test',
  title: 'LDraw Test',
  prompt: 'test',
  source: 'template-local',
  bricks: [makeBrick('brick-1x1', 'red', 2, 0, 3)],
  steps: [],
}

describe('LDraw plan interchange', () => {
  it('round-trips exact app plans through embedded metadata', () => {
    const imported = parseLDrawPlan(formatLDrawPlan(plan))
    expect(imported?.usedEmbeddedPlan).toBe(true)
    expect(imported?.plan.bricks).toEqual(plan.bricks)
  })

  it('applies nested MPD transforms', () => {
    const imported = parseLDrawPlan([
      '0 FILE main.ldr',
      '1 16 40 0 0 1 0 0 0 1 0 0 0 1 assembly.ldr',
      '0 FILE assembly.ldr',
      '1 4 10 -24 10 1 0 0 0 1 0 0 0 1 3005.dat',
      '0 NOFILE',
    ].join('\n'))

    expect(imported?.ignoredParts).toBe(0)
    expect(imported?.plan.bricks[0].pose).toMatchObject({ xStud: 2, yStud: 0, zStud: 0 })
  })

  it('reports repeated unknown parts, colors, and unsupported poses', () => {
    const imported = parseLDrawPlan([
      '0 FILE compatibility.ldr',
      '1 999 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
      '1 4 40 0 0 0.7 0 0.7 0 1 0 -0.7 0 0.7 3001.dat',
      '1 4 80 0 0 1 0 0 0 1 0 0 0 1 missing.dat',
      '1 4 120 0 0 1 0 0 0 1 0 0 0 1 missing.dat',
    ].join('\n'))

    expect(imported?.unknownPartCounts).toEqual({ 'missing.dat': 2 })
    expect(imported?.unsupportedColorCodes).toEqual([999])
    expect(imported?.unsupportedPoseCount).toBe(1)
    expect(imported?.ignoredParts).toBe(3)
  })

  it('rejects exponential MPD expansion before it can exhaust the main thread', () => {
    const reference = (name: string) => `1 4 0 0 0 1 0 0 0 1 0 0 0 1 ${name}`
    const text = Array.from({ length: 25 }, (_, level) => [
      `0 FILE level-${level}.ldr`,
      ...(level === 24 ? [reference('3005.dat')] : [reference(`level-${level + 1}.ldr`), reference(`level-${level + 1}.ldr`)]),
    ].join('\n')).join('\n')
    expect(text.length).toBeLessThan(4000)
    expect(() => parseLDrawPlan(text)).toThrow('LDRAW_IMPORT_LIMIT_EXCEEDED')
  })

  it('rejects oversized input before decoding metadata or splitting sections', () => {
    expect(() => parseLDrawPlan(' '.repeat(ldrawImportLimits.sourceCharacters + 1))).toThrow('LDRAW_IMPORT_LIMIT_EXCEEDED')
  })

})
