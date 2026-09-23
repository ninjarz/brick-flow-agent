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
