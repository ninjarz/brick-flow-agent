import { describe, expect, it } from 'vitest'
import { Matrix4 } from 'three'
import { brickById } from '../data/basicBricks'
import type { BuildPlan } from '../types/bricks'
import { makeBrick } from './planUtils'
import { migrateLegacyConstructionInstances, type LegacyConstructionSource } from './legacyConstructionMigration'
import { brickPoseFromRigidMatrix, getRigidBrickMatrix } from './rigidBrickTransform'
import { getBrickWorldBounds } from './ldrawBounds'

const bottom = { ...makeBrick('brick-2x4', 'gray', 10, 0, 12), id: 'base' }
const top = { ...makeBrick('brick-1x1', 'red', 10, 1.2, 12), id: 'top' }
const reference: BuildPlan = { id: 'reference', title: '', prompt: '', source: 'template-local', bricks: [bottom, top],
  constructionAssemblies: { wall: { brickIds: ['base', 'top'] } }, steps: [
    { id: 'build', title: '', description: '', brickIds: ['base', 'top'], instructionStep: 1, construction: { assemblyId: 'wall', baseBrickId: 'base' } },
    { id: 'install', title: '', description: '', brickIds: [], instructionStep: 2, construction: { assemblyId: 'wall', baseBrickId: 'base' } },
  ] }
const legacy: LegacyConstructionSource = { bricks: reference.bricks, components: [['base','top']], steps: [{ brickIds: ['base','top'], instructionStep: 1 }] }
const current: BuildPlan = { ...reference, constructionAssemblies: undefined,
  bricks: reference.bricks.map(brick => ({ ...brick, id: `instance-${brick.id}` })),
  steps: [{ id: 'old-build', title: '', description: '', brickIds: ['instance-base','instance-top'], instructionStep: 1 }] }

describe('legacy construction migration', () => {
  it('preserves instance identities and adds installation-only stages with remapped references', () => {
    const result = migrateLegacyConstructionInstances(current, reference, legacy)
    expect(result.bricks.map(brick => brick.id)).toEqual(current.bricks.map(brick => brick.id))
    expect(result.steps).toHaveLength(2)
    expect(result.steps[1].brickIds).toEqual([])
    expect(result.steps[0].construction?.baseBrickId).toBe('instance-base')
    expect(Object.values(result.constructionAssemblies!)[0].brickIds).toEqual(['instance-base','instance-top'])
    expect(migrateLegacyConstructionInstances(result, reference, legacy)).toBe(result)
  })

  it('retains a user rigid rotation, independent elevation and editor quarter-turn fields', () => {
    const move = new Matrix4().makeRotationY(.731).setPosition(45, 7, -13)
    const moved = { ...current, bricks: current.bricks.map(brick => ({ ...brick, pose: brickPoseFromRigidMatrix(brickById.get(brick.brickId)!,
      getRigidBrickMatrix(brickById.get(brick.brickId)!, brick.pose).premultiply(move), { ...brick.pose, verticalQuarterTurns: 1 }) })) }
    const result = migrateLegacyConstructionInstances(moved, reference, legacy)
    expect(result.steps).toHaveLength(2)
    for (let index = 0; index < result.bricks.length; index++) {
      const definition = brickById.get(result.bricks[index].brickId)!
      const a = getRigidBrickMatrix(definition, result.bricks[index].pose).elements
      const b = getRigidBrickMatrix(definition, moved.bricks[index].pose).elements
      expect(Math.max(...a.map((value, i) => Math.abs(value - b[i])))).toBeLessThan(1e-11)
      expect(result.bricks[index].pose.verticalQuarterTurns).toBe(1)
    }
    expect(getBrickWorldBounds(brickById.get(bottom.brickId)!, result.bricks[0].pose).minY).toBeCloseTo(7, 10)
  })

  it('keeps mixed workspace objects intact and rejects a deformed or recoloured old model', () => {
    const extra = { ...makeBrick('brick-2x2', 'blue', -10, 0, -10), id: 'other' }
    const mixed = { ...current, bricks: [extra, ...current.bricks], steps: [{ id: 'other-step', title: '', description: '', brickIds: ['other'] }, ...current.steps] }
    const result = migrateLegacyConstructionInstances(mixed, reference, legacy)
    expect(result.bricks[0]).toBe(extra)
    expect(result.steps[0]).toBe(mixed.steps[0])
    expect(result.steps).toHaveLength(3)
    const deformed = { ...current, bricks: current.bricks.map((brick, i) => i ? { ...brick, pose: { ...brick.pose, xStud: brick.pose.xStud + .01 } } : brick) }
    expect(migrateLegacyConstructionInstances(deformed, reference, legacy)).toBe(deformed)
    const recoloured = { ...current, bricks: current.bricks.map((brick, i) => i ? { ...brick, color: 'blue' } : brick) } as BuildPlan
    expect(migrateLegacyConstructionInstances(recoloured, reference, legacy)).toBe(recoloured)
  })
})
