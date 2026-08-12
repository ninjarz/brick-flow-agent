import type { PlacedBrick } from '../types/bricks'
import { getBrickBounds } from './planUtils'

export type WorldObstacleBounds = NonNullable<ReturnType<typeof getBrickBounds>>

export type WorldObstacleIndex = {
  bounds: WorldObstacleBounds[]
  cells: Map<string, number[]>
}

const cellSizeStuds = 2
const toCell = (value: number) => Math.floor(value / cellSizeStuds)
const cellKey = (x: number, z: number) => `${x}:${z}`

export const createWorldObstacleIndex = (bricks: PlacedBrick[]): WorldObstacleIndex => {
  // An open door remains editable and visible, but no longer blocks the world
  // navigation lane through its original closed plane.
  const bounds = bricks
    .filter((brick) => !(brick.brickId === 'minecraft-oak-door' && brick.voxelState?.open))
    .map(getBrickBounds)
    .filter((item): item is WorldObstacleBounds => Boolean(item))
  const cells = new Map<string, number[]>()
  bounds.forEach((item, index) => {
    for (let x = toCell(item.minX); x <= toCell(item.maxX); x += 1) {
      for (let z = toCell(item.minZ); z <= toCell(item.maxZ); z += 1) {
        const key = cellKey(x, z)
        const bucket = cells.get(key)
        if (bucket) bucket.push(index)
        else cells.set(key, [index])
      }
    }
  })
  return { bounds, cells }
}

export const queryWorldObstacleBounds = (
  index: WorldObstacleIndex,
  area: { minX: number; maxX: number; minZ: number; maxZ: number },
) => {
  const candidateIndices = new Set<number>()
  for (let x = toCell(area.minX); x <= toCell(area.maxX); x += 1) {
    for (let z = toCell(area.minZ); z <= toCell(area.maxZ); z += 1) {
      for (const candidate of index.cells.get(cellKey(x, z)) ?? []) candidateIndices.add(candidate)
    }
  }
  return [...candidateIndices].map((candidate) => index.bounds[candidate])
}
