import { beforeAll, describe, expect, it } from 'vitest'
import hogwartsJson from './legoHogwartsPlan.json'
import { brickById } from './basicBricks'
import { loadLDrawGeneratedVisual } from '../lib/ldrawGeneratedVisualLoader'
import { getBlockingBuildPlanIssues, validateBuildPlan } from '../lib/planUtils'
import { serializeBuildManual } from '../lib/manualSerializer'
import { parseImportedPlan } from '../lib/planFileIO'
import type { BuildPlan } from '../types/bricks'

const plan = hogwartsJson as BuildPlan

beforeAll(async () => {
  await loadLDrawGeneratedVisual([...new Set(plan.bricks.map((brick) => brickById.get(brick.brickId)!.partNumber))])
}, 60_000)

describe('complete Hogwarts replica', () => {
  it('retains every mapped component and excludes unused reference pieces', () => {
    expect(plan.bricks).toHaveLength(6025)
    expect(new Set(plan.bricks.map((brick) => brick.id)).size).toBe(6025)
    expect(plan.structures?.map((structure) => structure.brickIds.length)).toEqual([66, 40, 3130, 2643, 72, 49, 24])
    expect(plan.bricks.filter((brick) => brick.brickId === 'hogwarts-ldraw-2429')).toHaveLength(9)
    expect(plan.bricks.filter((brick) => brick.brickId === 'hogwarts-ldraw-2430')).toHaveLength(9)
    expect(getBlockingBuildPlanIssues(validateBuildPlan(plan))).toEqual([])
  }, 60_000)

  it('assigns every editable piece to exactly one assembly step and exports the complete manual', () => {
    const assigned = plan.steps.flatMap((step) => step.brickIds)
    expect(assigned).toHaveLength(6025)
    expect(new Set(assigned)).toEqual(new Set(plan.bricks.map((brick) => brick.id)))
    const manual = serializeBuildManual(plan)
    expect(manual.steps.at(-1)?.completedPieceCount).toBe(6025)
    const restored = parseImportedPlan(manual)
    expect(restored?.bricks).toHaveLength(6025)
    const placement = (brick: BuildPlan['bricks'][number]) => ({ x: brick.pose.xStud, y: brick.pose.yStud, z: brick.pose.zStud, matrix: brick.pose.orientationMatrix })
    expect(restored?.bricks.map(placement)).toEqual(plan.bricks.map(placement))
  })

  it('preserves the opposed ridge caps and the recovered rock cap orientation', () => {
    const get = (ref: string) => plan.bricks.find((brick) => brick.id === `hogwarts-reference-${ref}`)!.pose.orientationMatrix!
    const left = get('10028'), right = get('10029')
    expect(left[2]).toBe(-right[2])
    expect(Math.abs(left[2])).toBe(1)
    expect(get('manual44')).toEqual(get('5193'))
  })
})
