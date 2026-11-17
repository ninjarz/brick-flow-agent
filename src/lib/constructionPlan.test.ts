import { describe, expect, it } from 'vitest'
import { Matrix4 } from 'three'
import type { BuildPlan } from '../types/bricks'
import { makeBrick } from './planUtils'
import { importAssetPlanIncrementally } from './incrementalAssetImport'
import { isValidConstructionData, pruneConstructionData } from './constructionPlan'
import { tryNormalizeImportedPlan } from './planImport'

const base = { ...makeBrick('brick-2x4', 'gray', 0, 0, 0), id: 'base' }
const child = { ...makeBrick('brick-1x1', 'red', 0, 1.2, 0), id: 'child' }
const asset: BuildPlan = { id: 'official', title: 'official', prompt: '', source: 'template-local', bricks: [base,child],
  constructionAssemblies: { wall: { brickIds: ['base','child'] } },
  steps: [{ id: 'build', title: '', description: '', brickIds: ['base','child'], instructionStep: 1,
    construction: { assemblyId: 'wall', sourceStepId: 'official-build', baseBrickId: 'base',
      focusBrickIds: ['child'], hiddenPrintBrickIds: ['child'], adjustments: [{ brickId: 'child', anchorBrickId: 'base', matrix: new Matrix4().identity().toArray() }] } },
  { id: 'install', title: 'install', description: '', brickIds: [], instructionStep: 2, construction: { assemblyId: 'wall', baseBrickId: 'base' } }],
}

const ids = () => { let serial = 0; return (prefix: string) => `${prefix}-${serial++}` }

describe('construction data ownership', () => {
  it('remaps all identities and retains installation-only steps when importing the same asset twice', () => {
    const empty = { ...asset, id: 'workspace', bricks: [], steps: [], constructionAssemblies: undefined }
    const factory = ids()
    const first = importAssetPlanIncrementally(empty, asset, factory)!
    const second = importAssetPlanIncrementally(first.plan, asset, factory)!
    expect(second.plan.steps).toHaveLength(4)
    expect(Object.keys(second.plan.constructionAssemblies!)).toHaveLength(2)
    expect(isValidConstructionData(second.plan)).toBe(true)
    const stage = second.plan.steps[2].construction!
    expect(stage.sourceStepId).toBe('official-build')
    expect(stage.baseBrickId).toBe(second.brickIdMap.base)
    expect(stage.adjustments![0].brickId).toBe(second.brickIdMap.child)
    expect(stage.adjustments![0].anchorBrickId).toBe(second.brickIdMap.base)
    expect(stage.focusBrickIds).toEqual([second.brickIdMap.child])
    expect(stage.hiddenPrintBrickIds).toEqual([second.brickIdMap.child])
    expect(second.plan.steps[3].brickIds).toEqual([])
    expect(tryNormalizeImportedPlan(JSON.parse(JSON.stringify(second.plan)))?.constructionAssemblies).toEqual(second.plan.constructionAssemblies)
  })

  it('invalidates a deleted reference datum without retaining empty installation steps', () => {
    const edited = { ...asset, bricks: [child], steps: asset.steps.map(step => ({ ...step, brickIds: step.brickIds.filter(id => id !== 'base') })) }
    const result = pruneConstructionData(edited)
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].construction).toBeUndefined()
    expect(result.constructionAssemblies!.wall.brickIds).toEqual(['child'])
    expect(asset.constructionAssemblies!.wall.brickIds).toEqual(['base','child'])
  })

  it('rejects missing assembly references, unknown members and nonrigid adjustments during import', () => {
    const missing = structuredClone(asset)
    missing.steps[0].construction!.assemblyId = 'missing'
    expect(tryNormalizeImportedPlan(missing)).toBeUndefined()
    const member = structuredClone(asset)
    member.constructionAssemblies!.wall.brickIds.push('missing')
    expect(tryNormalizeImportedPlan(member)).toBeUndefined()
    const scale = structuredClone(asset)
    scale.steps[0].construction!.adjustments![0].matrix = new Matrix4().makeScale(1, 2, 1).toArray()
    expect(tryNormalizeImportedPlan(scale)).toBeUndefined()
    const approximateScale = structuredClone(asset)
    approximateScale.steps[0].construction!.adjustments![0].matrix = new Matrix4().makeScale(1, 1.000001, 1).toArray()
    expect(tryNormalizeImportedPlan(approximateScale)).toBeUndefined()
    const inherited = structuredClone(asset)
    inherited.steps[0].construction!.assemblyId = 'toString'
    expect(tryNormalizeImportedPlan(inherited)).toBeUndefined()
  })
})
