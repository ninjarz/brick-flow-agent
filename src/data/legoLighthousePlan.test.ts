import { beforeAll, describe, expect, it } from 'vitest'
import rawPlan from './legoLighthousePlan.json'
import { brickById } from './basicBricks'
import { defaultFinishedAssets, isDefaultFinishedAsset } from '../lib/finishedAssets'
import { loadLDrawGeneratedVisual } from '../lib/ldrawGeneratedVisualLoader'
import { serializeBuildManual } from '../lib/manualSerializer'
import { importAssetPlanIncrementally } from '../lib/incrementalAssetImport'
import { parseImportedPlan } from '../lib/planFileIO'
import { validateBuildPlan } from '../lib/planUtils'
import type { BuildPlan } from '../types/bricks'

const plan = rawPlan as BuildPlan
beforeAll(async () => {
  await loadLDrawGeneratedVisual(plan.bricks.map((brick) => brickById.get(brick.brickId)!.partNumber))
})

describe('official lighthouse as a standard editable asset', () => {
  it('registers 25 actual catalogue parts with valid colours and connected geometry', () => {
    const asset = defaultFinishedAssets.find((item) => item.id === 'finished-lego-30023')!
    expect(isDefaultFinishedAsset(asset)).toBe(true)
    expect(asset.plan.bricks).toHaveLength(25)
    expect(asset.instructionStatus).toBe('mapped')
    for (const brick of plan.bricks) expect(brickById.get(brick.brickId)?.colors).toContain(brick.color)
    expect(validateBuildPlan(plan)).toEqual([])
  })

  it('uses the existing manual with all nine official step boundaries intact', () => {
    const manual = serializeBuildManual(plan)
    expect(manual.totalPieces).toBe(25)
    expect(manual.totalSteps).toBe(9)
    expect(manual.steps.map((step) => step.completedPieceCount)).toEqual([2, 5, 8, 12, 18, 19, 20, 23, 25])
    expect(manual.steps[3].addPieces.every((piece) => piece.color === 'red')).toBe(true)
    expect(manual.steps[5].addPieces).toHaveLength(1)
  })

  it('loads through the same incremental importer and survives a JSON round trip', () => {
    const empty: BuildPlan = { id: 'empty', title: 'Empty workspace', prompt: '', source: 'template-local', bricks: [], steps: [] }
    const loaded = importAssetPlanIncrementally(empty, plan)!
    expect(loaded.plan.bricks).toHaveLength(25)
    expect(loaded.plan.steps).toHaveLength(9)
    expect(validateBuildPlan(loaded.plan)).toEqual([])
    const restored = parseImportedPlan(JSON.parse(JSON.stringify(loaded.plan)))!
    expect(serializeBuildManual(restored).steps.map((step) => step.completedPieceCount)).toEqual([2, 5, 8, 12, 18, 19, 20, 23, 25])
    expect(restored.bricks.map((brick) => brick.color)).toEqual(loaded.plan.bricks.map((brick) => brick.color))
  })
})
