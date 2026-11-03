import type { BrickDefinition } from '../types/bricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import { loadPrecomputedStructuralCells } from './ldrawStructuralCache'
import { hasBrickStructuralCells, seedBrickStructuralCells, warmBrickStructuralData } from './structuralGrid'
import { yieldToBrowser } from './yieldToBrowser'

/** Shared by the editor and analysis worker; no GPU buffers in the worker. */
export const prepareStructuralGeometry = async (
  definitions: BrickDefinition[],
  prepareVisual?: (definition: BrickDefinition) => void,
) => {
  const legoDefinitions = definitions.filter(definition => definition.pack === 'lego')
  await loadLDrawGeneratedVisual(legoDefinitions.map(definition => definition.partNumber))
  const pending = legoDefinitions.filter(definition => !hasBrickStructuralCells(definition))
  for (let start = 0; start < pending.length; start += 4) {
    await Promise.all(pending.slice(start, start + 4).map(async definition => {
      const cells = await loadPrecomputedStructuralCells(definition)
      if (cells) seedBrickStructuralCells(definition, cells)
      warmBrickStructuralData(definition)
      prepareVisual?.(definition)
    }))
    await yieldToBrowser()
  }
}
