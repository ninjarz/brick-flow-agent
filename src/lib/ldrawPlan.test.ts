import { describe, expect, it } from 'vitest'
import { formatLDrawPlan, parseLDrawPlan } from './ldrawPlan'
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
})
