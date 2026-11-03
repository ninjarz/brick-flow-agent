import { getVerticalCellContactDistance, type CellBounds } from './orientedCellBounds'
import type { BrickBounds } from './ldrawBounds'
import { getBrickWorldCollisionBounds, getBrickWorldCollisionCellBoxes, getSourceCollisionEnvelope, getStructuralCacheVersion } from './structuralGrid'
import type { PlacedBrick } from '../types/bricks'
import type { StationaryPlanSpatialData } from './brickGroupPlacement'

const cellSize = 4
const tolerance = 1e-6
type Entry = { brick: PlacedBrick; bounds: BrickBounds }
const indices = new WeakMap<StationaryPlanSpatialData['spatialState'], { version: number; index: Map<string, Entry[]> }>()
const keysFor = (bounds: BrickBounds) => {
  const keys: string[] = []
  for (let x = Math.floor(bounds.minX / cellSize); x <= Math.floor(bounds.maxX / cellSize); x++) {
    for (let z = Math.floor(bounds.minZ / cellSize); z <= Math.floor(bounds.maxZ / cellSize); z++) keys.push(`${x},${z}`)
  }
  return keys
}

const clippedCells = new WeakMap<PlacedBrick, { version: number; cells: BrickBounds[] }>()
const getEnvelopeFilteredCells = (brick: PlacedBrick) => {
  const cached = clippedCells.get(brick)
  if (cached?.version === getStructuralCacheVersion()) return cached.cells
  const cells = getBrickWorldCollisionCellBoxes(brick)
  const envelopes = getSourceCollisionEnvelope(brick)
  if (!envelopes) return cells
  const filtered: BrickBounds[] = []
  for (const a of cells) for (const b of envelopes) {
    const bounds = { minX: Math.max(a.minX,b.minX), maxX: Math.min(a.maxX,b.maxX),
      minY: Math.max(a.minY,b.minY), maxY: Math.min(a.maxY,b.maxY), minZ: Math.max(a.minZ,b.minZ), maxZ: Math.min(a.maxZ,b.maxZ) }
    if (bounds.minX < bounds.maxX && bounds.minY < bounds.maxY && bounds.minZ < bounds.maxZ) filtered.push(bounds)
  }
  clippedCells.set(brick, { version: getStructuralCacheVersion(), cells: filtered })
  return filtered
}

const firstPossibleContact = (source: CellBounds[], target: CellBounds[]) => {
  let distance = Infinity
  for (const a of source) for (const b of target) {
    distance = Math.min(distance, getVerticalCellContactDistance(a,b,tolerance))
    if (distance === 0) return 0
  }
  return distance
}

/** Distance that is provably empty for every member of a rigid falling group.
 * The X/Z envelope is conservative; only the old exact narrow phase can stop
 * the fall. This skips empty grid steps, never an obstacle or an enclosed gap.
 */
export const getGuaranteedClearDropDistance = (
  bricks: PlacedBrick[],
  groundDistance: number,
  stationary: Pick<StationaryPlanSpatialData, 'stationaryBricks' | 'spatialState'>,
) => {
  const cachedIndex = indices.get(stationary.spatialState)
  let index = cachedIndex?.version === getStructuralCacheVersion() ? cachedIndex.index : undefined
  if (!index) {
    index = new Map()
    for (const brick of stationary.stationaryBricks) {
      const bounds = getBrickWorldCollisionBounds(brick)
      if (!bounds) continue
      for (const key of keysFor(bounds)) {
        const entries = index.get(key) ?? []; entries.push({ brick, bounds }); index.set(key, entries)
      }
    }
    indices.set(stationary.spatialState, { version: getStructuralCacheVersion(), index })
  }
  let distance = groundDistance
  for (const brick of bricks) {
    // Pose clamping must never compress the layers of the rigid assembly.
    distance = Math.min(distance, brick.pose.yStud)
    const source = getBrickWorldCollisionBounds(brick)
    if (!source) return 0
    const seen = new Set<PlacedBrick>()
    for (const key of keysFor(source)) for (const entry of index.get(key) ?? []) {
      if (seen.has(entry.brick)) continue
      seen.add(entry.brick)
      const target = entry.bounds
      if (source.minX >= target.maxX - tolerance || source.maxX <= target.minX + tolerance ||
          source.minZ >= target.maxZ - tolerance || source.maxZ <= target.minZ + tolerance) continue
      if (source.minY - target.maxY >= distance) continue
      // Refine only potentially earlier contacts. Hollow or curved moulds can
      // have large empty regions inside the whole-part envelope.
      const sourceEnvelopes = getSourceCollisionEnvelope(brick), targetEnvelopes = getSourceCollisionEnvelope(entry.brick)
      const fromEnvelopes = sourceEnvelopes && targetEnvelopes ? firstPossibleContact(sourceEnvelopes, targetEnvelopes) : 0
      if (fromEnvelopes >= distance) continue
      // A cheap mould-envelope sweep already proves a useful empty prefix.
      // Leave its last few grid steps to the original exact collision test.
      if (fromEnvelopes > .5) { distance = fromEnvelopes; continue }
      const sourceCells = getBrickWorldCollisionCellBoxes(brick)
      const targetCells = getBrickWorldCollisionCellBoxes(entry.brick)
      // The original narrow phase requires overlap with each source library
      // envelope. Filter one side at a time: clipping BOTH could reject a
      // legacy pairwise contact, so take the later of the two safe bounds.
      const fromSource = firstPossibleContact(getEnvelopeFilteredCells(brick), targetCells)
      const fromTarget = firstPossibleContact(sourceCells, getEnvelopeFilteredCells(entry.brick))
      const fromCells = firstPossibleContact(sourceCells, targetCells)
      distance = Math.min(distance, Math.max(fromSource, fromTarget, fromCells, fromEnvelopes))
      if (distance <= 0) return 0
    }
  }
  return Math.max(0, distance)
}
