import { describe, expect, it } from 'vitest'
import { serializeBuildManual } from './manualSerializer'
import { parseImportedPlan } from './planFileIO'
import { makeBrick } from './planUtils'
import type { BuildPlan } from '../types/bricks'

const plan: BuildPlan = {
  id: 'file-io-test',
  title: 'Round trip',
  prompt: 'test',
  source: 'template-local',
  bricks: [makeBrick('brick-2x2', 'gray', 0, 0, 0)],
  steps: [],
}

describe('plan file import', () => {
  it('accepts nested plans and normalizes them', () => {
    expect(parseImportedPlan({ plan })?.id).toBe(plan.id)
  })

  it('reconstructs a plan from manual 2.0 delta steps', () => {
    const imported = parseImportedPlan(serializeBuildManual(plan, 'zh-CN'))
    expect(imported?.bricks).toHaveLength(1)
    expect(imported?.bricks[0].id).toBe(plan.bricks[0].id)
    expect(imported?.steps[0].brickIds).toEqual([plan.bricks[0].id])
  })

  it('rejects unrelated data', () => {
    expect(parseImportedPlan({ schemaVersion: 5, steps: [] })).toBeUndefined()
  })
})
