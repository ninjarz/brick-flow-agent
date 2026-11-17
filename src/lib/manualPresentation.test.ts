import { describe, expect, it } from 'vitest'
import { createCumulativeManualView } from './manualPresentation'
import { serializeBuildManual } from './manualSerializer'
import { parseImportedPlan } from './planFileIO'
import { makeBrick } from './planUtils'
import type { BuildPlan } from '../types/bricks'

const bricks = [makeBrick('brick-1x1', 'gray', 10, 0, 5), makeBrick('brick-1x1', 'red', 13, 0, 5)]
const plan: BuildPlan = { id: 'view', title: 'View', prompt: '', source: 'template-local', bricks,
  constructionAssemblies: { a: { brickIds: bricks.map(brick => brick.id) } },
  steps: [
    ...bricks.map((brick, i) => ({ id: `step-${i}`, title: `Step ${i}`, description: '', brickIds: [brick.id], construction: { assemblyId: 'a', sourceStepId: `step-${i}` } })),
    { id: 'install', title: 'Install', description: '', brickIds: [], construction: { assemblyId: 'a' } },
  ] }

describe('cumulative manual presentation', () => {
  it('retains official order, installation stages, identities and final poses', () => {
    const manual = serializeBuildManual(plan)
    const view = createCumulativeManualView(manual, 'zh-CN')
    expect(view.steps.map(step => step.title)).toEqual(manual.steps.map(step => step.title))
    expect(view.steps.flatMap(step => step.addPieces)).toEqual(manual.steps.flatMap(step => step.addPieces))
    expect(view.steps[2].addPieces).toEqual([])
    expect(view.steps.every(step => !step.construction && step.constructionStep)).toBe(true)
    expect(view.steps.every(step => step.validation.checked === false)).toBe(true)
    expect(view.steps[0].validation.summary).toContain('最终装配位置')
    expect(manual.steps[0].construction).toBeDefined()
    expect(manual.steps[0].validation.checked).toBe(true)
  })
  it('exports final placement coordinates while retaining a round-trippable official timeline', () => {
    const view = createCumulativeManualView(serializeBuildManual(plan), 'en-US')
    const serialized = JSON.parse(JSON.stringify(view))
    expect(serialized.steps.every((step: { construction?: unknown }) => step.construction === undefined)).toBe(true)
    const imported = parseImportedPlan(serialized)!
    expect(imported.bricks.map(brick => brick.pose.xStud)).toEqual([10, 13])
    expect(imported.steps[2].brickIds).toEqual([])
    expect(imported.steps.every(step => step.construction)).toBe(true)
  })
  it('keeps existing ordinary manuals intact', () => {
    const manual = serializeBuildManual({ ...plan, constructionAssemblies: undefined, steps: [] })
    expect(createCumulativeManualView(manual, 'en-US')).toBe(manual)
  })
})

it('breaks a large stand into small bottom-up pages with accurate inventory and progress', () => {
  const manual = serializeBuildManual(plan)
  const pieces = Array.from({ length: 39 }, (_, index) => ({ ...manual.steps[0].addPieces[0], instanceId: `stand-${index}`, pose: { ...bricks[0].pose, yStud: index < 20 ? 1.2 : 0, xStud: index } }))
  const source = { ...manual, totalPieces: 39, steps: [{ ...manual.steps[0], addPieces: pieces,
    stepInventory: [{ ...manual.steps[0].stepInventory[0], quantity: 39 }] }] }
  const view = createCumulativeManualView(source, 'zh-CN')
  expect(view.steps).toHaveLength(8)
  expect(view.steps.every(step => step.addPieces.length <= 6)).toBe(true)
  expect(view.steps[0].addPieces.every(piece => piece.pose.yStud === 0)).toBe(true)
  expect(new Set(view.steps.flatMap(step => step.addPieces.map(piece => piece.instanceId))).size).toBe(39)
  expect(view.steps.at(-1)?.completedPieceCount).toBe(39)
  expect(view.totalSteps).toBe(8)
  for (const step of view.steps) {
    expect(step.stepInventory.reduce((total, item) => total + item.quantity, 0)).toBe(step.addPieces.length)
    expect(step.constructionStep?.focusBrickIds).toEqual(step.addPieces.map(piece => piece.instanceId))
  }
  expect(source.steps[0].addPieces).toBe(pieces)
  expect(createCumulativeManualView(view, 'zh-CN')).toBe(view)
})
