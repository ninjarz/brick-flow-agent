import { describe, expect, it } from 'vitest'
import { importObjToBrickPlan, parseMtlPalette } from './objImport'

const cubeObj = [
  'v 0 0 0', 'v 1 0 0', 'v 1 0 1', 'v 0 0 1',
  'v 0 0.075 0', 'v 1 0.075 0', 'v 1 0.075 1', 'v 0 0.075 1',
  'usemtl body-red',
  'f 1 4 3 2', 'f 5 6 7 8',
  'usemtl accent-blue',
  'f 1 2 6 5',
  'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8',
].join('\n')

const materials = [
  'newmtl body-red',
  'Kd 0.9 0.05 0.04',
  'newmtl accent-blue',
  'Kd 20 60 220',
].join('\n')

describe('OBJ material mapping', () => {
  it('parses normalized and byte-range MTL diffuse colors', () => {
    const palette = parseMtlPalette(materials)
    expect(palette.get('body-red')?.r).toBeCloseTo(229.5)
    expect(palette.get('body-red')?.g).toBeCloseTo(12.75)
    expect(palette.get('body-red')?.b).toBeCloseTo(10.2)
    expect(palette.get('accent-blue')).toEqual({ r: 20, g: 60, b: 220 })
  })

  it('maps material regions to legal brick colors', () => {
    const result = importObjToBrickPlan(cubeObj, {
      title: 'Material cube',
      profileId: 's',
      orientation: 'upright',
      color: 'gray',
      locale: 'en',
      idPrefix: 'material-cube',
      maxBricks: 250,
      colorMode: 'materials',
      materialText: materials,
    })

    expect(result.stats.materialCount).toBe(2)
    expect(result.stats.materialPalette).toEqual(expect.arrayContaining([
      expect.objectContaining({ material: 'body-red', mappedColor: 'red' }),
      expect.objectContaining({ material: 'accent-blue', mappedColor: 'blue' }),
    ]))
    expect(result.plan.bricks.some((brick) => brick.color === 'red')).toBe(true)
    expect(result.plan.bricks.some((brick) => brick.color === 'blue')).toBe(true)
  })
})
