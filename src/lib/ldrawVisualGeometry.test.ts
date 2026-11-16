import { BufferGeometry, Float32BufferAttribute } from 'three'
import { getLoadedLDrawGeneratedVisualTriangles } from './ldrawGeneratedVisualLoader'
import { getLoadedLDrawLocalBounds, getTriangleBounds } from './ldrawBounds'
import { registerLDrawVisualChunk } from './ldrawVisualRegistry'
import { beforeAll, describe, expect, it } from 'vitest'
import { brickById } from '../data/basicBricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import { createLoadedLDrawBodyGeometry, createLoadedLDrawPartGeometry, createLDrawPrintGeometries } from './ldrawVisualGeometry'

const definition = (part: string) => [...brickById.values()].find(def => def.partNumber === part)!

describe('fixed LDraw colors and transparent molded material', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual(['93549pat0002', '59349pbf71043s37', '3005', '3068bpbf71043s60', '3626cpbf71043e6240418']) })

  it('preserves the separate clear neck and purple fluid alpha values', () => {
    const def = definition('93549pat0002')
    const layers = createLDrawPrintGeometries(def.partNumber, def.footprint)
    expect(layers.map(layer => layer.color)).toEqual(expect.arrayContaining(['#FCFCFC', '#A5A5CB']))
    expect(layers).toHaveLength(2)
    expect(layers.every(layer => layer.opacity === 128 / 255)).toBe(true)
  })

  it('renders fully colored material once while retaining the full glyph geometry', () => {
    const def = definition('93549pat0002')
    const full = createLoadedLDrawPartGeometry(def.partNumber, def.footprint)!
    const body = createLoadedLDrawBodyGeometry(def.partNumber, def.footprint)!
    const layers = createLDrawPrintGeometries(def.partNumber, def.footprint)
    expect(full.getAttribute('position').count).toBeGreaterThan(0)
    expect(body.getAttribute('position').count).toBe(0)
    expect(layers.reduce((sum, layer) => sum + layer.geometry.getAttribute('position').count, 0)).toBe(full.getAttribute('position').count)
    expect(createLoadedLDrawPartGeometry(def.partNumber, def.footprint)).toBe(full)
  })

  it('keeps sticker ink opaque and preserves the blank structural wall', () => {
    const def = definition('59349pbf71043s37')
    const full = createLoadedLDrawPartGeometry(def.partNumber, def.footprint)!
    const body = createLoadedLDrawBodyGeometry(def.partNumber, def.footprint)!
    const layers = createLDrawPrintGeometries(def.partNumber, def.footprint)
    expect(layers.length).toBeGreaterThan(0)
    expect(layers.every(layer => layer.opacity === 1)).toBe(true)
    expect(body.getAttribute('position').count).toBeGreaterThan(0)
    expect(body.getAttribute('position').count + layers.reduce((sum, layer) => sum + layer.geometry.getAttribute('position').count, 0)).toBe(full.getAttribute('position').count)
  })

  it('reuses ordinary brick geometry without removing structural faces', () => {
    const def = definition('3005')
    expect(createLoadedLDrawBodyGeometry(def.partNumber, def.footprint)).toBe(createLoadedLDrawPartGeometry(def.partNumber, def.footprint))
  })
})


describe('large printed replica parts', () => {
  it.each(['3068bpbf71043s60', '3626cpbf71043e6240418'])('loads %s ink with its geometry and renders each triangle once', async part => {
    await loadLDrawGeneratedVisual([part])
    const def=definition(part)
    const full=createLoadedLDrawPartGeometry(part,def.footprint)!
    const body=createLoadedLDrawBodyGeometry(part,def.footprint)!
    const ink=createLDrawPrintGeometries(part,def.footprint)
    expect(ink.length).toBeGreaterThan(0)
    expect(body.getAttribute('position').count).toBeGreaterThan(0)
    expect(body.getAttribute('position').count+ink.reduce((sum,l)=>sum+l.geometry.getAttribute('position').count,0)).toBe(full.getAttribute('position').count)
  })
})

it.each(['3005', '59349pbf71043s37', '3068bpbf71043s60'])('packed rendering preserves the legacy positions, normals and bounds for %s', async part => {
  await loadLDrawGeneratedVisual([part])
  const def = definition(part)
  const triangles = getLoadedLDrawGeneratedVisualTriangles(part)!
  const values = new Float32Array(triangles.length * 9)
  let offset = 0
  for (const triangle of triangles) for (const point of triangle) {
    values[offset++] = point.x - def.footprint.widthStuds / 2
    values[offset++] = point.y - def.footprint.heightStuds / 2
    values[offset++] = point.z - def.footprint.depthStuds / 2
  }
  const reference = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(values, 3))
  reference.computeVertexNormals()
  const packed = createLoadedLDrawPartGeometry(part, def.footprint)!
  expect(packed.getAttribute('position').array).toEqual(reference.getAttribute('position').array)
  expect(packed.getAttribute('normal').array).toEqual(reference.getAttribute('normal').array)
  expect(getLoadedLDrawLocalBounds(part)).toEqual(getTriangleBounds(triangles))
  reference.dispose()
})

it('keeps legacy chunks without packed coordinates usable', () => {
  const part = 'legacy-geometry-unit'
  registerLDrawVisualChunk([part], { getLDrawGeneratedVisualTriangles: () => [[{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }]], getLDrawGeneratedPrintLayers: () => [] })
  const geometry = createLoadedLDrawPartGeometry(part, { widthStuds: 1, depthStuds: 1, heightStuds: 1 })!
  expect(geometry.getAttribute('position').count).toBe(3)
  expect(Array.from(geometry.getAttribute('position').array)).toEqual([-.5, -.5, -.5, .5, -.5, -.5, -.5, .5, -.5])
})
