import { describe, expect, it } from 'vitest'
import { createProjectedSpatialIndex } from './projectedSpatialIndex'

const bounds = (minX: number, maxX: number, minY: number, maxY: number) => ({ minX, maxX, minY, maxY })

describe('projected spatial index', () => {
  it('includes both sides of cell boundaries and negative coordinates', () => {
    const items = [bounds(-4, -2, -2, 0), bounds(-2, 0, 0, 2), bounds(2, 4, 2, 4)]
    const query = createProjectedSpatialIndex(items, (item) => item)
    expect(query(-2, 0)).toEqual([items[0], items[1]])
    expect(query(-4, -2)).toEqual([items[0]])
    expect(query(4, 4)).toEqual([items[2]])
    expect(query(10, 10)).toEqual([])
  })

  it('merges broad fallback candidates with local candidates in input order without duplicates', () => {
    const items = [
      bounds(-100, 100, -100, 100),
      bounds(0, 4, 0, 4),
      bounds(-1000, 1000, -1000, 1000),
      bounds(1, 3, 1, 3),
      bounds(20, 21, 20, 21),
    ]
    const query = createProjectedSpatialIndex(items, (item) => item)
    expect(query(2, 2)).toEqual(items.slice(0, 4))
    expect(query(500, 500)).toEqual([items[0], items[2]])
  })

  it('keeps invalid bounds conservative and handles empty or non-finite queries', () => {
    const items = [bounds(NaN, 2, 0, 2), bounds(2, 1, 0, 2), bounds(0, Infinity, 0, 2)]
    const query = createProjectedSpatialIndex(items, (item) => item)
    expect(query(100, 100)).toEqual(items)
    expect(query(NaN, 0)).toEqual(items)
    expect(query(0, Infinity)).toEqual(items)
    expect(createProjectedSpatialIndex([], (item: typeof items[number]) => item)(0, 0)).toEqual([])
  })

  it('contains every exact point hit in input order for seeded random projections', () => {
    let seed = 52741
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    const items = Array.from({ length: 100 }, () => {
      const x = random() * 80 - 40
      const y = random() * 80 - 40
      return bounds(x, x + random() * 40, y, y + random() * 40)
    })
    const query = createProjectedSpatialIndex(items, (item) => item)
    for (let index = 0; index < 200; index += 1) {
      const x = random() * 120 - 60
      const y = random() * 120 - 60
      const contains = (item: typeof items[number]) => x >= item.minX && x <= item.maxX && y >= item.minY && y <= item.maxY
      const candidates = query(x, y)
      expect(candidates.filter(contains)).toEqual(items.filter(contains))
      expect(candidates).toEqual(items.filter((item) => candidates.includes(item)))
    }
  })
})
