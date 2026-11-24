import { describe, expect, it } from 'vitest'
import type { BuildPlan } from '../types/bricks'
import { createBuildGraph, createId, findOpenPose, getBrickBounds, hasBrickCollision, makeBrick, repairBuildPlan, validateBuildPlan } from './planUtils'

const plan = (bricks: BuildPlan['bricks'], structures: BuildPlan['structures'] = []): BuildPlan => ({
  id: 'plan', title: 'Repair', prompt: '', source: 'llm', bricks, steps: [], structures,
})

describe('repairBuildPlan', () => {
  it('keeps several side-by-side ground pieces on the ground', () => {
    const left = makeBrick('brick-2x4', 'gray', 0, 0, 0)
    const right = makeBrick('brick-2x4', 'gray', 10, 0, 0)
    const repaired = repairBuildPlan(plan([left, right]))
    expect(repaired.bricks).toHaveLength(2)
    expect(repaired.bricks.map(brick => brick.pose.yStud)).toEqual([0, 0])
    expect(repaired.bricks[1].pose.xStud).toBe(right.pose.xStud)
  })

  it('rewrites structure membership to the pieces that survived repair', () => {
    const base = makeBrick('brick-2x4', 'gray', 0, 0, 0)
    const unknown = { ...makeBrick('brick-2x4', 'gray', 10, 0, 0), brickId: 'not-a-real-part' }
    const repaired = repairBuildPlan(plan([base, unknown], [
      { id: 'kept', name: 'Kept', description: '', brickIds: [base.id, unknown.id] },
      { id: 'dropped', name: 'Dropped', description: '', brickIds: [unknown.id] },
    ]))
    const ids = new Set(repaired.bricks.map(brick => brick.id))
    expect(repaired.structures?.map(structure => structure.id)).toEqual(['kept'])
    expect(repaired.structures?.[0].brickIds.every(id => ids.has(id))).toBe(true)
  })
})

describe('repairBuildPlan ordering', () => {
  it('keeps an upper piece listed before its support', () => {
    const base = makeBrick('brick-2x4', 'gray', 0, 0, 0)
    const top = makeBrick('brick-2x2', 'gray', 1, 1.2, 1)
    const repaired = repairBuildPlan(plan([top, base]))
    expect(repaired.bricks).toHaveLength(2)
    expect(repaired.bricks.map(brick => brick.brickId)).toEqual(['brick-2x4', 'brick-2x2'])
    expect(repaired.bricks[1].pose).toMatchObject({ xStud: top.pose.xStud, yStud: top.pose.yStud, zStud: top.pose.zStud })
  })
})

describe('repairBuildPlan airborne pieces', () => {
  it('drops an unsupported floating piece instead of dumping it on a distant floor spot', () => {
    const base = makeBrick('brick-2x4', 'gray', 0, 0, 0)
    const floating = makeBrick('brick-1x1', 'gray', 30, 6, 30)
    const repaired = repairBuildPlan(plan([base, floating]))
    expect(repaired.bricks.map(brick => brick.brickId)).toEqual(['brick-2x4'])
  })
})

describe('findOpenPose', () => {
  it('finds the nearest free ground spot beside the requested position', () => {
    const blocker = makeBrick('brick-2x4', 'gray', 20, 0, 20)
    const requested = makeBrick('brick-1x1', 'gray', 20, 0, 20)
    const result = findOpenPose(requested, [blocker])
    expect(getBrickBounds(result)?.minY).toBeCloseTo(0, 6)
    expect(hasBrickCollision(result, [blocker])).toBe(false)
    expect(Math.hypot(result.pose.xStud - 20, result.pose.zStud - 20)).toBeLessThanOrEqual(4)
  })
})

describe('pair enumeration', () => {
  it('finds every attachment and collision regardless of brick order', () => {
    const bricks = [
      makeBrick('brick-2x4', 'gray', 0, 0, 0),
      makeBrick('brick-2x2', 'gray', 1, 1.2, 1),
      makeBrick('brick-2x2', 'gray', 1, 1.2, 1),
      makeBrick('brick-1x1', 'gray', 3, 1.2, 0),
    ]
    const edgeSet = (list: typeof bricks) => {
      const graph = createBuildGraph(list)
      return [...graph.attachmentEdges].flatMap(([id, targets]) => [...targets].map(target => [id, target].sort().join('|'))).sort()
    }
    const reversed = [...bricks].reverse()
    expect(edgeSet(reversed)).toEqual(edgeSet(bricks))
    const collisions = (list: typeof bricks) => validateBuildPlan(plan(list))
      .flatMap(issue => issue.type === 'collision' ? [[...issue.brickIds].sort().join('|')] : [])
    expect(collisions(bricks)).toHaveLength(1)
    expect(collisions(reversed)).toEqual(collisions(bricks))
  })
})

describe('createId', () => {
  it('creates long, well-formed, unique ids', () => {
    const ids = Array.from({ length: 10_000 }, () => createId('piece'))
    expect(ids.every(id => /^piece-[0-9a-z]{12}$/.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
