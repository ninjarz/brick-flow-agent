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
      if (textureId === 'grass-top') {
        pixel = speckle(x, y, hexToPixel('#4f8b38'), 11, 0.28)
        if ((x * 3 + y * 5) % 17 === 0) pixel = hexToPixel('#83ad42')
      } else if (textureId === 'grass-side') {
        const grassDepth = 3 + Math.floor(stableNoise(x, 0, 13) * 3)
        pixel = y < grassDepth
          ? speckle(x, y, hexToPixel('#528b38'), 17, 0.2)
          : speckle(x, y, hexToPixel('#765037'), 19, 0.2)
      } else if (textureId === 'dirt') {
        pixel = speckle(x, y, hexToPixel('#79543b'), 23, 0.28)
      } else if (textureId === 'stone') {
        pixel = speckle(x, y, hexToPixel('#7b8185'), 29, 0.2)
        if ((x + y * 3) % 19 === 0) pixel = hexToPixel('#a0a4a6')
      } else if (textureId === 'oak-planks') {
        const seam = y % 5 === 0
        const stagger = (Math.floor(y / 5) % 2) * 8
        const verticalSeam = (x + stagger) % 16 === 0
        pixel = seam || verticalSeam
          ? hexToPixel('#76502f')
          : speckle(x, y, hexToPixel('#bd8d52'), 31, 0.12)
      } else if (textureId === 'sand') {
        pixel = speckle(x, y, hexToPixel('#d8c27a'), 37, 0.18)
      } else if (textureId === 'water') {
        const wave = (y + Math.floor(x / 3)) % 6 === 0
        pixel = wave ? hexToPixel('#68c9df', 165) : hexToPixel('#278fb8', 142)
      } else if (textureId === 'glass') {
        const frame = x === 0 || y === 0 || x === 15 || y === 15
        const shine = x === y || x === y + 1
        pixel = frame ? hexToPixel('#b9e4e8', 165) : shine ? hexToPixel('#e9ffff', 92) : hexToPixel('#d9f5f3', 35)
      } else if (textureId === 'redstone') {
        const line = x === 3 || x === 12 || y === 3 || y === 12 || (x + y) % 11 === 0
        pixel = line ? hexToPixel('#f04a3e') : speckle(x, y, hexToPixel('#9d2828'), 41, 0.18)
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

export const getVoxelBlockMaterials = (
  visual: VoxelBlockVisual,
  opacityMultiplier = 1,
): readonly MeshStandardMaterial[] => {
  const faceIds = resolveVoxelFaceTextureIds(visual)
  const opacity = Math.max(0, Math.min(1, layerOpacity[visual.renderLayer] * opacityMultiplier))
  const cacheKey = `${faceIds.join('|')}:${visual.renderLayer}:${visual.emissiveIntensity ?? 0}:${opacity}`
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
