import { beforeEach, describe, expect, it, vi } from 'vitest'
import { brickById } from '../data/basicBricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import { loadPrecomputedStructuralCells } from './ldrawStructuralCache'
import { seedBrickStructuralCells } from './structuralGrid'
import { prepareStructuralGeometry } from './prepareStructuralGeometry'

vi.mock('./ldrawGeneratedVisualLoader', () => ({ loadLDrawGeneratedVisual: vi.fn(async () => {}) }))
vi.mock('./ldrawStructuralCache', () => ({ loadPrecomputedStructuralCells: vi.fn(async () => []) }))
vi.mock('./structuralGrid', () => ({ hasBrickStructuralCells: vi.fn(() => false), seedBrickStructuralCells: vi.fn() }))

const definitions = [brickById.get('brick-1x1')!, brickById.get('brick-2x4')!]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadPrecomputedStructuralCells).mockResolvedValue([])
})

describe('analysis-only geometry preparation', () => {
  it('uses verified structural data without loading render meshes', async () => {
    await prepareStructuralGeometry(definitions)
    expect(loadLDrawGeneratedVisual).not.toHaveBeenCalled()
    expect(seedBrickStructuralCells).toHaveBeenCalledTimes(2)
  })

  it('loads the original mould only for missing or invalid cache entries', async () => {
    vi.mocked(loadPrecomputedStructuralCells).mockImplementation(async definition => definition.id === definitions[0].id ? [] : undefined)
    await prepareStructuralGeometry(definitions)
    expect(loadLDrawGeneratedVisual).toHaveBeenCalledExactlyOnceWith([definitions[1].partNumber], expect.any(Function))
    expect(seedBrickStructuralCells).toHaveBeenCalledExactlyOnceWith(definitions[0], [])
  })

  it('retains eager rendering preparation for callers that request visual resources', async () => {
    const prepareVisual = vi.fn()
    await prepareStructuralGeometry(definitions, prepareVisual)
    expect(loadLDrawGeneratedVisual).toHaveBeenCalledExactlyOnceWith(definitions.map(definition => definition.partNumber), expect.any(Function))
    expect(prepareVisual.mock.calls.map(([definition]) => definition)).toEqual(definitions)
  })
})
