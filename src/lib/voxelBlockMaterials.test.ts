import { describe, expect, it } from 'vitest'
import { NearestFilter } from 'three'
import { brickDefinitions } from '../data/basicBricks'
import { getBrickStructuralCells } from './structuralGrid'
import { getVoxelBlockMaterials, getVoxelPixelTexture, resolveVoxelFaceTextureIds } from './voxelBlockMaterials'

describe('voxel block materials', () => {
  it('gives every built-in Minecraft block an original voxel appearance', () => {
    const minecraftBlocks = brickDefinitions.filter((brick) => brick.pack === 'minecraft')
    expect(minecraftBlocks.length).toBeGreaterThanOrEqual(36)
    expect(minecraftBlocks.every((brick) => Boolean(brick.voxelVisual))).toBe(true)
    expect(new Set(minecraftBlocks.map((brick) => brick.catalogCategory))).toEqual(new Set([
      'terrain',
      'stone',
      'wood',
      'ore',
      'building',
      'functional',
    ]))
    for (const brick of minecraftBlocks) {
      const textureIds = resolveVoxelFaceTextureIds(brick.voxelVisual!)
      expect(textureIds.every((textureId) => getVoxelPixelTexture(textureId).image.width === 16)).toBe(true)
    }
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

  it('keeps modular block silhouettes in structural collision data', () => {
    const getDefinition = (id: string) => brickDefinitions.find((brick) => brick.id === id)!
    const solidCells = (id: string) => getBrickStructuralCells(getDefinition(id))
      .filter((cell) => cell.kind === 'solid')

    expect(solidCells('minecraft-stone-slab')).toEqual(expect.arrayContaining([
      expect.objectContaining({ minY: 0, maxY: 0.5 }),
    ]))
    expect(solidCells('minecraft-stone-stairs')).toHaveLength(2)
    expect(solidCells('minecraft-oak-fence')).toHaveLength(9)
    expect(solidCells('minecraft-tall-grass')).toEqual([
      expect.objectContaining({ minX: 0.38, maxX: 0.62, maxY: 0.9 }),
    ])
    expect(getDefinition('minecraft-tall-grass').connectors.map((connector) => connector.id)).toEqual([
      'minecraft-tall-grass-studsocket-bottom',
    ])
  })
})
