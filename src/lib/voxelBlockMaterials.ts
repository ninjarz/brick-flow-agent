import {
  Color,
  DataTexture,
  MeshStandardMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three'
import type { VoxelBlockVisual, VoxelRenderLayer } from '../types/bricks'

const textureSize = 16

type Pixel = readonly [number, number, number, number?]

const hexToPixel = (hex: string, alpha = 255): Pixel => {
  const color = new Color(hex)
  return [
    Math.round(color.r * 255),
    Math.round(color.g * 255),
    Math.round(color.b * 255),
    alpha,
  ]
}

const mixPixel = (base: Pixel, amount: number): Pixel => {
  const factor = amount >= 0 ? 255 : 0
  const weight = Math.abs(amount)
  return [
    Math.round(base[0] + (factor - base[0]) * weight),
    Math.round(base[1] + (factor - base[1]) * weight),
    Math.round(base[2] + (factor - base[2]) * weight),
    base[3] ?? 255,
  ]
}

const stableNoise = (x: number, y: number, salt: number) => {
  let value = Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263) ^ Math.imul(salt + 7, 2246822519)
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff
}

type SpeckleRecipe = {
  base: string
  accent?: string
  salt: number
  range: number
}

const speckleRecipes: Record<string, SpeckleRecipe> = {
  dirt: { base: '#79543b', accent: '#9b7050', salt: 23, range: 0.28 },
  stone: { base: '#7b8185', accent: '#a0a4a6', salt: 29, range: 0.2 },
  sand: { base: '#d8c27a', accent: '#eee1a8', salt: 37, range: 0.18 },
  snow: { base: '#e8f2f1', accent: '#ffffff', salt: 47, range: 0.1 },
  clay: { base: '#8b9aa3', accent: '#b2bec4', salt: 53, range: 0.15 },
  moss: { base: '#4d7330', accent: '#779443', salt: 59, range: 0.25 },
  deepslate: { base: '#363b40', accent: '#5a6065', salt: 61, range: 0.22 },
  obsidian: { base: '#17152a', accent: '#433160', salt: 67, range: 0.17 },
  'sandstone-top': { base: '#d3bd78', accent: '#f0dda1', salt: 71, range: 0.13 },
  'white-concrete': { base: '#d9dcda', accent: '#f0f1ee', salt: 73, range: 0.07 },
  'gray-concrete': { base: '#596267', accent: '#727c80', salt: 79, range: 0.07 },
  'red-concrete': { base: '#a53c36', accent: '#c95a4d', salt: 83, range: 0.07 },
}

const plankPalettes: Record<string, readonly [string, string]> = {
  'oak-planks': ['#bd8d52', '#76502f'],
  'birch-planks': ['#d7c995', '#9f8f60'],
  'spruce-planks': ['#765130', '#49331f'],
}

const logPalettes: Record<string, readonly [string, string, string]> = {
  oak: ['#886039', '#5d4027', '#c08a4d'],
  birch: ['#d8d3bd', '#5e5b50', '#c4b278'],
  spruce: ['#5d4029', '#38271c', '#88613c'],
}

const oreColors: Record<string, string> = {
  coal: '#26292d',
  iron: '#c49b76',
  copper: '#d0774c',
  gold: '#e8c342',
  redstone: '#c8322b',
  lapis: '#295cac',
  diamond: '#4fc7c8',
}

const texturePixels = (textureId: string) => {
  const pixels = new Uint8Array(textureSize * textureSize * 4)
  const setPixel = (x: number, y: number, pixel: Pixel) => {
    const offset = (y * textureSize + x) * 4
    pixels[offset] = pixel[0]
    pixels[offset + 1] = pixel[1]
    pixels[offset + 2] = pixel[2]
    pixels[offset + 3] = pixel[3] ?? 255
  }
  const speckle = (x: number, y: number, base: Pixel, salt: number, range = 0.14) => (
    mixPixel(base, (stableNoise(x, y, salt) - 0.5) * range)
  )

  for (let y = 0; y < textureSize; y += 1) {
    for (let x = 0; x < textureSize; x += 1) {
      let pixel: Pixel
      const simpleRecipe = speckleRecipes[textureId]
      const plankPalette = plankPalettes[textureId]
      const logMatch = /^(oak|birch|spruce)-log-(side|top)$/.exec(textureId)
      const oreMatch = /^(coal|iron|copper|gold|redstone|lapis|diamond)-ore$/.exec(textureId)
      if (textureId === 'grass-top') {
        pixel = speckle(x, y, hexToPixel('#4f8b38'), 11, 0.28)
        if ((x * 3 + y * 5) % 17 === 0) pixel = hexToPixel('#83ad42')
      } else if (textureId === 'grass-side') {
        const grassDepth = 3 + Math.floor(stableNoise(x, 0, 13) * 3)
        pixel = y < grassDepth
          ? speckle(x, y, hexToPixel('#528b38'), 17, 0.2)
          : speckle(x, y, hexToPixel('#765037'), 19, 0.2)
      } else if (simpleRecipe) {
        pixel = speckle(x, y, hexToPixel(simpleRecipe.base), simpleRecipe.salt, simpleRecipe.range)
        if (simpleRecipe.accent && stableNoise(x, y, simpleRecipe.salt + 101) > 0.91) {
          pixel = hexToPixel(simpleRecipe.accent)
        }
      } else if (plankPalette) {
        const seam = y % 5 === 0
        const stagger = (Math.floor(y / 5) % 2) * 8
        const verticalSeam = (x + stagger) % 16 === 0
        pixel = seam || verticalSeam
          ? hexToPixel(plankPalette[1])
          : speckle(x, y, hexToPixel(plankPalette[0]), 31 + textureId.length, 0.12)
      } else if (logMatch) {
        const [, wood, face] = logMatch
        const palette = logPalettes[wood]
        if (face === 'top') {
          const ring = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))
          pixel = Math.floor(ring) % 3 === 0
            ? hexToPixel(palette[1])
            : speckle(x, y, hexToPixel(palette[2]), 89 + wood.length, 0.1)
        } else {
          const barkLine = (x + Math.floor(stableNoise(x, y, 97) * 3)) % 5 === 0
          pixel = barkLine
            ? hexToPixel(palette[1])
            : speckle(x, y, hexToPixel(palette[0]), 101 + wood.length, 0.14)
        }
      } else if (oreMatch) {
        const ore = oreMatch[1]
        const vein = stableNoise(x, y, 109 + ore.length) > 0.79 || (x * 5 + y * 3 + ore.length) % 23 === 0
        pixel = vein
          ? hexToPixel(oreColors[ore])
          : speckle(x, y, hexToPixel('#737a7d'), 113, 0.17)
      } else if (textureId === 'oak-leaves' || textureId === 'birch-leaves') {
        const birch = textureId === 'birch-leaves'
        const transparentGap = stableNoise(x, y, birch ? 127 : 131) > 0.86
        pixel = transparentGap
          ? hexToPixel('#000000', 0)
          : speckle(x, y, hexToPixel(birch ? '#6e9944' : '#3f763b'), 137, 0.25)
      } else if (textureId === 'grass-plant') {
        const leftBlade = x >= 3 && x <= 7 && y >= 5 && x + y >= 12
        const centerBlade = x >= 7 && x <= 9 && y >= 2
        const rightBlade = x >= 9 && x <= 13 && y >= 6 && y - x >= -5
        pixel = leftBlade || centerBlade || rightBlade
          ? speckle(x, y, hexToPixel('#4f8738'), 138, 0.18)
          : hexToPixel('#000000', 0)
      } else if (textureId === 'red-flower' || textureId === 'yellow-flower') {
        const stem = x >= 7 && x <= 8 && y >= 6
        const leaf = (y >= 10 && y <= 12) && (x >= 4 && x <= 11)
        const flowerCenterX = 7.5
        const flowerCenterY = 4
        const petalDistance = Math.abs(x - flowerCenterX) + Math.abs(y - flowerCenterY)
        const petal = petalDistance <= 4 && !(Math.abs(x - flowerCenterX) > 2 && Math.abs(y - flowerCenterY) > 1)
        const bloomColor = textureId === 'red-flower' ? '#d84b43' : '#e8c73f'
        pixel = petal
          ? hexToPixel(bloomColor)
          : stem || leaf
            ? hexToPixel('#4f8137')
            : hexToPixel('#000000', 0)
      } else if (textureId === 'cobblestone') {
        const mortar = x % 5 === 0 || y % 5 === 0 || (x + Math.floor(y / 5) * 2) % 11 === 0
        pixel = mortar
          ? hexToPixel('#4e5558')
          : speckle(x, y, hexToPixel('#858b8b'), 139, 0.2)
      } else if (textureId === 'stone-bricks' || textureId === 'bricks') {
        const row = Math.floor(y / 4)
        const seamX = (x + (row % 2) * 4) % 8 === 0
        const seam = y % 4 === 0 || seamX
        const isRedBrick = textureId === 'bricks'
        pixel = seam
          ? hexToPixel(isRedBrick ? '#d7b29a' : '#454c4f')
          : speckle(x, y, hexToPixel(isRedBrick ? '#9f4938' : '#7b8384'), isRedBrick ? 149 : 151, 0.12)
      } else if (textureId === 'sandstone-side') {
        const band = y === 3 || y === 12 || (y === 8 && x % 3 !== 0)
        pixel = band ? hexToPixel('#a88b4e') : speckle(x, y, hexToPixel('#d4bd78'), 157, 0.11)
      } else if (textureId === 'water') {
        const wave = (y + Math.floor(x / 3)) % 6 === 0
        pixel = wave ? hexToPixel('#68c9df', 165) : hexToPixel('#278fb8', 142)
      } else if (textureId === 'ice') {
        const crack = x === y || x + y === 15 || (x * 3 + y * 7) % 31 === 0
        pixel = crack ? hexToPixel('#d9ffff', 165) : hexToPixel('#91dce8', 118)
      } else if (textureId === 'glass') {
        const frame = x === 0 || y === 0 || x === 15 || y === 15
        const shine = x === y || x === y + 1
        pixel = frame ? hexToPixel('#b9e4e8', 165) : shine ? hexToPixel('#e9ffff', 92) : hexToPixel('#d9f5f3', 35)
      } else if (textureId === 'redstone') {
        const line = x === 3 || x === 12 || y === 3 || y === 12 || (x + y) % 11 === 0
        pixel = line ? hexToPixel('#f04a3e') : speckle(x, y, hexToPixel('#9d2828'), 41, 0.18)
      } else if (textureId === 'bookshelf-side') {
        const shelf = y === 0 || y === 7 || y === 15
        const bookIndex = Math.floor(x / 2)
        const bookColors = ['#9b3f3c', '#355f8a', '#c09236', '#487047']
        pixel = shelf
          ? hexToPixel('#6a4528')
          : hexToPixel(bookColors[(bookIndex + Math.floor(y / 8)) % bookColors.length])
      } else if (textureId === 'crafting-top') {
        const border = x < 2 || y < 2 || x > 13 || y > 13
        const grid = x === 7 || y === 7 || x === 8 || y === 8
        pixel = border ? hexToPixel('#50341f') : grid ? hexToPixel('#76502d') : speckle(x, y, hexToPixel('#b17b42'), 163, 0.1)
      } else if (textureId === 'crafting-side') {
        const toolLine = x === 3 || x === 12 || y === 5 || (x + y) % 13 === 0
        pixel = toolLine ? hexToPixel('#d1b26f') : speckle(x, y, hexToPixel('#745033'), 167, 0.12)
      } else if (textureId === 'furnace-side') {
        const opening = x >= 4 && x <= 11 && y >= 7 && y <= 13
        const rim = (x === 3 || x === 12) && y >= 6 || (y === 6 || y === 14) && x >= 3 && x <= 12
        pixel = opening ? hexToPixel('#23282b') : rim ? hexToPixel('#b3b7b5') : speckle(x, y, hexToPixel('#737a7d'), 173, 0.18)
      } else if (textureId === 'glow-lamp') {
        const frame = x < 2 || y < 2 || x > 13 || y > 13 || x === 7 || y === 7
        pixel = frame ? hexToPixel('#745226') : hexToPixel((x + y) % 3 === 0 ? '#ffe37b' : '#dba93e')
      } else {
        const grid = x === 0 || y === 0 || x === 15 || y === 15 || x === 7 || y === 7
        pixel = grid ? hexToPixel('#52606d') : speckle(x, y, hexToPixel('#94a3b8'), 43, 0.1)
      }
      setPixel(x, y, pixel)
    }
  }
  return pixels
}

const textureCache = new Map<string, DataTexture>()

export const getVoxelPixelTexture = (textureId: string) => {
  const cached = textureCache.get(textureId)
  if (cached) return cached
  const texture = new DataTexture(texturePixels(textureId), textureSize, textureSize, RGBAFormat, UnsignedByteType)
  texture.name = `voxel:${textureId}`
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  textureCache.set(textureId, texture)
  return texture
}

/** BoxGeometry material order: right, left, top, bottom, front, back. */
export const resolveVoxelFaceTextureIds = (visual: VoxelBlockVisual) => {
  const side = visual.textures.side ?? visual.textures.all
  return [
    side,
    side,
    visual.textures.top ?? visual.textures.all,
    visual.textures.bottom ?? visual.textures.all,
    side,
    side,
  ] as const
}

const layerOpacity: Record<VoxelRenderLayer, number> = {
  opaque: 1,
  cutout: 1,
  translucent: 0.72,
  emissive: 1,
}

const materialCache = new Map<string, readonly MeshStandardMaterial[]>()

export const getVoxelVisualKey = (visual: VoxelBlockVisual) => {
  const faceIds = resolveVoxelFaceTextureIds(visual)
  return `${faceIds.join('|')}:${visual.renderLayer}:${visual.emissiveIntensity ?? 0}`
}

export const getVoxelBlockMaterials = (
  visual: VoxelBlockVisual,
  opacityMultiplier = 1,
): readonly MeshStandardMaterial[] => {
  const faceIds = resolveVoxelFaceTextureIds(visual)
  const opacity = Math.max(0, Math.min(1, layerOpacity[visual.renderLayer] * opacityMultiplier))
  const cacheKey = `${getVoxelVisualKey(visual)}:${opacity}`
  const cached = materialCache.get(cacheKey)
  if (cached) return cached
  const transparent = opacity < 1 || visual.renderLayer === 'translucent'
  const materials = faceIds.map((textureId) => {
    const texture = getVoxelPixelTexture(textureId)
    return new MeshStandardMaterial({
      name: `voxel-material:${textureId}`,
      map: texture,
      transparent,
      opacity,
      alphaTest: visual.renderLayer === 'cutout' ? 0.45 : 0,
      depthWrite: !transparent,
      roughness: 0.82,
      metalness: 0,
      emissive: visual.renderLayer === 'emissive' ? new Color('#5f1111') : new Color('#000000'),
      emissiveMap: visual.renderLayer === 'emissive' ? texture : null,
      emissiveIntensity: visual.renderLayer === 'emissive' ? visual.emissiveIntensity ?? 0.15 : 0,
    })
  })
  materialCache.set(cacheKey, materials)
  return materials
}

export const createVoxelPreviewMaterials = (visual: VoxelBlockVisual) => (
  getVoxelBlockMaterials(visual).map((material) => material.clone())
)
