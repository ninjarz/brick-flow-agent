import { beforeAll, describe, expect, it } from 'vitest'
import { brickById } from '../data/basicBricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import {
  getBrickInteractionStructuralCells,
  getBrickRenderStructuralCells,
  getBrickStructuralCells,
  structuralCellBlocksCollision,
  STRUCTURAL_VOXEL_SIZE,
  type StructuralCell,
} from './structuralGrid'
import {
  createBrickCollisionIndex,
  getBrickRawOverlapScore,
  hasBrickCollision,
  makeBrick,
} from './planUtils'

describe('structural collision index', () => {
  beforeAll(async () => {
    await loadLDrawGeneratedVisual()
  })

  it('keeps ordinary rectangular parts on a stable nominal collision body', () => {
    const definition = brickById.get('brick-2x4')
    expect(definition).toBeDefined()

    const collisionCells = getBrickInteractionStructuralCells(definition!)
    expect(collisionCells).toHaveLength(1)
    expect(collisionCells[0]).toMatchObject({
      kind: 'solid',
      minX: 0,
      maxX: 4,
      minY: 0,
      maxY: 1.2,
      minZ: 0,
      maxZ: 2,
    })

    const renderCells = getBrickRenderStructuralCells(definition!)
    const renderSolidCells = renderCells.filter((cell) => cell.kind === 'solid')
    expect(renderSolidCells.length).toBeGreaterThan(1)
    expect(renderSolidCells.every((cell) =>
      cell.maxX - cell.minX <= STRUCTURAL_VOXEL_SIZE + 0.000001 &&
      cell.maxY - cell.minY <= STRUCTURAL_VOXEL_SIZE + 0.000001 &&
      cell.maxZ - cell.minZ <= STRUCTURAL_VOXEL_SIZE + 0.000001
    )).toBe(true)
  })

  it('builds 3747 as a stable inverted-slope profile instead of an internal LDraw shell', () => {
    const definition = brickById.get('inverted-slope-3x2')
    expect(definition).toBeDefined()

    const cells = getBrickStructuralCells(definition!)
    const solidCells = cells.filter((cell) => cell.kind === 'solid')
    const centerSliceSolidKeys = new Set(solidCells
      .filter((cell) => Math.abs(cell.minZ - 0.8) < 0.000001)
      .map((cell) => `${Math.round(cell.minX / STRUCTURAL_VOXEL_SIZE)},${Math.round(cell.minY / STRUCTURAL_VOXEL_SIZE)}`))
    const expectedRowStartByY = [8, 6, 4, 2, 0, 0]
    const expectedCenterSliceKeys = new Set<string>()
    expectedRowStartByY.forEach((startX, y) => {
      for (let x = startX; x < 15; x += 1) expectedCenterSliceKeys.add(`${x},${y}`)
    })
    expect(centerSliceSolidKeys).toEqual(expectedCenterSliceKeys)

    const renderedEnterableCells = getBrickRenderStructuralCells(definition!)
      .filter((cell) => cell.kind === 'enterable')
    expect(renderedEnterableCells).toHaveLength(16)
    expect(renderedEnterableCells.every((cell) => cell.entersFrom?.length === 1)).toBe(true)
    expect(cells.filter((cell) => cell.kind === 'enterable').length)
      .toBeGreaterThan(renderedEnterableCells.length)
  }, 20_000)

  it('compacts complex collision cells without changing their occupied voxels', () => {
    const complexDefinitionIds = [
      'inverted-slope-3x2',
      'slope-curved-3x2',
      'slope-curved-2x1-low',
      'propeller-4-blade-open',
      'propeller-4-blade-closed',
    ]

    for (const definitionId of complexDefinitionIds) {
      const definition = brickById.get(definitionId)
      expect(definition, definitionId).toBeDefined()
      const detailedCells = getBrickStructuralCells(definition!).filter(structuralCellBlocksCollision)
      const compactCells = getBrickInteractionStructuralCells(definition!)
      expect(expandOccupiedVoxelKeys(compactCells), definitionId)
        .toEqual(expandOccupiedVoxelKeys(detailedCells))
    }
  }, 30_000)

  it('uses a coarse broad phase while preserving exact overlap scores', () => {
    const fixed = makeBrick('brick-2x4', 'gray', 0, 0, 0)
    const index = createBrickCollisionIndex([fixed])
    const fullOverlap = makeBrick('brick-1x1', 'gray', 0, 0, 0)
    const edgeOverlap = makeBrick('brick-1x1', 'gray', 3.8, 0, 0)
    const touching = makeBrick('brick-1x1', 'gray', 4, 0, 0)

    expect(index.brickKeys.get(fixed.id)!.size).toBeLessThan(30)
    expect(hasBrickCollision(fullOverlap, [fixed], index)).toBe(true)
    expect(hasBrickCollision(edgeOverlap, [fixed], index)).toBe(true)
    expect(hasBrickCollision(touching, [fixed], index)).toBe(false)

    const fullScore = getBrickRawOverlapScore(fullOverlap, [fixed], index)
    const edgeScore = getBrickRawOverlapScore(edgeOverlap, [fixed], index)
    expect(fullScore).toBeGreaterThan(edgeScore)
    expect(edgeScore).toBeGreaterThan(0)
    expect(getBrickRawOverlapScore(touching, [fixed], index)).toBe(0)
  })

  it('indexes overlapping parts correctly in negative world coordinates', () => {
    const fixed = makeBrick('brick-2x2', 'gray', -2, 0, -2)
    const overlap = makeBrick('brick-1x1', 'gray', -1.2, 0, -1.2)
    const index = createBrickCollisionIndex([fixed])

    expect(hasBrickCollision(overlap, [fixed], index)).toBe(true)
  })
})

const expandOccupiedVoxelKeys = (cells: StructuralCell[]) => {
  const keys = new Set<string>()

  for (const cell of cells) {
    const minX = Math.round(cell.minX / STRUCTURAL_VOXEL_SIZE)
    const maxX = Math.round(cell.maxX / STRUCTURAL_VOXEL_SIZE)
    const minY = Math.round(cell.minY / STRUCTURAL_VOXEL_SIZE)
    const maxY = Math.round(cell.maxY / STRUCTURAL_VOXEL_SIZE)
    const minZ = Math.round(cell.minZ / STRUCTURAL_VOXEL_SIZE)
    const maxZ = Math.round(cell.maxZ / STRUCTURAL_VOXEL_SIZE)

    for (let x = minX; x < maxX; x += 1) {
      for (let y = minY; y < maxY; y += 1) {
        for (let z = minZ; z < maxZ; z += 1) keys.add(`${x},${y},${z}`)
      }
    }
  }

  return [...keys].sort()
}
