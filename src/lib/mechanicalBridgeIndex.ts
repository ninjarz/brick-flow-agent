import { brickById } from '../data/basicBricks'
import type { PlacedBrick } from '../types/bricks'
import { getBrickConnectors } from './brickUnits'

/**
 * Mechanical-bridge lookup for `hasIndirectMechanicalConnectorClearance`.
 *
 * A bridge can only exist when a mechanical connector (axle / bar / pin) of the
 * candidate sits within `mechanicalConnectorConnectionTolerance` (0.12 stud) of
 * a mechanical connector of the moved brick or its collision target. Indexing
 * connector coordinates therefore yields exactly the same candidate set as a
 * full scan of every brick, without changing any predicate.
 */
export type WorldBrickConnector = ReturnType<typeof getBrickConnectors>[number]

/** Cell size is deliberately much larger than the 0.12 stud connector tolerance. */
export const MECHANICAL_BRIDGE_CELL_SIZE = 1

const CONNECTOR_CACHE_LIMIT = 20_000

const isMechanicalConnectorKind = (kind: WorldBrickConnector['kind']) =>
  kind === 'axle' || kind === 'bar' || kind === 'pin'

export const isMechanicalConnector = (connector: WorldBrickConnector) =>
  isMechanicalConnectorKind(connector.kind)

/** Must stay identical to `getConnectorCacheKey` in planUtils.ts. */
export const getConnectorCacheKey = (brick: PlacedBrick) =>
  `${brick.id}:${brick.brickId}:${brick.pose.xStud},${brick.pose.yStud},${brick.pose.zStud},${brick.pose.rotationQuarterTurns},${brick.pose.verticalQuarterTurns ?? 0},${brick.pose.rollQuarterTurns ?? 0}:${brick.pose.orientationMatrix?.join(',') ?? ''}`

const fallbackConnectorCache = new Map<string, WorldBrickConnector[]>()

const setLimitedCache = (cache: Map<string, WorldBrickConnector[]>, key: string, value: WorldBrickConnector[]) => {
  if (!cache.has(key) && cache.size >= CONNECTOR_CACHE_LIMIT) {
    // Batched FIFO eviction: recreating an iterator per entry repeatedly walks
    // Map tombstones when a large model fills the cache.
    const oldest = cache.keys()
    for (let count = 0; count < CONNECTOR_CACHE_LIMIT / 10; count += 1) {
      const entry = oldest.next()
      if (entry.done) break
      cache.delete(entry.value)
    }
  }
  cache.set(key, value)
}

/**
 * `getPlacedBrickConnectors` uses this for its context-free branch. The result
 * only depends on (definition, pose), so memoising it is semantically neutral.
 */
export const getCachedBrickConnectors = (brick: PlacedBrick): WorldBrickConnector[] => {
  const definition = brickById.get(brick.brickId)
  if (!definition) return []

  const key = getConnectorCacheKey(brick)
  const cached = fallbackConnectorCache.get(key)
  if (cached) return cached

  const connectors = getBrickConnectors(definition, brick.pose)
  setLimitedCache(fallbackConnectorCache, key, connectors)
  return connectors
}

const cellCoordinate = (value: number) => Math.floor(value / MECHANICAL_BRIDGE_CELL_SIZE)
const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`

const connectorCellKey = (connector: WorldBrickConnector) =>
  cellKey(
    cellCoordinate(connector.pose.xStud),
    cellCoordinate(connector.pose.yStud),
    cellCoordinate(connector.pose.zStud),
  )

export type MechanicalBridgeIndex = {
  bricksById: Map<string, PlacedBrick>
  cells: Map<string, Set<string>>
  mechanicalConnectorBrickIds: Set<string>
}

export const createMechanicalBridgeIndex = (bricks: PlacedBrick[]): MechanicalBridgeIndex => {
  const bricksById = new Map(bricks.map((brick) => [brick.id, brick]))
  const cells = new Map<string, Set<string>>()
  const mechanicalConnectorBrickIds = new Set<string>()

  for (const brick of bricks) {
    const mechanicalConnectors = getCachedBrickConnectors(brick).filter(isMechanicalConnector)
    if (mechanicalConnectors.length === 0) continue

    mechanicalConnectorBrickIds.add(brick.id)
    for (const connector of mechanicalConnectors) {
      const key = connectorCellKey(connector)
      const ids = cells.get(key)
      if (ids) ids.add(brick.id)
      else cells.set(key, new Set([brick.id]))
    }
  }

  return { bricksById, cells, mechanicalConnectorBrickIds }
}

/**
 * Bricks whose mechanical connectors share (or neighbour) a cell with a
 * mechanical connector of the moved brick or its collision target. A 3x3x3
 * neighbourhood covers any connector pair within one cell size, which is far
 * above the 0.12 stud connection tolerance.
 */
export const getMechanicalBridgeCandidates = (
  index: MechanicalBridgeIndex,
  sourceConnectors: WorldBrickConnector[],
  targetConnectors: WorldBrickConnector[],
): PlacedBrick[] => {
  const candidateIds = new Set<string>()
  const collect = (connector: WorldBrickConnector) => {
    if (!isMechanicalConnector(connector)) return

    const cx = cellCoordinate(connector.pose.xStud)
    const cy = cellCoordinate(connector.pose.yStud)
    const cz = cellCoordinate(connector.pose.zStud)
    for (let x = cx - 1; x <= cx + 1; x += 1) {
      for (let y = cy - 1; y <= cy + 1; y += 1) {
        for (let z = cz - 1; z <= cz + 1; z += 1) {
          const ids = index.cells.get(cellKey(x, y, z))
          if (!ids) continue
          for (const id of ids) candidateIds.add(id)
        }
      }
    }
  }

  sourceConnectors.forEach(collect)
  targetConnectors.forEach(collect)

  const candidates: PlacedBrick[] = []
  for (const id of candidateIds) {
    const brick = index.bricksById.get(id)
    if (brick) candidates.push(brick)
  }
  return candidates
}
