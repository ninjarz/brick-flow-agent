import { describe, expect, it } from 'vitest'
import type { PlacedBrick } from '../types/bricks'
import { getBrickWorldCollisionKeys } from './structuralGrid'
import {
  applyVoxelPlacementSurface,
  getFenceConnections,
  getStairRotationFromViewDirection,
  isVoxelPlantSupported,
  synchronizeVoxelBlockStates,
} from './voxelBlockState'

const brick = (id: string, brickId: string, x: number, y: number, z: number): PlacedBrick => ({
  id,
  brickId,
  color: 'gray',
  pose: { xStud: x, yStud: y, zStud: z, rotationQuarterTurns: 0 },
})

describe('voxel block state', () => {
  it('connects fences only to eligible horizontal neighbors', () => {
    const source = brick('fence', 'minecraft-oak-fence', 0, 0, 0)
    const blocks = [
      source,
      brick('east', 'minecraft-stone-block', 1, 0, 0),
      brick('south', 'minecraft-oak-fence', 0, 0, 1),
      brick('plant', 'minecraft-tall-grass', -1, 0, 0),
    ]
    expect(getFenceConnections(source, blocks)).toEqual({
      north: false,
      east: true,
      south: true,
      west: false,
    })
    expect(synchronizeVoxelBlockStates(blocks)[0].voxelState?.fenceConnections?.east).toBe(true)
    const isolatedFence = synchronizeVoxelBlockStates([source])[0]
    const connectedFence = synchronizeVoxelBlockStates([source, blocks[1]])[0]
    expect(getBrickWorldCollisionKeys(connectedFence).size).toBeGreaterThan(
      getBrickWorldCollisionKeys(isolatedFence).size,
    )
  })

  it('faces stairs away from the camera ray and places slabs in the selected half', () => {
    expect(getStairRotationFromViewDirection(0.8, 0.1)).toBe(1)
    const slab = brick('slab', 'minecraft-stone-slab', 0, 1, 0)
    const [placed] = applyVoxelPlacementSurface([slab], {
      x: 0.5,
      y: 0.75,
      z: 0,
      normalX: 0,
      normalY: 0,
      normalZ: 1,
      viewDirectionX: 0,
      viewDirectionZ: -1,
    })
    expect(placed.voxelState?.slabHalf).toBe('top')
    expect(placed.pose.yStud).toBe(1.5)
  })

  it('requires plants to rest on a non-plant voxel block', () => {
    const plant = brick('plant', 'minecraft-tall-grass', 0, 1, 0)
    expect(isVoxelPlantSupported(plant, [plant])).toBe(false)
    expect(isVoxelPlantSupported(plant, [plant, brick('soil', 'minecraft-grass-block', 0, 0, 0)])).toBe(true)
  })
})
