import { describe, expect, it } from 'vitest'
import { createSculptureLayers } from './llmSculpture'
import { expandAssemblyProgram } from './llmAssembly'
import { createSingleBrickSteps, validateBuildPlan } from './planUtils'

const sculpture = {
  kind: 'sculpture-shapes', at: [0, 0, 0], size: [18, 22, 14],
  solids: [
    { name: 'body', shape: 'ellipsoid', center: [9, 7, 7], size: [11, 10, 10], color: 'blue' },
    { name: 'head', shape: 'ellipsoid', center: [9, 15, 7], size: [16, 13, 12], color: 'blue' },
    { name: 'feet', shape: 'box', center: [9, 1, 9], size: [12, 2, 8], color: 'white' },
  ],
  features: [
    { name: 'face', on: 'head', shape: 'ellipse', center: [9, 15], size: [12, 10], color: 'white' },
    { name: 'left pupil', on: 'head', shape: 'ellipse', center: [6.5, 18], size: [1.3, 1.3], color: 'black' },
    { name: 'right pupil', on: 'head', shape: 'ellipse', center: [11.5, 18], size: [1.3, 1.3], color: 'black' },
    { name: 'nose', on: 'head', shape: 'ellipse', center: [9, 16], size: [2, 2], color: 'red' },
  ],
}

describe('parametric sculpture', () => {
  it('preserves three-dimensional rounded solids and exterior facial markings', () => {
    const layers = createSculptureLayers(sculpture)
    expect(layers.layerHeight).toBe(0.4)
    expect(layers.layers).toHaveLength(55)
    const black = Object.entries(layers.palette).find(([, color]) => color === 'black')![0]
    expect(layers.layers.some(layer => layer.rows.some(row => row.includes(black)))).toBe(true)
    const bricks = expandAssemblyProgram({ commands: [sculpture] }, [0, 0, 0])
    expect(bricks.length).toBeGreaterThan(512)
    const issues = validateBuildPlan({ id: 'figure', title: '', prompt: '', source: 'llm', bricks, steps: createSingleBrickSteps(bricks) })
    expect(issues).toEqual([])
  })

  it('rejects missing or overpainted surface features', () => {
    expect(() => createSculptureLayers({ ...sculpture, features: [
      { ...sculpture.features[1], center: [0, 0] },
    ] })).toThrow('left pupil')
    expect(() => createSculptureLayers({ ...sculpture, features: [...sculpture.features, sculpture.features[0]] })).toThrow('unique')
    expect(() => createSculptureLayers({ ...sculpture, features: [sculpture.features[1], sculpture.features[0]] })).toThrow('left pupil')
  })

  it('quantizes thin markings without mutating the model program', () => {
    const input = { ...sculpture, features: [{ name: 'thin line', on: 'head', shape: 'rectangle', center: [8, 14], size: [0.6, 2], color: 'black' }] }
    const original = JSON.stringify(input)
    expect(() => createSculptureLayers(input)).not.toThrow()
    expect(JSON.stringify(input)).toBe(original)
    expect(() => createSculptureLayers({ ...sculpture, size: [8, 8, 8] })).toThrow('bounds')
  })
})
