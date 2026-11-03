import type { BrickDefinition } from '../types/bricks'

// Include every definition field used by the structural sampler. Inventory and
// display colours do not affect occupancy, while connector or mould edits do.
export const getStructuralDefinitionSignature = (definition: BrickDefinition) => JSON.stringify([
  definition.id, definition.partNumber, definition.kind, definition.footprint,
  definition.connectors, definition.voxelVisual,
])
