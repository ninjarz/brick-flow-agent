import { describe, expect, it } from 'vitest'
import type { PlacedBrick } from '../types/bricks'
import { getBrickWorldCollisionKeys } from './structuralGrid'
import {
  applyVoxelPlacementSurface,
  getFenceConnections,
  getStairRotationFromViewDirection,
  isVoxelDoorStateClear,
  isVoxelPlantSupported,
  synchronizeVoxelBlockStates,
  toggleVoxelBlockInteraction,
} from './voxelBlockState'

const brick = (id: string, brickId: string, x: number, y: number, z: number): PlacedBrick => ({
  id,
  brickId,
  color: 'gray',
  pose: { xStud: x, yStud: y, zStud: z, rotationQuarterTurns: 0 },
})

describe('voxel block state', () => {
  it('terminates for large finite imported coordinates', () => {
    const source = brick('large', 'minecraft-oak-fence', 1e20, 1e20, -1e20)
    expect(synchronizeVoxelBlockStates([source])[0].voxelState?.fenceConnections).toEqual(getFenceConnections(source, [source]))
  })
  it('matches exact neighbor scanning near bucket boundaries and reuses unchanged state', () => {
    const blocks = Array.from({ length: 120 }, (_, index) => brick(String(index), index % 3 ? 'minecraft-oak-fence' : 'minecraft-stone',
      index % 10 + (index % 2 ? 0.0005 : 0), index % 4 === 0 ? 0.0005 : 0, Math.floor(index / 10)))
    const updated = synchronizeVoxelBlockStates(blocks)
    for (const block of updated.filter((item) => item.brickId === 'minecraft-oak-fence')) {
      expect(block.voxelState?.fenceConnections).toEqual(getFenceConnections(block, blocks))
    }
    expect(synchronizeVoxelBlockStates(updated)).toBe(updated)
  })
  it('persists interactive door, chest, and lantern state on the placed block', () => {
    expect(toggleVoxelBlockInteraction(brick('door', 'minecraft-oak-door', 0, 0, 0)).voxelState?.open).toBe(true)
    expect(toggleVoxelBlockInteraction(brick('chest', 'minecraft-chest', 0, 0, 0)).voxelState?.open).toBe(true)
    const lantern = toggleVoxelBlockInteraction(brick('lantern', 'minecraft-lantern', 0, 0, 0))
    expect(lantern.voxelState?.powered).toBe(false)
    expect(toggleVoxelBlockInteraction(lantern).voxelState?.powered).toBe(true)
  })
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

  it('supports plants only over an actual top face', () => {
    const stair = brick('stair', 'minecraft-oak-stairs', 0, 0, 0)
    expect(isVoxelPlantSupported(brick('low', 'minecraft-tall-grass', 0, 1, -0.2), [stair])).toBe(false)
    expect(isVoxelPlantSupported(brick('high', 'minecraft-tall-grass', 0, 1, 0.2), [stair])).toBe(true)
    const rotatedStair = { ...stair, pose: { ...stair.pose, rotationQuarterTurns: 2 as const } }
    expect(isVoxelPlantSupported(brick('rotated-low', 'minecraft-tall-grass', 0, 1, 0.2), [rotatedStair])).toBe(false)
  })

  it('rejects opening a door into an occupied leaf area', () => {
    const door = { ...brick('door', 'minecraft-oak-door', 0, 0, 0), voxelState: { open: true } }
    expect(isVoxelDoorStateClear(door, [door, brick('lamp', 'minecraft-lantern', 0.8, 0, 0.8)])).toBe(false)
    expect(isVoxelDoorStateClear(door, [door])).toBe(true)
  })
})
