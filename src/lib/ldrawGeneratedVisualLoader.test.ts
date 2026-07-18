import { describe, expect, it } from 'vitest'
import {
  getLoadedLDrawGeneratedVisualTriangles,
  loadLDrawGeneratedVisualTriangles,
} from './ldrawGeneratedVisualLoader'

describe('LDraw generated visual loader', () => {
  it('loads only the chunk needed by the requested part', async () => {
    expect(getLoadedLDrawGeneratedVisualTriangles('11477')).toBeUndefined()
    expect(getLoadedLDrawGeneratedVisualTriangles('92438')).toBeUndefined()

    const triangles = await loadLDrawGeneratedVisualTriangles('11477.dat')

    expect(triangles?.length).toBeGreaterThan(0)
    expect(getLoadedLDrawGeneratedVisualTriangles('11477')).toBe(triangles)
    expect(getLoadedLDrawGeneratedVisualTriangles('92438')).toBeUndefined()
  })

  it('returns undefined without loading a chunk for unknown parts', async () => {
    await expect(loadLDrawGeneratedVisualTriangles('not-a-part.dat')).resolves.toBeUndefined()
  })
})
