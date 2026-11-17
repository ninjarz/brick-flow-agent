import { describe, expect, it } from 'vitest'
import { Matrix4 } from 'three'
import { brickById } from '../data/basicBricks'
import type { BuildPlan } from '../types/bricks'
import { createConstructionSceneBuilder, replayConstructionScene } from './constructionScene'
import { getBrickBounds, makeBrick } from './planUtils'
import { brickPoseFromRigidMatrix, getRigidBrickMatrix } from './rigidBrickTransform'

const base = { ...makeBrick('brick-2x4', 'gray', 10, 8, 12), id: 'base' }
const child = { ...makeBrick('brick-1x1', 'red', 10, 9.2, 12), id: 'child' }
const plan: BuildPlan = { id: 'construction', title: '', prompt: '', source: 'template-local', bricks: [base, child],
  constructionAssemblies: { wall: { brickIds: ['base', 'child'] } },
  steps: [
    { id: 'first', title: '', description: '', brickIds: ['base'], construction: { assemblyId: 'wall', baseBrickId: 'base' } },
    { id: 'second', title: '', description: '', brickIds: ['child'], construction: { assemblyId: 'wall', baseBrickId: 'base' } },
    { id: 'installation', title: '', description: '', brickIds: [], construction: { assemblyId: 'wall', baseBrickId: 'base' } },
  ] }

const compare = (left: typeof plan.bricks, right: typeof plan.bricks) => {
  expect(left.map(brick => brick.id)).toEqual(right.map(brick => brick.id))
  for (let index = 0; index < left.length; index++) {
    const a = getRigidBrickMatrix(brickById.get(left[index].brickId)!, left[index].pose)
    const b = getRigidBrickMatrix(brickById.get(right[index].brickId)!, right[index].pose)
    expect(Math.max(...a.elements.map((value, i) => Math.abs(value - b.elements[i])))).toBeLessThan(1e-11)
  }
}

describe('official construction scenes', () => {
  it('shows only completed pieces and grounds their actual construction frame', () => {
    const build = createConstructionSceneBuilder(plan)
    const first = build(plan.steps[0], new Set(['base']))!
    expect(first.bricks.map(brick => brick.id)).toEqual(['base'])
    expect(getBrickBounds(first.bricks[0])!.minY).toBeCloseTo(0, 12)
    const second = build(plan.steps[1], new Set(['base','child']))!
    expect(getBrickBounds(second.bricks[1])!.minY).toBeCloseTo(1.2, 12)
    compare(second.bricks, replayConstructionScene(plan.bricks, plan.constructionAssemblies!, second.scene, new Set(['base','child'])))
    compare(plan.bricks, [base,child])
  })

  it('retains installation-only stages without introducing duplicate pieces', () => {
    const build = createConstructionSceneBuilder(plan)
    const completed = new Set(['base','child'])
    compare(build(plan.steps[1], completed)!.bricks, build(plan.steps[2], completed)!.bricks)
    expect(plan.steps[2].brickIds).toEqual([])
  })

  it('replays a documented flip while preserving all pairwise mould distances', () => {
    const build = createConstructionSceneBuilder(plan)
    const step = { ...plan.steps[1], construction: { ...plan.steps[1].construction!, flip: true } }
    const before = build(plan.steps[1], new Set(['base','child']))!
    const flipped = build(step, new Set(['base','child']))!
    const distance = (bricks: typeof plan.bricks) => {
      const matrices = bricks.map(brick => getRigidBrickMatrix(brickById.get(brick.brickId)!, brick.pose))
      return Math.hypot(...[12,13,14].map(i => matrices[0].elements[i] - matrices[1].elements[i]))
    }
    expect(distance(flipped.bricks)).toBeCloseTo(distance(before.bricks), 12)
    expect(Math.min(...flipped.bricks.map(brick => getBrickBounds(brick)!.minY))).toBeCloseTo(0, 12)
    compare(flipped.bricks, replayConstructionScene(plan.bricks, plan.constructionAssemblies!, flipped.scene, new Set(['base','child'])))
  })

  it('keeps relative articulation valid after the entire source assembly moves and rotates', () => {
    const stage = { ...plan.steps[1], construction: { ...plan.steps[1].construction!, adjustments: [
      { brickId: 'child', anchorBrickId: 'base', matrix: new Matrix4().makeRotationX(Math.PI / 2).toArray() },
    ] } }
    const move = new Matrix4().makeRotationZ(.735).setPosition(20,30,40)
    const moved = { ...plan, bricks: plan.bricks.map(brick => ({ ...brick,
      pose: brickPoseFromRigidMatrix(brickById.get(brick.brickId)!, getRigidBrickMatrix(brickById.get(brick.brickId)!, brick.pose).premultiply(move)),
    })) }
    const completed = new Set(['base','child'])
    const originalView = createConstructionSceneBuilder(plan)(stage, completed)!
    const movedView = createConstructionSceneBuilder(moved)(stage, completed)!
    compare(originalView.bricks, movedView.bricks)
    compare(movedView.bricks, replayConstructionScene(moved.bricks, moved.constructionAssemblies!, movedView.scene, completed))
  })

  it('keeps repeated copies disjoint on the construction table', () => {
    const copies = { ...plan, constructionAssemblies: { a: { brickIds: ['base'] }, b: { brickIds: ['child'] } } }
    const step = { ...plan.steps[1], construction: { assemblyId: 'a', groups: [{ assemblyId: 'a' }, { assemblyId: 'b' }] } }
    const view = createConstructionSceneBuilder(copies)(step, new Set(['base','child']))!
    const left = getBrickBounds(view.bricks[0])!, right = getBrickBounds(view.bricks[1])!
    expect(right.minX - left.maxX).toBeCloseTo(2, 12)
    expect(left.minY).toBeCloseTo(0, 12)
    expect(right.minY).toBeCloseTo(0, 12)
  })
})
