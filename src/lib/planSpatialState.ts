import { brickById } from '../data/basicBricks'
import type { BrickPose, PlacedBrick } from '../types/bricks'
import { getBrickConnectors } from './brickUnits'
import { getBrickWorldBounds, type BrickBounds } from './ldrawBounds'
import { createStructuralCollisionIndex, type StructuralCollisionIndex } from './structuralGrid'

export type WorldBrickConnector = ReturnType<typeof getBrickConnectors>[number]

export type IndexedWorldBrickConnector = {
  brickId: string
  connector: WorldBrickConnector
}

type ConnectorSpatialIndex = {
  cellSize: number
  keyToConnectors: Map<string, IndexedWorldBrickConnector[]>
}

type PlanSpatialStateCacheEntry = {
  bricks: PlacedBrick[]
  state: PlanSpatialState
}

const planSpatialStateCache = new WeakMap<PlacedBrick[], PlanSpatialStateCacheEntry>()

const connectorSpatialCoordinate = (value: number, cellSize: number) =>
  Math.floor(value / cellSize)

const connectorSpatialKey = (x: number, y: number, z: number) =>
  `${x},${y},${z}`

const getConnectorSpatialKey = (connector: WorldBrickConnector, cellSize: number) =>
  connectorSpatialKey(
    connectorSpatialCoordinate(connector.pose.xStud, cellSize),
    connectorSpatialCoordinate(connector.pose.yStud, cellSize),
    connectorSpatialCoordinate(connector.pose.zStud, cellSize),
  )

const getBrickBounds = (brick: PlacedBrick) => {
  const definition = brickById.get(brick.brickId)
  if (!definition) return undefined

  return getBrickWorldBounds(definition, brick.pose)
}

const getPlanBounds = (bricks: PlacedBrick[]) => {
  if (bricks.length === 0) {
    return { width: 0, depth: 0, height: 0 }
  }

  return bricks.reduce(
    (bounds, brick) => {
      const brickBounds = getBrickBounds(brick)
      if (!brickBounds) return bounds

      return {
        width: Math.max(bounds.width, brickBounds.maxX),
        depth: Math.max(bounds.depth, brickBounds.maxZ),
        height: Math.max(bounds.height, brickBounds.maxY),
      }
    },
    { width: 0, depth: 0, height: 0 },
  )
}

export class PlanSpatialState {
  readonly bricks: PlacedBrick[]
  readonly bounds: ReturnType<typeof getPlanBounds>
  readonly boundsByBrickId = new Map<string, BrickBounds>()
  readonly connectorCache = new Map<string, WorldBrickConnector[]>()
  readonly graphConnectorBrickIds = new Set<string>()
  readonly mechanicalConnectorBrickIds = new Set<string>()
  readonly poseResults = new Map<string, BrickPose>()
  readonly snapResults = new Map<string, BrickPose>()

  private connectorIndex?: ConnectorSpatialIndex
  private collisionIndexValue?: StructuralCollisionIndex

  private constructor(bricks: PlacedBrick[], private readonly connectorSnapSearchTolerance: number) {
    this.bricks = [...bricks]
    this.bounds = getPlanBounds(this.bricks)

    for (const brick of this.bricks) {
      const bounds = getBrickBounds(brick)
      if (bounds) this.boundsByBrickId.set(brick.id, bounds)

      const connectors = this.getConnectors(brick)
      if (connectors.some((connector) => (
        connector.axis !== 'y' ||
        connector.kind === 'studsocket' ||
        PlanSpatialState.isMechanicalConnectorKind(connector.kind)
      ))) {
        this.graphConnectorBrickIds.add(brick.id)
      }
      if (connectors.some((connector) => PlanSpatialState.isMechanicalConnectorKind(connector.kind))) {
        this.mechanicalConnectorBrickIds.add(brick.id)
      }
    }
  }

  static fromBricks(bricks: PlacedBrick[], connectorSnapSearchTolerance: number) {
    const cached = planSpatialStateCache.get(bricks)
    if (
      cached &&
      cached.bricks.length === bricks.length &&
      cached.bricks.every((brick, index) => brick === bricks[index])
    ) {
      return cached.state
    }

    const state = new PlanSpatialState(bricks, connectorSnapSearchTolerance)
    planSpatialStateCache.set(bricks, {
      bricks: [...bricks],
      state,
    })
    return state
  }

  get collisionIndex() {
    this.collisionIndexValue ??= createStructuralCollisionIndex(this.bricks)
    return this.collisionIndexValue
  }

  getConnectors(brick: PlacedBrick) {
    const definition = brickById.get(brick.brickId)
    if (!definition) return []

    const cacheKey = `${brick.id}:${brick.brickId}:${brick.pose.xStud},${brick.pose.yStud},${brick.pose.zStud},${brick.pose.rotationQuarterTurns},${brick.pose.verticalQuarterTurns ?? 0}`
    const cached = this.connectorCache.get(cacheKey)
    if (cached) return cached

    const connectors = getBrickConnectors(definition, brick.pose)
    this.connectorCache.set(cacheKey, connectors)
    return connectors
  }

  getConnectorSnapCandidates(source: WorldBrickConnector) {
    const index = this.getConnectorIndex()
    const centerX = connectorSpatialCoordinate(source.pose.xStud, index.cellSize)
    const centerY = connectorSpatialCoordinate(source.pose.yStud, index.cellSize)
    const centerZ = connectorSpatialCoordinate(source.pose.zStud, index.cellSize)
    const candidates: IndexedWorldBrickConnector[] = []

    for (let x = centerX - 1; x <= centerX + 1; x += 1) {
      for (let y = centerY - 1; y <= centerY + 1; y += 1) {
        for (let z = centerZ - 1; z <= centerZ + 1; z += 1) {
          const connectors = index.keyToConnectors.get(connectorSpatialKey(x, y, z))
          if (connectors) candidates.push(...connectors)
        }
      }
    }

    return candidates
  }

  private getConnectorIndex() {
    if (this.connectorIndex) return this.connectorIndex

    const cellSize = this.connectorSnapSearchTolerance
    const keyToConnectors = new Map<string, IndexedWorldBrickConnector[]>()

    for (const brick of this.bricks) {
      for (const connector of this.getConnectors(brick)) {
        const key = getConnectorSpatialKey(connector, cellSize)
        const connectors = keyToConnectors.get(key)
        const indexedConnector = { brickId: brick.id, connector }

        if (connectors) {
          connectors.push(indexedConnector)
        } else {
          keyToConnectors.set(key, [indexedConnector])
        }
      }
    }

    this.connectorIndex = { cellSize, keyToConnectors }
    return this.connectorIndex
  }

  private static isMechanicalConnectorKind(kind: WorldBrickConnector['kind']) {
    return kind === 'axle' || kind === 'bar' || kind === 'pin'
  }
}
