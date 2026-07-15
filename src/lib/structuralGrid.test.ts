import { beforeAll, describe, expect, it } from 'vitest'
import { brickById } from '../data/basicBricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import { getBrickInteractionStructuralCells } from './structuralGrid'
import {
  createBrickCollisionIndex,
  getBrickRawOverlapScore,
  hasBrickCollision,
  makeBrick,
} from './planUtils'

describe('structural collision index', () => {
  beforeAll(async () => {
    await loadLDrawGeneratedVisual()
  })

  it('keeps ordinary rectangular parts on a stable nominal collision body', () => {
    const definition = brickById.get('brick-2x4')
    expect(definition).toBeDefined()

    const collisionCells = getBrickInteractionStructuralCells(definition!)
    expect(collisionCells).toHaveLength(1)
    expect(collisionCells[0]).toMatchObject({
      kind: 'solid',
      minX: 0,
      maxX: 4,
      minY: 0,
      maxY: 1.2,
      minZ: 0,
      maxZ: 2,
    })
  })

  it('uses a coarse broad phase while preserving exact overlap scores', () => {
    const fixed = makeBrick('brick-2x4', 'gray', 0, 0, 0)
    const index = createBrickCollisionIndex([fixed])
    const fullOverlap = makeBrick('brick-1x1', 'gray', 0, 0, 0)
    const edgeOverlap = makeBrick('brick-1x1', 'gray', 3.8, 0, 0)
    const touching = makeBrick('brick-1x1', 'gray', 4, 0, 0)

    expect(index.brickKeys.get(fixed.id)!.size).toBeLessThan(30)
    expect(hasBrickCollision(fullOverlap, [fixed], index)).toBe(true)
    expect(hasBrickCollision(edgeOverlap, [fixed], index)).toBe(true)
    expect(hasBrickCollision(touching, [fixed], index)).toBe(false)

    const fullScore = getBrickRawOverlapScore(fullOverlap, [fixed], index)
    const edgeScore = getBrickRawOverlapScore(edgeOverlap, [fixed], index)
    expect(fullScore).toBeGreaterThan(edgeScore)
    expect(edgeScore).toBeGreaterThan(0)
    expect(getBrickRawOverlapScore(touching, [fixed], index)).toBe(0)
  })

  it('indexes overlapping parts correctly in negative world coordinates', () => {
    const fixed = makeBrick('brick-2x2', 'gray', -2, 0, -2)
    const overlap = makeBrick('brick-1x1', 'gray', -1.2, 0, -1.2)
    const index = createBrickCollisionIndex([fixed])

    expect(hasBrickCollision(overlap, [fixed], index)).toBe(true)
  })
})
