import { prepareLDrawPickingGeometry } from './ldrawPrintBatches'
import { prepareStructuralGeometry } from './prepareStructuralGeometry'
import { brickById } from '../data/basicBricks'
import type { BrickDefinition, BuildPlan } from '../types/bricks'
import { createLoadedLDrawBodyGeometry, createLoadedLDrawPartGeometry, createLDrawPrintGeometries } from './ldrawVisualGeometry'
import { getLDrawEdgePoints } from './ldrawEdgePoints'

export const prepareBrickDefinitionsGeometry = (definitions: BrickDefinition[], onProgress?: (fraction: number) => void) => prepareStructuralGeometry(definitions, definition => {
  createLoadedLDrawPartGeometry(definition.partNumber, definition.footprint)
  const body = createLoadedLDrawBodyGeometry(definition.partNumber, definition.footprint)
  for (const layer of createLDrawPrintGeometries(definition.partNumber, definition.footprint)) prepareLDrawPickingGeometry(layer.geometry)
  if (body) { getLDrawEdgePoints(body); prepareLDrawPickingGeometry(body) }
}, onProgress)

// Load identical visuals, then reuse offline sampler output. New/custom/changed
// definitions retain the original precise sampler as their fallback.
export const preparePlanGeometry = (plan: BuildPlan) => prepareBrickDefinitionsGeometry(
  [...new Set(plan.bricks.map(brick => brick.brickId))]
    .map(id => brickById.get(id))
    .filter((definition): definition is BrickDefinition => Boolean(definition)),
)
