import { describe, expect, it } from 'vitest'
import { Matrix4 } from 'three'
import { brickById } from '../data/basicBricks'
import type { BuildPlan } from '../types/bricks'
import { createConstructionSceneBuilder } from './constructionScene'
import { createReferenceConstructionValidator, type ConstructionValidationCache } from './constructionValidationCache'
import { getRigidBrickMatrix, brickPoseFromRigidMatrix } from './rigidBrickTransform'
import { makeBrick } from './planUtils'

const base = { ...makeBrick('brick-2x4', 'gray', 10, 8, 12), id: 'base' }
const child = { ...makeBrick('brick-1x1', 'red', 14, 8, 12), id: 'child' }
const reference: BuildPlan = { id: 'source', title: '', prompt: '', source: 'template-local', bricks: [base,child],
  constructionAssemblies: { wall: { brickIds: ['base','child'] } },
  steps: [{ id: 'source-step', title: '', description: '', brickIds: ['base','child'],
    construction: { assemblyId: 'wall', baseBrickId: 'base', sourceStepId: 'source-step' } }],
}
const cache: ConstructionValidationCache = { physicsRevision: '', sourcePlanSha256: '', steps: { 'source-step': { islands: [[1]] } } }

describe('verified construction cache', () => {
  it('recognizes only matching moulds and physical poses after a rigid source move', () => {
    const move = new Matrix4().makeRotationZ(.231).setPosition(70,80,90)
    const plan = { ...reference, bricks: reference.bricks.map(brick => ({ ...brick,
      pose: brickPoseFromRigidMatrix(brickById.get(brick.brickId)!, getRigidBrickMatrix(brickById.get(brick.brickId)!, brick.pose).premultiply(move)),
    })) }
    const view = createConstructionSceneBuilder(plan)(plan.steps[0], new Set(['base','child']))!
    const validate = createReferenceConstructionValidator(plan, reference, cache)
    expect(validate(plan.steps[0], view.bricks)).toEqual([{ type: 'disconnected-island', brickId: 'child', componentIndex: 2, componentCount: 2 }])
    const moved = view.bricks.map(brick => brick.id === 'child' ? { ...brick, pose: { ...brick.pose, xStud: brick.pose.xStud + 1e-7 } } : brick)
    expect(validate(plan.steps[0], moved)).toBeUndefined()
    expect(validate(plan.steps[0], view.bricks.map(brick => ({ ...brick, color: 'white' })))).toBeUndefined()
  })

  it('maps verified issue membership to the current instance identities', () => {
    const sourceToCurrent = new Map([['base','current-base'],['child','current-child']])
    const plan = { ...reference, bricks: reference.bricks.map(brick => ({ ...brick, id: sourceToCurrent.get(brick.id)! })),
      constructionAssemblies: { wall: { brickIds: ['current-base','current-child'] } },
      steps: [{ ...reference.steps[0], id: 'new-step', brickIds: ['current-base','current-child'], construction: { ...reference.steps[0].construction!, baseBrickId: 'current-base' } }],
    }
    const view = createConstructionSceneBuilder(plan)(plan.steps[0], new Set(plan.steps[0].brickIds))!
    expect(createReferenceConstructionValidator(plan, reference, cache)(plan.steps[0], view.bricks)?.[0]).toMatchObject({ brickId: 'current-child' })
  })

  it('rejects nonfinite transforms, duplicate identities and unknown certificate keys', () => {
    const view = createConstructionSceneBuilder(reference)(reference.steps[0], new Set(['base','child']))!
    const validate = createReferenceConstructionValidator(reference, reference, cache)
    expect(validate(reference.steps[0], view.bricks.map(brick => ({ ...brick, pose: { ...brick.pose, xStud: NaN } })))).toBeUndefined()
    expect(validate(reference.steps[0], view.bricks.map(brick => ({ ...brick, id: 'duplicate' })))).toBeUndefined()
    expect(validate({ ...reference.steps[0], construction: { ...reference.steps[0].construction!, sourceStepId: 'unknown' } }, view.bricks)).toBeUndefined()
  })
})
