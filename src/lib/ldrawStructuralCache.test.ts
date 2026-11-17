import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { brickDefinitions } from '../data/basicBricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import { getBrickStructuralCells } from './structuralGrid'
import { loadPrecomputedStructuralCells } from './ldrawStructuralCache'
import { structuralCacheRevision } from './ldrawStructuralCacheManifest'
import { getLoadedLDrawGeneratedVisualValues } from './ldrawVisualRegistry'
import { getBrickWorldBounds } from './ldrawBounds'
import { getRigidBrickMatrix } from './rigidBrickTransform'
import type { BrickPose } from '../types/bricks'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

describe('offline structural sampling cache', () => {
  beforeAll(async () => { await loadLDrawGeneratedVisual() }, 60_000)

  it('matches every original sampler cell and metadata without changing collision or support', async () => {
    const definitions = brickDefinitions.filter(definition => definition.pack === 'lego')
    for (const definition of definitions) {
      const expected = digest(getBrickStructuralCells(definition))
      const cached = await loadPrecomputedStructuralCells(definition)
      expect(cached, definition.id).toBeDefined()
      expect(digest(cached), definition.id).toBe(expected)
    }
  }, 120_000)

  it('invalidates entries when the footprint, connectors or mould class changes', async () => {
    const definition = brickDefinitions.find(definition => definition.pack === 'lego' && definition.connectors.length > 0)!
    expect(await loadPrecomputedStructuralCells({ ...definition, footprint: { ...definition.footprint, widthStuds: definition.footprint.widthStuds + 1 } })).toBeUndefined()
    expect(await loadPrecomputedStructuralCells({ ...definition, connectors: [] })).toBeUndefined()
    expect(await loadPrecomputedStructuralCells({ ...definition, kind: 'cone' })).toBeUndefined()
  })

  it('retains tight contact extrema from every original mould after oblique rotations and reflection', async () => {
    for (const definition of brickDefinitions.filter(definition => definition.pack === 'lego')) {
      await loadPrecomputedStructuralCells(definition)
      const values = getLoadedLDrawGeneratedVisualValues(definition.partNumber)
      expect(values?.length, definition.id).toBeGreaterThan(0)
      for (const handedness of [1,-1]) {
        const pose: BrickPose = { xStud: 7.123456789, yStud: 13.987654321, zStud: -9.123456789, rotationQuarterTurns: 1,
          verticalQuarterTurns: 3, rollQuarterTurns: 2,
          orientationMatrix: [.36,-.48,.8, .8,.6,0, -.48 * handedness,.64 * handedness,.6 * handedness] }
        const matrix = getRigidBrickMatrix(definition, pose).elements
        const { widthStuds, heightStuds, depthStuds } = definition.footprint
        const expected = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }
        for (let i = 0; i < values!.length; i += 3) {
          const x = values![i] - widthStuds / 2, y = values![i + 1] - heightStuds / 2, z = values![i + 2] - depthStuds / 2
          const a = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]
          const b = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]
          const c = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]
          expected.minX = Math.min(expected.minX, a); expected.maxX = Math.max(expected.maxX, a)
          expected.minY = Math.min(expected.minY, b); expected.maxY = Math.max(expected.maxY, b)
          expected.minZ = Math.min(expected.minZ, c); expected.maxZ = Math.max(expected.maxZ, c)
        }
        const actual = getBrickWorldBounds(definition, pose)
        for (const axis of Object.keys(expected) as (keyof typeof expected)[]) expect(actual[axis], `${definition.id} ${axis}`).toBeCloseTo(expected[axis], 9)
      }
    }
  }, 120_000)

  it('tracks the current sampler and generated geometry revision', async () => {
    const revisionModule = await import(/* @vite-ignore */ '../../scripts/ldraw-cache-revision.mjs')
    expect(await revisionModule.getStructuralSourceRevision(process.cwd())).toBe(structuralCacheRevision)
  })
})
