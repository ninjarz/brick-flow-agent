import { beforeAll, describe, expect, it } from 'vitest'
import hogwartsJson from './legoHogwartsPlan.json'
import { brickById } from './basicBricks'
import { prepareStructuralGeometry } from '../lib/prepareStructuralGeometry'
import { getBlockingBuildPlanIssues, validateBuildPlan } from '../lib/planUtils'
import { prepareBuildManual } from '../lib/prepareBuildManual'
import { parseImportedPlan } from '../lib/planFileIO'
import type { BuildPlan } from '../types/bricks'

const plan = hogwartsJson as unknown as BuildPlan

beforeAll(async () => {
  // Match editor preparation. The cache suite separately checks every cell
  // against the original exact sampler, so this suite can focus on assembly.
  await prepareStructuralGeometry([...new Set(plan.bricks.map(brick => brick.brickId))].map(id => brickById.get(id)!))
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

  it('assigns every editable piece to exactly one assembly step and exports the complete manual', async () => {
    const assigned = plan.steps.flatMap((step) => step.brickIds)
    expect(assigned).toHaveLength(6025)
    expect(new Set(assigned)).toEqual(new Set(plan.bricks.map((brick) => brick.id)))
    const manual = await prepareBuildManual(plan, 'zh-CN')
    expect(manual.steps).toHaveLength(1906)
    expect(manual.steps.every(step => step.validation.checked && step.validation.ok)).toBe(true)
    expect(manual.steps.at(-1)?.completedPieceCount).toBe(6025)
    const restored = parseImportedPlan(manual)
    expect(restored?.bricks).toHaveLength(6025)
    const placement = (brick: BuildPlan['bricks'][number]) => ({ x: brick.pose.xStud, y: brick.pose.yStud, z: brick.pose.zStud, matrix: brick.pose.orientationMatrix })
    expect(restored?.bricks.map(placement)).toEqual(plan.bricks.map(placement))
    expect(restored?.steps.map(step => step.construction)).toEqual(plan.steps.map(step => step.construction))
  }, 120_000)

  it('preserves the opposed ridge caps and the recovered rock cap orientation', () => {
    const get = (ref: string) => plan.bricks.find((brick) => brick.id === `hogwarts-reference-${ref}`)!.pose.orientationMatrix!
    const left = get('10028'), right = get('10029')
    expect(left[2]).toBe(-right[2])
    expect(Math.abs(left[2])).toBe(1)
    expect(get('manual44')).toEqual(get('5193'))
  })
})
