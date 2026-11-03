import type { BrickDefinition } from '../types/bricks'
import { seedLDrawLocalBounds } from './ldrawBounds'
import { loadPrecomputedStructuralCells } from './ldrawStructuralCache'
import { seedBrickStructuralCells, warmBrickStructuralData } from './structuralGrid'
import type { EditorAnalysisRequest } from './editorAnalysisProtocol'

/** Exact cached occupancy plus reviewed bounds keep rendering triangles out
 * of the worker. The main thread supplies exact cells for unknown moulds. */
export const prepareAnalysisGeometry = async (definitions: BrickDefinition[], geometry: EditorAnalysisRequest['geometry']) => {
  const supplied = new Map(geometry.map(entry => [entry.brickId, entry]))
  const lego = definitions.filter(definition => definition.pack === 'lego')
  const entries = await Promise.all(lego.map(async definition => ({ definition, cells: await loadPrecomputedStructuralCells(definition) })))
  for (const entry of geometry) {
    if (entry.bounds) seedLDrawLocalBounds(entry.partNumber, entry.bounds)
  }
  for (const { definition, cells } of entries) {
    const exactCells = cells ?? supplied.get(definition.id)?.cells
    if (!exactCells) throw new Error('EDITOR_ANALYSIS_GEOMETRY_MISSING')
    seedBrickStructuralCells(definition, exactCells)
    warmBrickStructuralData(definition)
  }
}
