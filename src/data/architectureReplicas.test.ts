import { beforeAll, describe, expect, it } from 'vitest'
import sears from './legoSearsTowerPlan.json'
import empire from './legoEmpireStatePlan.json'
import rockefeller from './legoRockefellerPlan.json'
import { brickById } from './basicBricks'
import { defaultFinishedAssets } from '../lib/finishedAssets'
import { loadLDrawGeneratedVisual } from '../lib/ldrawGeneratedVisualLoader'
import { getBlockingBuildPlanIssues, validateBuildPlan } from '../lib/planUtils'
import { serializeBuildManual } from '../lib/manualSerializer'
import { parseImportedPlan } from '../lib/planFileIO'
import { importAssetPlanIncrementally } from '../lib/incrementalAssetImport'
import { createLDrawPrintGeometries } from '../lib/ldrawVisualGeometry'
import type { BuildPlan } from '../types/bricks'

const cases = [
  { set: '21000', plan: sears as BuildPlan, counts: [2,6,8,12,22,25,28,42,44,48,51,55,58,61,64,67,69], colors: { black: 61, 'light-gray': 6, white: 2 } },
  { set: '21002', plan: empire as BuildPlan, counts: [2,6,8,12,15,16,20,24,25,27,33,36,42,43,47,48,51,52,54,63,65,67,73,75,77], colors: { tan: 65, black: 6, 'light-gray': 6 } },
  { set: '21007', plan: rockefeller as BuildPlan, counts: [2,4,6,7,11,15,23,31,50,58,67,74,83,105,119,122,129,137,143,203,209,212,240], colors: { tan: 189, 'light-gray': 39, black: 11, 'pearl-gold': 1 } },
]
beforeAll(async () => { await loadLDrawGeneratedVisual(cases.flatMap(({ plan }) => plan.bricks.map((brick) => brickById.get(brick.brickId)!.partNumber))) })

for (const { set, plan, counts, colors } of cases) describe(`LEGO ${set} editable replica`, () => {
  it('has the official piece colours and a connected, collision-free final assembly', () => {
    expect(defaultFinishedAssets.find((asset) => asset.id === `finished-lego-${set}`)?.plan).toEqual(plan)
    expect(plan.bricks).toHaveLength(counts.at(-1)!)
    expect(validateBuildPlan(plan)).toEqual([])
    const actual: Record<string, number> = {}
    for (const brick of plan.bricks) actual[brick.color] = (actual[brick.color] ?? 0) + 1
    expect(actual).toEqual(colors)
    const prints = plan.bricks.map((brick) => brickById.get(brick.brickId)!).filter((part) => part.id.endsWith('-nameplate'))
    expect(prints).toHaveLength(set === '21007' ? 2 : 1)
    for (const part of prints) expect(createLDrawPrintGeometries(part.partNumber, part.footprint).length).toBeGreaterThan(0)
  }, 60_000)

  it('keeps the exact official main-step membership and validates every cumulative assembly', () => {
    const manual = serializeBuildManual(plan)
    expect(manual.steps.map((step) => step.completedPieceCount)).toEqual(counts)
    const cumulative = new Set<string>()
    for (const step of plan.steps) {
      step.brickIds.forEach((id) => cumulative.add(id))
      const partial = { ...plan, bricks: plan.bricks.filter((brick) => cumulative.has(brick.id)), steps: plan.steps.slice(0, step.instructionStep) }
      expect(getBlockingBuildPlanIssues(validateBuildPlan(partial)), step.title).toEqual([])
    }
  }, 60_000)

  it('retains every pose through normal loading and JSON/manual round trips', () => {
    const empty: BuildPlan = { id: 'empty', title: 'Empty', prompt: '', source: 'template-local', bricks: [], steps: [] }
    const loaded = importAssetPlanIncrementally(empty, plan)!.plan
    for (const value of [loaded, serializeBuildManual(loaded)]) {
      const restored = parseImportedPlan(JSON.parse(JSON.stringify(value)))!
      expect(restored.bricks.map((brick) => brick.pose)).toEqual(loaded.bricks.map((brick) => ({ ...brick.pose, verticalQuarterTurns: brick.pose.verticalQuarterTurns ?? 0 })))
      expect(validateBuildPlan(restored)).toEqual([])
    }
  }, 60_000)
})
