import { describe, expect, it } from 'vitest'
import { makeBrick } from './planUtils'
import { createWorldObstacleIndex, queryWorldObstacleBounds } from './worldObstacleIndex'

describe('world obstacle spatial index', () => {
  it('returns only nearby bounds from a large static brick field', () => {
    const bricks = Array.from({ length: 1_000 }, (_, index) => makeBrick('brick-1x1', 'gray', index * 3, 0, 0))
    const obstacleIndex = createWorldObstacleIndex(bricks)
    const nearby = queryWorldObstacleBounds(obstacleIndex, { minX: 29, maxX: 31, minZ: -1, maxZ: 1 })
    expect(obstacleIndex.bounds).toHaveLength(1_000)
    expect(nearby.length).toBeGreaterThan(0)
    expect(nearby.length).toBeLessThan(5)
    expect(nearby.some((bounds) => bounds.minX <= 30 && bounds.maxX >= 30)).toBe(true)
  })

  it('deduplicates large bricks that span several buckets', () => {
    const brick = makeBrick('brick-2x8', 'gray', 0, 0, 0)
    const obstacleIndex = createWorldObstacleIndex([brick])
    expect(queryWorldObstacleBounds(obstacleIndex, { minX: 0, maxX: 8, minZ: 0, maxZ: 2 })).toHaveLength(1)
  })

  it('removes an open voxel door from navigation obstacles', () => {
    const closed = makeBrick('minecraft-oak-door', 'brown', 0, 0, 0)
    const open = { ...closed, id: 'open-door', voxelState: { open: true } }
    expect(createWorldObstacleIndex([closed]).bounds).toHaveLength(1)
    expect(createWorldObstacleIndex([open]).bounds).toHaveLength(0)
  })
})
