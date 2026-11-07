import type { BrickDefinition } from '../types/bricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import { loadPrecomputedStructuralCells } from './ldrawStructuralCache'
import { hasBrickStructuralCells, seedBrickStructuralCells, warmBrickStructuralData } from './structuralGrid'
import { yieldToBrowser } from './yieldToBrowser'

/** Shared by the editor and analysis worker; no GPU buffers in the worker. */
export const prepareStructuralGeometry = async (
  definitions: BrickDefinition[],
  prepareVisual?: (definition: BrickDefinition) => void,
  onProgress?: (fraction: number) => void,
) => {
  const legoDefinitions = definitions.filter(definition => definition.pack === 'lego')
  await loadLDrawGeneratedVisual(legoDefinitions.map(definition => definition.partNumber), fraction => onProgress?.(fraction * .75))
  const pending = legoDefinitions.filter(definition => !hasBrickStructuralCells(definition))
  for (let start = 0; start < pending.length; start += 4) {
    const definitions = pending.slice(start, start + 4)
    const cells = await Promise.all(definitions.map(loadPrecomputedStructuralCells))
    for (let index = 0; index < definitions.length; index++) {
      const definition = definitions[index]
      if (cells[index]) seedBrickStructuralCells(definition, cells[index]!)
      warmBrickStructuralData(definition)
      prepareVisual?.(definition)
      onProgress?.(.75 + .25 * (start + index + 1) / pending.length)
      await yieldToBrowser()
    }
    await yieldToBrowser()
  }
  onProgress?.(1)
}
