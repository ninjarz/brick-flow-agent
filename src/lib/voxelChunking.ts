import type { PlacedBrick } from '../types/bricks'

export const voxelChunkSizeStuds = 16

export const getVoxelChunkCoordinate = (
  coordinate: number,
  chunkSize = voxelChunkSizeStuds,
) => Math.floor(coordinate / chunkSize)

export const getVoxelChunkKey = (
  brick: Pick<PlacedBrick, 'pose'>,
  chunkSize = voxelChunkSizeStuds,
) => `${getVoxelChunkCoordinate(brick.pose.xStud, chunkSize)},${getVoxelChunkCoordinate(brick.pose.zStud, chunkSize)}`

export const partitionVoxelItemsByChunk = <T>(
  items: T[],
  getPosition: (item: T) => { x: number; z: number },
  chunkSize = voxelChunkSizeStuds,
) => {
  const chunks = new Map<string, T[]>()
  for (const item of items) {
    const position = getPosition(item)
    const key = `${getVoxelChunkCoordinate(position.x, chunkSize)},${getVoxelChunkCoordinate(position.z, chunkSize)}`
    const chunk = chunks.get(key)
    if (chunk) chunk.push(item)
    else chunks.set(key, [item])
  }
  return chunks
}
