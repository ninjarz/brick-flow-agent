import { beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { brickDefinitions } from '../data/basicBricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import {
  getBrickInteractionStructuralCells,
  getBrickRenderStructuralCells,
  getBrickStructuralCells,
  structuralCellBlocksCollision,
  STRUCTURAL_VOXEL_SIZE,
  type StructuralCell,
} from './structuralGrid'

const expandedVoxelKeys = (cells: StructuralCell[]) => {
  const keys = new Set<string>()
  for (const cell of cells) {
    for (let x = Math.round(cell.minX / STRUCTURAL_VOXEL_SIZE); x < Math.round(cell.maxX / STRUCTURAL_VOXEL_SIZE); x += 1) {
      for (let y = Math.round(cell.minY / STRUCTURAL_VOXEL_SIZE); y < Math.round(cell.maxY / STRUCTURAL_VOXEL_SIZE); y += 1) {
        for (let z = Math.round(cell.minZ / STRUCTURAL_VOXEL_SIZE); z < Math.round(cell.maxZ / STRUCTURAL_VOXEL_SIZE); z += 1) keys.add(`${x},${y},${z}`)
      }
    }
  }
  return keys
}

describe('structural voxel audit', () => {
  beforeAll(async () => {
    await loadLDrawGeneratedVisual()
  })

  it('preserves every reviewed non-rectangular part shape', () => {
    const reviewedShapes = brickDefinitions.flatMap((definition) => {
      const detailedCollisionCells = getBrickStructuralCells(definition)
        .filter(structuralCellBlocksCollision)
      const compactCollisionCells = getBrickInteractionStructuralCells(definition)
      const occupied = expandedVoxelKeys(detailedCollisionCells)
      const compactOccupied = expandedVoxelKeys(compactCollisionCells)
      expect(compactOccupied, `${definition.partNumber} compaction changed occupied voxels`)
        .toEqual(occupied)

      const fingerprint = createHash('sha256')
        .update([...occupied].sort().join('|'))
        .digest('hex')
        .slice(0, 12)
      const compactSolidBoxCount = compactCollisionCells
        .filter((cell) => cell.kind === 'solid').length
      const renderedEnterableCells = getBrickRenderStructuralCells(definition)
        .filter((cell) => cell.kind === 'enterable')
      expect(
        renderedEnterableCells.every((cell) => (cell.entersFrom?.length ?? 0) < 6),
        `${definition.partNumber} rendered its generic empty bounding volume`,
      ).toBe(true)

      if (compactSolidBoxCount <= 1) return []

      return [{
        id: definition.id,
        partNumber: definition.partNumber,
        occupiedVoxelCount: occupied.size,
        fingerprint,
        compactSolidBoxCount,
      }]
    })

    expect(reviewedShapes).toMatchSnapshot()
  }, 60_000)
})
