import { describe, expect, it } from 'vitest'
import { serializeBuildManual } from './manualSerializer'
import { parseImportedPlan, parseImportedProject } from './planFileIO'
import { makeBrick } from './planUtils'
import type { BuildPlan } from '../types/bricks'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'

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

  it('round-trips official construction recipes and installation-only stages in schema 7', () => {
    const id = plan.bricks[0].id
    const construction = { assemblyId: 'assembly', baseBrickId: id, sourceStepId: 'official-build' }
    const source: BuildPlan = { ...plan, constructionAssemblies: { assembly: { brickIds: [id] } }, steps: [
      { id: 'build', title: 'Build', description: '', brickIds: [id], construction },
      { id: 'install', title: 'Install', description: '', brickIds: [], construction },
    ] }
    const manual = serializeBuildManual(source)
    expect(manual.schemaVersion).toBe(7)
    const restored = parseImportedPlan(manual)!
    expect(restored.constructionAssemblies).toEqual(source.constructionAssemblies)
    expect(restored.steps.map(step => step.construction)).toEqual([construction, construction])
    expect(restored.steps.map(step => step.brickIds)).toEqual([[id], []])
    const missingRecipe = { ...manual, steps: manual.steps.map(step => ({ ...step, constructionStep: undefined })) }
    expect(parseImportedPlan(missingRecipe)).toBeUndefined()
    expect(parseImportedPlan({ ...manual, totalPieces: 2 })).toBeUndefined()
  })

  it('rejects unrelated data', () => {
    expect(parseImportedPlan({ schemaVersion: 5, steps: [] })).toBeUndefined()
  })

  it('round-trips voxel placement and story interaction state in schema 6', () => {
    const state = { slabHalf: 'top' as const, open: true, powered: false, containerName: 'Evidence', storyContents: [{ id: 'letter', title: 'Letter', description: 'Clue', tags: ['quest'], taken: true, discovered: true }] }
    const source = { ...plan, bricks: [{ ...makeBrick('minecraft-chest', 'brown', 0, 0, 0), voxelState: state }] }
    expect(parseImportedPlan(serializeBuildManual(source))?.bricks[0].voxelState).toEqual(state)
    const legacy = { ...serializeBuildManual(source), schemaVersion: 5 }
    expect(parseImportedPlan(legacy)?.bricks).toHaveLength(1)
  })

  it('round-trips an optional world while remaining compatible with plan-only JSON', () => {
    const world = {
      ...createEmptyWorldState(plan.id),
      entities: [createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'knight-1', name: '守门人' })],
    }
    const project = parseImportedProject({ schemaVersion: 6, plan, world })
    expect(project?.plan.id).toBe(plan.id)
    expect(project?.world?.entities[0]).toMatchObject({ id: 'knight-1', name: '守门人' })
    expect(parseImportedProject(plan)).toEqual({ plan: parseImportedPlan(plan), world: undefined })
  })

  it('drops a world whose plan id does not match the imported plan', () => {
    const mismatchedWorld = createEmptyWorldState('other-plan')
    expect(parseImportedProject({ plan, world: mismatchedWorld })?.world).toBeUndefined()
  })
})
