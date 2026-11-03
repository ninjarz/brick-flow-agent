import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { brickDefinitions } from '../data/basicBricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import { getBrickStructuralCells } from './structuralGrid'
import { loadPrecomputedStructuralCells } from './ldrawStructuralCache'
import { structuralCacheRevision } from './ldrawStructuralCacheManifest'

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

  it('tracks the current sampler and generated geometry revision', async () => {
    const revisionModule = await import(/* @vite-ignore */ '../../scripts/ldraw-cache-revision.mjs')
    expect(await revisionModule.getStructuralSourceRevision(process.cwd())).toBe(structuralCacheRevision)
  })
})
