import type { BrickDefinition } from '../types/bricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import { loadPrecomputedStructuralCells } from './ldrawStructuralCache'
import { hasBrickStructuralCells, seedBrickStructuralCells } from './structuralGrid'
import { yieldToBrowser } from './yieldToBrowser'

/** Shared by the editor and analysis worker; no GPU buffers in the worker. */
export const prepareStructuralGeometry = async (
  definitions: BrickDefinition[],
  prepareVisual?: (definition: BrickDefinition) => void,
  onProgress?: (fraction: number) => void,
) => {
  const legoDefinitions = definitions.filter(definition => definition.pack === 'lego')
  const pending = legoDefinitions.filter(definition => !hasBrickStructuralCells(definition))
  const cached = await Promise.all(pending.map(loadPrecomputedStructuralCells))
  const missing = pending.filter((_, index) => !cached[index])
  const visuals = prepareVisual ? legoDefinitions : missing
  if (visuals.length) await loadLDrawGeneratedVisual(visuals.map(definition => definition.partNumber), fraction => onProgress?.(fraction * .75))
  let sliceStart = performance.now()
  for (let start = 0; start < pending.length; start += 4) {
    const definitions = pending.slice(start, start + 4)
    const cells = cached.slice(start, start + 4)
    for (let index = 0; index < definitions.length; index++) {
      const definition = definitions[index]
      if (cells[index]) seedBrickStructuralCells(definition, cells[index]!)
      prepareVisual?.(definition)
      onProgress?.(.75 + .25 * (start + index + 1) / pending.length)
      if (performance.now() - sliceStart >= 8) { await yieldToBrowser(); sliceStart = performance.now() }
    }
  }
  onProgress?.(1)
}
