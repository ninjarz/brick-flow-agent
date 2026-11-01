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
