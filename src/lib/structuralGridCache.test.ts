import { describe, expect, it } from 'vitest'
import { brickById } from '../data/basicBricks'
import { loadLDrawGeneratedVisualTriangles } from './ldrawGeneratedVisualLoader'
import { getBrickStructuralCells } from './structuralGrid'

describe('structural grid cache invalidation', () => {
  it('invalidates only definitions contained in a newly loaded visual chunk', async () => {
    const loadedDefinition = brickById.get('slope-curved-2x1-low')!
    const unrelatedDefinition = brickById.get('brick-separator')!
    const initialLoadedCells = getBrickStructuralCells(loadedDefinition)
    const initialUnrelatedCells = getBrickStructuralCells(unrelatedDefinition)

    await loadLDrawGeneratedVisualTriangles(loadedDefinition.partNumber)

    expect(getBrickStructuralCells(loadedDefinition)).not.toBe(initialLoadedCells)
    expect(getBrickStructuralCells(unrelatedDefinition)).toBe(initialUnrelatedCells)
  })
})
