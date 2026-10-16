import { beforeAll, describe, expect, it } from 'vitest'
import planData from './legoBigBenPlan.json'
import { brickById, brickDefinitions } from './basicBricks'
import { defaultFinishedAssets } from '../lib/finishedAssets'
import { loadLDrawGeneratedVisual } from '../lib/ldrawGeneratedVisualLoader'
import { validateBuildPlan } from '../lib/planUtils'
import { serializeBuildManual } from '../lib/manualSerializer'
import { parseImportedPlan } from '../lib/planFileIO'
import { importAssetPlanIncrementally } from '../lib/incrementalAssetImport'
import { createLDrawPrintGeometries } from '../lib/ldrawVisualGeometry'
import type { BuildPlan } from '../types/bricks'

const plan = planData as BuildPlan
const cumulativeCounts = [1,4,5,7,10,13,20,29,34,40,45,49,57,62,67,75,81,84,89,109,115,122,128,132,135,140,142,148,152,172,184,199,204,212,214,220,228,236,238,244,252,260,262,268,276,284,286,294,296,304,338,346]
beforeAll(async () => { await loadLDrawGeneratedVisual(plan.bricks.map((b) => brickById.get(b.brickId)!.partNumber)) })

describe('LEGO 21013 native Big Ben replica', () => {
  it('has all 346 coloured pieces connected without collisions, with distinct catalogue IDs', () => {
    expect(new Set(brickDefinitions.map((d) => d.id)).size).toBe(brickDefinitions.length)
    expect(defaultFinishedAssets.find((asset) => asset.id === 'finished-lego-21013')?.plan.bricks).toHaveLength(346)
    expect(validateBuildPlan(plan)).toEqual([])
    const counts = new Map<string, number>()
    for (const brick of plan.bricks) counts.set(brick.color, (counts.get(brick.color) ?? 0) + 1)
    expect(Object.fromEntries(counts)).toEqual({ tan: 264, 'dark-gray': 26, 'light-gray': 25, black: 20, white: 9, 'dark-green': 2 })
  }, 60_000)

  it('retains all 52 official main steps, including the four clock faces at step 52', () => {
    const manual = serializeBuildManual(plan)
    expect(manual.steps.map((step) => step.completedPieceCount)).toEqual(cumulativeCounts)
    expect(manual.steps.at(-1)?.addPieces.filter((piece) => piece.brickId === 'tile-round-clock-2x2')).toHaveLength(4)
    expect(manual.steps.at(-2)?.addPieces).toHaveLength(34)
    for (const id of ['tile-round-clock-2x2', 'tile-big-ben-nameplate']) {
      const definition = brickById.get(id)!
      const layers = createLDrawPrintGeometries(definition.partNumber, definition.footprint)
      expect(layers.length).toBeGreaterThan(0)
      expect(layers[0].geometry.getAttribute('position').count).toBeGreaterThan(200)
    }
  })

  it('preserves sideways bricks through normal loading, JSON and manual import', () => {
    const empty: BuildPlan = { id: 'empty', title: 'Empty', prompt: '', source: 'template-local', bricks: [], steps: [] }
    const loaded = importAssetPlanIncrementally(empty, plan)!.plan
    for (const value of [loaded, serializeBuildManual(loaded)]) {
      const restored = parseImportedPlan(JSON.parse(JSON.stringify(value)))!
      expect(restored.bricks).toHaveLength(346)
      expect(restored.bricks.map((b) => b.pose)).toEqual(loaded.bricks.map((b) => ({ ...b.pose, verticalQuarterTurns: b.pose.verticalQuarterTurns ?? 0 })))
      expect(validateBuildPlan(restored)).toEqual([])
    }
  }, 60_000)
})
