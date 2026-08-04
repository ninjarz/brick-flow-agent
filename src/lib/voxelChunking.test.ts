import { describe, expect, it } from 'vitest'
import { getVoxelChunkCoordinate, getVoxelChunkKey, partitionVoxelItemsByChunk, voxelChunkSizeStuds } from './voxelChunking'

describe('voxel chunking', () => {
  it('uses stable chunk coordinates across positive and negative boundaries', () => {
    expect(getVoxelChunkCoordinate(0)).toBe(0)
    expect(getVoxelChunkCoordinate(voxelChunkSizeStuds - 0.001)).toBe(0)
    expect(getVoxelChunkCoordinate(voxelChunkSizeStuds)).toBe(1)
    expect(getVoxelChunkCoordinate(-0.001)).toBe(-1)
    expect(getVoxelChunkCoordinate(-voxelChunkSizeStuds)).toBe(-1)
    expect(getVoxelChunkKey({ pose: { xStud: 32, yStud: 0, zStud: -1, rotationQuarterTurns: 0 } })).toBe('2,-1')
  })

  it('partitions a ten-thousand-block plane into bounded local batches', () => {
    const blocks = Array.from({ length: 10_000 }, (_, index) => ({
      x: index % 100,
      z: Math.floor(index / 100),
    }))
    const chunks = partitionVoxelItemsByChunk(blocks, (block) => block)
    expect(chunks.size).toBe(49)
    expect(Math.max(...[...chunks.values()].map((chunk) => chunk.length))).toBeLessThanOrEqual(
      voxelChunkSizeStuds ** 2,
    )
    expect([...chunks.values()].reduce((sum, chunk) => sum + chunk.length, 0)).toBe(blocks.length)
  })
})
