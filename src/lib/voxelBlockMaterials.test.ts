import { describe, expect, it } from 'vitest'
import { NearestFilter } from 'three'
import { brickDefinitions } from '../data/basicBricks'
import { getVoxelBlockMaterials, getVoxelPixelTexture, resolveVoxelFaceTextureIds } from './voxelBlockMaterials'

describe('voxel block materials', () => {
  it('gives every built-in Minecraft block an original voxel appearance', () => {
    const minecraftBlocks = brickDefinitions.filter((brick) => brick.pack === 'minecraft')
    expect(minecraftBlocks.length).toBeGreaterThan(0)
    expect(minecraftBlocks.every((brick) => Boolean(brick.voxelVisual))).toBe(true)
  })

  it('resolves independent top, bottom and side textures in BoxGeometry order', () => {
    expect(resolveVoxelFaceTextureIds({
      shape: 'cube',
      textures: { all: 'side', top: 'top', bottom: 'bottom' },
      renderLayer: 'opaque',
    })).toEqual(['side', 'side', 'top', 'bottom', 'side', 'side'])
  })

  it('creates deterministic nearest-filtered 16px textures and cached materials', () => {
    const texture = getVoxelPixelTexture('grass-top')
    expect(texture.image).toMatchObject({ width: 16, height: 16 })
    expect(texture.magFilter).toBe(NearestFilter)
    expect(texture.minFilter).toBe(NearestFilter)
    expect(getVoxelPixelTexture('grass-top')).toBe(texture)

    const visual = {
      shape: 'cube' as const,
      textures: { all: 'water' },
      renderLayer: 'translucent' as const,
    }
    const materials = getVoxelBlockMaterials(visual)
    expect(materials).toHaveLength(6)
    expect(materials.every((material) => material.transparent && !material.depthWrite)).toBe(true)
    expect(getVoxelBlockMaterials(visual)).toBe(materials)
  })
})
