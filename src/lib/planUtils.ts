import { brickById } from '../data/basicBricks'
import {
  HORIZONTAL_EDIT_STEP_STUDS,
  WORLD_SNAP_STEP_STUDS,
  getBrickConnectors,
  footprintToWorld,
  isHorizontalStudOnGrid,
  isYStudOnGrid,
  normalizeHorizontalStud,
  normalizeQuarterTurns,
  normalizeVerticalQuarterTurns,
  normalizeYStud,
} from './brickUnits'
import { getBrickFootprintWorldBounds, getBrickWorldBounds } from './ldrawBounds'
import { PlanSpatialState, type WorldBrickConnector } from './planSpatialState'
import {
  createStructuralCollisionIndex,
  doBrickStructuralCellsCollide,
  getBrickStructuralOverlapVolume,
  getStructuralCacheVersion,
  getBrickWorldSupportBounds,
  getBrickWorldSupportFaces,
  getStructuralCollisionCandidateIds,
  getStructuralOverlapScore,
  getBrickWorldCollisionKeys,
} from './structuralGrid'
import type { BrickColor, BrickPose, BuildPlan, BuildStep, PlacedBrick } from '../types/bricks'
import type { StructuralCollisionIndex } from './structuralGrid'

const connectionTolerance = 0.001
const boundsTolerance = 0.000001
const connectorConnectionTolerance = 0.12
const mechanicalConnectorConnectionTolerance = 0.12
const connectorSnapSearchTolerance = 0.6
const connectorUnsnapTolerance = 0.000001
const graphPairTolerance = 0.12
const graphPairSpatialCellSize = 1
const defaultLocalSearchRadiusStuds = 5
const verticalLoadContactCacheLimit = 100000
const verticalLoadContactCache = new Map<string, boolean>()

type PlanValidationContext = {
  connectorCache: Map<string, WorldBrickConnector[]>
  graphConnectorBrickIds: Set<string>
  mechanicalConnectorBrickIds: Set<string>
}

const isMechanicalConnectorKind = (kind: WorldBrickConnector['kind']) =>
  kind === 'axle' || kind === 'bar' || kind === 'pin'

const getConnectorCacheKey = (brick: PlacedBrick) =>
  `${brick.id}:${brick.brickId}:${brick.pose.xStud},${brick.pose.yStud},${brick.pose.zStud},${brick.pose.rotationQuarterTurns},${brick.pose.verticalQuarterTurns ?? 0}`

const getBrickPoseGeometryCacheKey = (brick: PlacedBrick) =>
  `${brick.brickId}:${brick.pose.xStud},${brick.pose.yStud},${brick.pose.zStud},${brick.pose.rotationQuarterTurns},${brick.pose.verticalQuarterTurns ?? 0}`

const setLimitedBooleanCache = (cache: Map<string, boolean>, key: string, value: boolean) => {
  if (!cache.has(key) && cache.size >= verticalLoadContactCacheLimit) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) cache.delete(oldestKey)
  }

  cache.set(key, value)
}

const getPlacedBrickConnectors = (
  brick: PlacedBrick,
  context?: PlanValidationContext,
) => {
  const definition = brickById.get(brick.brickId)
  if (!definition) return []

  if (!context) return getBrickConnectors(definition, brick.pose)

  const cacheKey = getConnectorCacheKey(brick)
  const cached = context.connectorCache.get(cacheKey)
  if (cached) return cached

  const connectors = getBrickConnectors(definition, brick.pose)
  context.connectorCache.set(cacheKey, connectors)
  return connectors
}

const placedBrickHasMechanicalConnector = (
  brick: PlacedBrick,
  context?: PlanValidationContext,
) =>
  getPlacedBrickConnectors(brick, context).some((connector) => isMechanicalConnectorKind(connector.kind))

const connectorCanFormNonSupportGraphEdge = (connector: WorldBrickConnector) =>
  connector.axis !== 'y' ||
  connector.kind === 'studsocket' ||
  isMechanicalConnectorKind(connector.kind)

const placedBrickNeedsGraphConnectorCheck = (
  brick: PlacedBrick,
  context?: PlanValidationContext,
) =>
  getPlacedBrickConnectors(brick, context).some(connectorCanFormNonSupportGraphEdge)

const graphPairNeedsConnectorCheck = (
  source: PlacedBrick,
  target: PlacedBrick,
  context?: PlanValidationContext,
) => {
  if (context) {
    return context.graphConnectorBrickIds.has(source.id) || context.graphConnectorBrickIds.has(target.id)
  }

  return placedBrickNeedsGraphConnectorCheck(source) || placedBrickNeedsGraphConnectorCheck(target)
}

const createPlanValidationContext = (bricks: PlacedBrick[]): PlanValidationContext => {
  const context: PlanValidationContext = {
    connectorCache: new Map(),
    graphConnectorBrickIds: new Set(),
    mechanicalConnectorBrickIds: new Set(),
  }

  for (const brick of bricks) {
    if (placedBrickNeedsGraphConnectorCheck(brick, context)) {
      context.graphConnectorBrickIds.add(brick.id)
    }
    if (placedBrickHasMechanicalConnector(brick, context)) {
      context.mechanicalConnectorBrickIds.add(brick.id)
    }
  }

  return context
}

const createPlanValidationContextFromSpatialState = (state: PlanSpatialState): PlanValidationContext => ({
  connectorCache: state.connectorCache,
  graphConnectorBrickIds: state.graphConnectorBrickIds,
  mechanicalConnectorBrickIds: state.mechanicalConnectorBrickIds,
})

export const createPlanSpatialState = (bricks: PlacedBrick[]) =>
  PlanSpatialState.fromBricks(bricks, connectorSnapSearchTolerance)

export const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}`

export const makeBrick = (
  brickId: string,
  color: BrickColor,
  xStud: number,
  yStud: number,
  zStud: number,
  rotationQuarterTurns = 0,
  verticalQuarterTurns = 0,
): PlacedBrick => ({
  id: createId('piece'),
  brickId,
  color,
  pose: {
    xStud: normalizeHorizontalStud(xStud),
    yStud: normalizeYStud(yStud),
    zStud: normalizeHorizontalStud(zStud),
    rotationQuarterTurns: normalizeQuarterTurns(rotationQuarterTurns),
    verticalQuarterTurns: normalizeVerticalQuarterTurns(verticalQuarterTurns),
  },
})

export const countBricks = (plan: BuildPlan) =>
  plan.bricks.reduce<Record<string, number>>((counts, brick) => {
    counts[brick.brickId] = (counts[brick.brickId] ?? 0) + 1
    return counts
  }, {})

export const createSingleBrickSteps = (bricks: PlacedBrick[]): BuildStep[] =>
  bricks.map((brick, index) => {
    const definition = brickById.get(brick.brickId)
    const name = definition?.name ?? brick.brickId

    return {
      id: createId('step'),
      title: `放置 ${name}`,
      description: `放置第 ${index + 1} 个零件：${name}。`,
      brickIds: [brick.id],
    }
  })

export const getBrickBounds = (brick: PlacedBrick) => {
  const definition = brickById.get(brick.brickId)
  if (!definition) return undefined

  return getBrickWorldBounds(definition, brick.pose)
}

const getBrickSupportBodyBounds = (brick: PlacedBrick) => {
  const definition = brickById.get(brick.brickId)
  if (!definition) return undefined

  return getBrickWorldSupportBounds(brick) ?? getBrickFootprintWorldBounds(definition, brick.pose)
}

const getBrickCollisionBroadBounds = (
  brick: PlacedBrick,
  context?: PlanValidationContext,
) =>
  graphPairNeedsConnectorCheck(brick, brick, context)
    ? getBrickBounds(brick)
    : getBrickSupportBodyBounds(brick)

const getBrickGraphPairBounds = getBrickCollisionBroadBounds

export const isBrickAboveGround = (brick: PlacedBrick) => {
  const bounds = getBrickBounds(brick)
  return Boolean(bounds && bounds.minY >= -boundsTolerance)
}

const liftBrickAboveGround = (brick: PlacedBrick) => {
  const bounds = getBrickBounds(brick)
  if (!bounds || bounds.minY >= -boundsTolerance) return brick

  const liftSteps = Math.ceil(Math.max(0, -bounds.minY) / WORLD_SNAP_STEP_STUDS)
  let lifted: PlacedBrick = {
    ...brick,
    pose: {
      ...brick.pose,
      yStud: normalizeYStud(brick.pose.yStud + liftSteps * WORLD_SNAP_STEP_STUDS),
    },
  }

  for (let attempts = 0; attempts < 4 && !isBrickAboveGround(lifted); attempts += 1) {
    lifted = {
      ...lifted,
      pose: {
        ...lifted.pose,
        yStud: normalizeYStud(lifted.pose.yStud + WORLD_SNAP_STEP_STUDS),
      },
    }
  }

  return lifted
}

type HorizontalSearchOffset = {
  xStud: number
  zStud: number
  distanceSq: number
}

const horizontalSearchOffsetCache = new Map<string, HorizontalSearchOffset[]>()

export const getNearestHorizontalSearchOffsets = (
  radiusStuds = defaultLocalSearchRadiusStuds,
  stepStuds = HORIZONTAL_EDIT_STEP_STUDS,
) => {
  const radius = Math.max(0, radiusStuds)
  const step = Math.max(WORLD_SNAP_STEP_STUDS, stepStuds)
  const cacheKey = `${radius}:${step}`
  const cached = horizontalSearchOffsetCache.get(cacheKey)
  if (cached) return cached

  const radiusSteps = Math.ceil(radius / step)
  const radiusSq = radius * radius
  const offsets: HorizontalSearchOffset[] = []

  for (let xStep = -radiusSteps; xStep <= radiusSteps; xStep += 1) {
    for (let zStep = -radiusSteps; zStep <= radiusSteps; zStep += 1) {
      const xStud = normalizeHorizontalStud(xStep * step)
      const zStud = normalizeHorizontalStud(zStep * step)
      const distanceSq = xStud * xStud + zStud * zStud
      if (distanceSq > radiusSq + boundsTolerance) continue
      offsets.push({ xStud, zStud, distanceSq })
    }
  }

  offsets.sort((source, target) =>
    source.distanceSq - target.distanceSq ||
    Math.abs(source.xStud) + Math.abs(source.zStud) - Math.abs(target.xStud) - Math.abs(target.zStud) ||
    source.xStud - target.xStud ||
    source.zStud - target.zStud
  )
  horizontalSearchOffsetCache.set(cacheKey, offsets)
  return offsets
}

type FindNearestOpenPoseAroundOptions = {
  radiusStuds?: number
  stepStuds?: number
}

export const findNearestOpenPoseAround = (
  brick: PlacedBrick,
  bricks: PlacedBrick[],
  options: FindNearestOpenPoseAroundOptions = {},
) => {
  const collisionIndex = createBrickCollisionIndex(bricks)

  for (const offset of getNearestHorizontalSearchOffsets(options.radiusStuds, options.stepStuds)) {
    const candidate = liftBrickAboveGround({
      ...brick,
      pose: {
        ...brick.pose,
        xStud: normalizeHorizontalStud(brick.pose.xStud + offset.xStud),
        zStud: normalizeHorizontalStud(brick.pose.zStud + offset.zStud),
      },
    })

    if (isBrickAboveGround(candidate) && !hasBrickCollision(candidate, bricks, collisionIndex)) {
      return candidate
    }
  }

  return undefined
}

export const doBrickBoundsOverlap = (source: PlacedBrick, target: PlacedBrick) => {
  const sourceKeys = getBrickWorldCollisionKeys(source)
  const targetKeys = getBrickWorldCollisionKeys(target)
  if (sourceKeys.size === 0 || targetKeys.size === 0) return false

  for (const key of sourceKeys) {
    if (targetKeys.has(key)) return true
  }

  return false
}

export const createBrickCollisionIndex = createStructuralCollisionIndex

const getBoundsOverlapVolume = (
  sourceBounds: NonNullable<ReturnType<typeof getBrickBounds>>,
  targetBounds: NonNullable<ReturnType<typeof getBrickBounds>>,
) => {
  const x = Math.max(0, Math.min(sourceBounds.maxX, targetBounds.maxX) - Math.max(sourceBounds.minX, targetBounds.minX) - boundsTolerance)
  const y = Math.max(0, Math.min(sourceBounds.maxY, targetBounds.maxY) - Math.max(sourceBounds.minY, targetBounds.minY) - boundsTolerance)
  const z = Math.max(0, Math.min(sourceBounds.maxZ, targetBounds.maxZ) - Math.max(sourceBounds.minZ, targetBounds.minZ) - boundsTolerance)
  return x * y * z
}

export const getBrickRawOverlapScore = (
  brick: PlacedBrick,
  bricks: PlacedBrick[],
  collisionIndex?: StructuralCollisionIndex,
) => {
  if (collisionIndex) return getStructuralOverlapScore(brick, collisionIndex)

  return bricks.reduce((score, other) => {
    if (other.id === brick.id) return score
    return score + (doBrickBoundsOverlap(brick, other)
      ? getBrickStructuralOverlapVolume(brick, other)
      : 0)
  }, 0)
}

export const hasBrickCollision = (
  brick: PlacedBrick,
  bricks: PlacedBrick[],
  collisionIndex?: StructuralCollisionIndex,
  context?: PlanValidationContext,
) => {
  if (!collisionIndex) {
    return bricks.some((other) => (
      other.id !== brick.id &&
      doBrickBoundsOverlap(brick, other) &&
      doBrickStructuralCellsCollide(brick, other) &&
      !hasConnectorConnection(brick, other, context) &&
      !hasIndirectMechanicalConnectorClearance(brick, other, bricks, context)
    ))
  }

  for (const candidateId of getStructuralCollisionCandidateIds(brick, collisionIndex)) {
    const other = collisionIndex.bricksById.get(candidateId)
    if (
      other &&
      doBrickStructuralCellsCollide(brick, other) &&
      !hasConnectorConnection(brick, other, context) &&
      !hasIndirectMechanicalConnectorClearance(brick, other, bricks, context)
    ) return true
  }

  return false
}

const doBoundsOverlapHorizontally = (
  sourceBounds: Pick<NonNullable<ReturnType<typeof getBrickBounds>>, 'minX' | 'maxX' | 'minZ' | 'maxZ'>,
  targetBounds: Pick<NonNullable<ReturnType<typeof getBrickBounds>>, 'minX' | 'maxX' | 'minZ' | 'maxZ'>,
) =>
  sourceBounds.minX < targetBounds.maxX - boundsTolerance &&
  sourceBounds.maxX > targetBounds.minX + boundsTolerance &&
  sourceBounds.minZ < targetBounds.maxZ - boundsTolerance &&
  sourceBounds.maxZ > targetBounds.minZ + boundsTolerance

const hasVerticalLoadContact = (
  brick: PlacedBrick,
  support: PlacedBrick,
  boundsById?: Map<string, NonNullable<ReturnType<typeof getBrickBounds>>>,
) => {
  const cacheKey = [
    getStructuralCacheVersion(),
    getBrickPoseGeometryCacheKey(brick),
    getBrickPoseGeometryCacheKey(support),
  ].join('>')
  const cached = verticalLoadContactCache.get(cacheKey)
  if (cached !== undefined) return cached
  const remember = (value: boolean) => {
    setLimitedBooleanCache(verticalLoadContactCache, cacheKey, value)
    return value
  }

  const bounds = boundsById?.get(brick.id) ?? getBrickSupportBodyBounds(brick)
  const supportBounds = boundsById?.get(support.id) ?? getBrickSupportBodyBounds(support)
  if (!bounds || !supportBounds) return remember(false)
  if (supportBounds.maxY < bounds.minY - connectionTolerance) return remember(false)
  if (supportBounds.minY > bounds.maxY + connectionTolerance) return remember(false)
  if (!doBoundsOverlapHorizontally(bounds, supportBounds)) return remember(false)

  const brickFaces = getBrickWorldSupportFaces(brick)
  const supportFaces = getBrickWorldSupportFaces(support)

  for (const [planeKey, bottomFaces] of brickFaces.bottomPlanes) {
    const topFaces = supportFaces.topPlanes.get(planeKey)
    if (!topFaces) continue

    if (bottomFaces.some((bottomFace) =>
      topFaces.some((topFace) => doBoundsOverlapHorizontally(bottomFace, topFace))
    )) {
      return remember(true)
    }
  }

  return remember(false)
}

const hasConnectorConnection = (
  brick: PlacedBrick,
  other: PlacedBrick,
  context?: PlanValidationContext,
) => {
  const sourceConnectors = getPlacedBrickConnectors(brick, context)
  const targetConnectors = getPlacedBrickConnectors(other, context)

  return sourceConnectors.some((source) =>
    targetConnectors.some((target) => (
      areConnectorsCompatible(source, target) &&
      connectorDistance(source, target) <= getConnectorConnectionTolerance(source, target)
    )),
  )
}

const isMechanicalConnector = (
  connector: ReturnType<typeof getBrickConnectors>[number],
) =>
  isMechanicalConnectorKind(connector.kind)

const hasMechanicalConnectorConnection = (
  brick: PlacedBrick,
  other: PlacedBrick,
  context?: PlanValidationContext,
) => {
  const sourceConnectors = getPlacedBrickConnectors(brick, context)
  const targetConnectors = getPlacedBrickConnectors(other, context)

  return sourceConnectors.some((source) =>
    isMechanicalConnector(source) &&
    targetConnectors.some((target) => (
      isMechanicalConnector(target) &&
      areConnectorsCompatible(source, target) &&
      connectorDistance(source, target) <= getConnectorConnectionTolerance(source, target)
    )),
  )
}

const areBricksAttached = (
  source: PlacedBrick,
  target: PlacedBrick,
  context?: PlanValidationContext,
  boundsById?: Map<string, BrickBounds>,
) =>
  hasVerticalLoadContact(source, target, boundsById) ||
  hasVerticalLoadContact(target, source, boundsById) ||
  (
    graphPairNeedsConnectorCheck(source, target, context) &&
    hasConnectorConnection(source, target, context)
  )

const addGraphEdge = (edges: Map<string, Set<string>>, sourceId: string, targetId: string) => {
  const targets = edges.get(sourceId)
  if (targets) {
    targets.add(targetId)
  } else {
    edges.set(sourceId, new Set([targetId]))
  }
}

const addUndirectedGraphEdge = (edges: Map<string, Set<string>>, sourceId: string, targetId: string) => {
  addGraphEdge(edges, sourceId, targetId)
  addGraphEdge(edges, targetId, sourceId)
}

const emptyGraphEdgeTargets = new Set<string>()

const getGraphEdgeTargets = (edges: Map<string, Set<string>>, sourceId: string) =>
  edges.get(sourceId) ?? emptyGraphEdgeTargets

export type BuildGraph = {
  attachmentEdges: Map<string, Set<string>>
  boundsById: Map<string, BrickBounds>
  groundedIds: Set<string>
  components: PlacedBrick[][]
}

const isBuildGraph = (value: StructuralCollisionIndex | BuildGraph | undefined): value is BuildGraph =>
  Boolean(value && 'groundedIds' in value)

type BrickBounds = NonNullable<ReturnType<typeof getBrickBounds>>

type GraphPairSpatialIndex = {
  keyToBrickIds: Map<string, Set<string>>
}

const graphPairSpatialCoordinate = (value: number) =>
  Math.floor(value / graphPairSpatialCellSize)

const makeGraphPairSpatialKey = (x: number, y: number, z: number) =>
  `${x},${y},${z}`

const getGraphPairSpatialKeys = (
  bounds: BrickBounds,
  tolerance = graphPairTolerance,
) => {
  const minX = graphPairSpatialCoordinate(bounds.minX - tolerance)
  const maxX = graphPairSpatialCoordinate(bounds.maxX + tolerance)
  const minY = graphPairSpatialCoordinate(bounds.minY - tolerance)
  const maxY = graphPairSpatialCoordinate(bounds.maxY + tolerance)
  const minZ = graphPairSpatialCoordinate(bounds.minZ - tolerance)
  const maxZ = graphPairSpatialCoordinate(bounds.maxZ + tolerance)
  const keys: string[] = []

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        keys.push(makeGraphPairSpatialKey(x, y, z))
      }
    }
  }

  return keys
}

const createGraphPairSpatialIndex = (
  bricks: PlacedBrick[],
  boundsById: Map<string, BrickBounds>,
  tolerance = graphPairTolerance,
): GraphPairSpatialIndex => {
  const keyToBrickIds = new Map<string, Set<string>>()

  for (const brick of bricks) {
    const bounds = boundsById.get(brick.id)
    if (!bounds) continue

    for (const key of getGraphPairSpatialKeys(bounds, tolerance)) {
      const brickIds = keyToBrickIds.get(key)
      if (brickIds) {
        brickIds.add(brick.id)
      } else {
        keyToBrickIds.set(key, new Set([brick.id]))
      }
    }
  }

  return { keyToBrickIds }
}

const getPotentialGraphPairIds = (
  brick: PlacedBrick,
  boundsById: Map<string, BrickBounds>,
  graphPairIndex: GraphPairSpatialIndex,
) => {
  const ids = new Set<string>()
  const bounds = boundsById.get(brick.id)
  if (!bounds) return ids

  for (const key of getGraphPairSpatialKeys(bounds)) {
    const brickIds = graphPairIndex.keyToBrickIds.get(key)
    if (!brickIds) continue

    for (const candidateId of brickIds) {
      if (candidateId === brick.id || ids.has(candidateId)) continue
      const candidateBounds = boundsById.get(candidateId)
      if (!candidateBounds) continue

      const xNear = bounds.minX < candidateBounds.maxX + graphPairTolerance && bounds.maxX > candidateBounds.minX - graphPairTolerance
      const yNear = bounds.minY < candidateBounds.maxY + graphPairTolerance && bounds.maxY > candidateBounds.minY - graphPairTolerance
      const zNear = bounds.minZ < candidateBounds.maxZ + graphPairTolerance && bounds.maxZ > candidateBounds.minZ - graphPairTolerance
      if (xNear && yNear && zNear) ids.add(candidateId)
    }
  }

  return ids
}

const doBoundsOverlap3D = (
  sourceBounds: BrickBounds,
  targetBounds: BrickBounds,
) =>
  sourceBounds.minX < targetBounds.maxX - boundsTolerance &&
  sourceBounds.maxX > targetBounds.minX + boundsTolerance &&
  sourceBounds.minY < targetBounds.maxY - boundsTolerance &&
  sourceBounds.maxY > targetBounds.minY + boundsTolerance &&
  sourceBounds.minZ < targetBounds.maxZ - boundsTolerance &&
  sourceBounds.maxZ > targetBounds.minZ + boundsTolerance

const getPotentialBoundsCollisionPairIds = (
  brick: PlacedBrick,
  boundsById: Map<string, BrickBounds>,
  boundsPairIndex: GraphPairSpatialIndex,
) => {
  const ids = new Set<string>()
  const bounds = boundsById.get(brick.id)
  if (!bounds) return ids

  for (const key of getGraphPairSpatialKeys(bounds, 0)) {
    const brickIds = boundsPairIndex.keyToBrickIds.get(key)
    if (!brickIds) continue

    for (const candidateId of brickIds) {
      if (candidateId === brick.id || ids.has(candidateId)) continue
      const candidateBounds = boundsById.get(candidateId)
      if (candidateBounds && doBoundsOverlap3D(bounds, candidateBounds)) ids.add(candidateId)
    }
  }

  return ids
}

const computeConnectedComponentsFromEdges = (
  bricks: PlacedBrick[],
  attachmentEdges: Map<string, Set<string>>,
) => {
  const remaining = new Map(bricks.map((brick) => [brick.id, brick]))
  const components: PlacedBrick[][] = []

  for (const root of bricks) {
    if (!remaining.has(root.id)) continue

    remaining.delete(root.id)
    const component: PlacedBrick[] = []
    const queue = [root]
    let queueIndex = 0

    while (queueIndex < queue.length) {
      const current = queue[queueIndex]
      queueIndex += 1

      component.push(current)

      for (const candidateId of getGraphEdgeTargets(attachmentEdges, current.id)) {
        const candidate = remaining.get(candidateId)
        if (!candidate) continue
        remaining.delete(candidate.id)
        queue.push(candidate)
      }
    }

    components.push(component)
  }

  return components
}

const computeGroundedIds = (
  bricks: PlacedBrick[],
  attachmentEdges: Map<string, Set<string>>,
  boundsById: Map<string, NonNullable<ReturnType<typeof getBrickBounds>>>,
) => {
  const groundedIds = new Set<string>()
  const queue: PlacedBrick[] = []
  const brickByPlacedId = new Map(bricks.map((brick) => [brick.id, brick]))

  for (const brick of bricks) {
    const bounds = boundsById.get(brick.id)
    if (!bounds || bounds.minY < -boundsTolerance || bounds.minY > boundsTolerance) continue
    groundedIds.add(brick.id)
    queue.push(brick)
  }

  let queueIndex = 0

  while (queueIndex < queue.length) {
    const current = queue[queueIndex]
    queueIndex += 1

    for (const candidateId of getGraphEdgeTargets(attachmentEdges, current.id)) {
      if (groundedIds.has(candidateId)) continue
      const candidate = brickByPlacedId.get(candidateId)
      if (!candidate) continue
      groundedIds.add(candidateId)
      queue.push(candidate)
    }
  }

  return groundedIds
}

export const createBuildGraph = (
  bricks: PlacedBrick[],
  context = createPlanValidationContext(bricks),
): BuildGraph => {
  const attachmentEdges = new Map<string, Set<string>>()
  const bricksById = new Map(bricks.map((brick) => [brick.id, brick]))
  const boundsById = new Map(
    bricks.flatMap((brick) => {
      const bounds = getBrickSupportBodyBounds(brick)
      return bounds ? [[brick.id, bounds] as const] : []
    }),
  )
  const graphPairBoundsById = new Map(
    bricks.flatMap((brick) => {
      const bounds = getBrickGraphPairBounds(brick, context)
      return bounds ? [[brick.id, bounds] as const] : []
    }),
  )
  const graphPairIndex = createGraphPairSpatialIndex(bricks, graphPairBoundsById)
  const checkedPairs = new Set<string>()

  for (const source of bricks) {
    for (const targetId of getPotentialGraphPairIds(source, graphPairBoundsById, graphPairIndex)) {
      const pairKey = [source.id, targetId].sort().join(':')
      if (checkedPairs.has(pairKey)) continue
      checkedPairs.add(pairKey)

      const target = bricksById.get(targetId)
      if (!target) continue

      const sourceOnTarget = hasVerticalLoadContact(source, target, boundsById)
      const targetOnSource = hasVerticalLoadContact(target, source, boundsById)
      const connectorConnected = !sourceOnTarget &&
        !targetOnSource &&
        graphPairNeedsConnectorCheck(source, target, context) &&
        hasConnectorConnection(source, target, context)

      if (sourceOnTarget || targetOnSource || connectorConnected) {
        addUndirectedGraphEdge(attachmentEdges, source.id, target.id)
      }
    }
  }

  const components = computeConnectedComponentsFromEdges(bricks, attachmentEdges)
  const groundedIds = computeGroundedIds(bricks, attachmentEdges, boundsById)

  return {
    attachmentEdges,
    boundsById,
    groundedIds,
    components,
  }
}

const hasIndirectMechanicalConnectorClearance = (
  source: PlacedBrick,
  target: PlacedBrick,
  bricks: PlacedBrick[],
  context?: PlanValidationContext,
) => {
  // Clips, bars, pins, and axles can sit beside a supporting brick while being
  // held by an intermediate piece; allow that narrow mechanical chain only.
  const sourceCanUseMechanicalBridge = placedBrickHasMechanicalConnector(source, context)
  const targetCanUseMechanicalBridge = placedBrickHasMechanicalConnector(target, context)
  if (!sourceCanUseMechanicalBridge && !targetCanUseMechanicalBridge) return false

  return bricks.some((bridge) => {
    if (bridge.id === source.id || bridge.id === target.id) return false
    if (context && !context.mechanicalConnectorBrickIds.has(bridge.id)) return false
    if (!context && !placedBrickHasMechanicalConnector(bridge)) return false

    return (
      (sourceCanUseMechanicalBridge && hasMechanicalConnectorConnection(source, bridge, context) && areBricksAttached(target, bridge, context)) ||
      (targetCanUseMechanicalBridge && hasMechanicalConnectorConnection(target, bridge, context) && areBricksAttached(source, bridge, context))
    )
  })
}

const isVerticalStudTubeConnection = (
  source: ReturnType<typeof getBrickConnectors>[number],
  target: ReturnType<typeof getBrickConnectors>[number],
) =>
  source.axis === 'y' &&
  target.axis === 'y' &&
  ((source.kind === 'stud' && target.kind === 'tube') ||
    (source.kind === 'tube' && target.kind === 'stud'))

const hasSupportConnectorConnection = (
  brick: PlacedBrick,
  other: PlacedBrick,
  context?: PlanValidationContext,
) => {
  const sourceConnectors = getPlacedBrickConnectors(brick, context)
  const targetConnectors = getPlacedBrickConnectors(other, context)

  return sourceConnectors.some((source) =>
    targetConnectors.some((target) => (
      areConnectorsCompatible(source, target) &&
      connectorDistance(source, target) <= getConnectorConnectionTolerance(source, target) &&
      !isVerticalStudTubeConnection(source, target)
    )),
  )
}

const canBrickDescendOneStep = (
  brick: PlacedBrick,
  bricks: PlacedBrick[],
  collisionIndex?: StructuralCollisionIndex,
  context?: PlanValidationContext,
) => {
  const bounds = getBrickBounds(brick)
  if (!bounds || bounds.minY <= boundsTolerance) return false

  const nextYStud = normalizeYStud(brick.pose.yStud - HORIZONTAL_EDIT_STEP_STUDS)
  if (nextYStud >= brick.pose.yStud - boundsTolerance) return false

  const loweredBrick: PlacedBrick = {
    ...brick,
    pose: {
      ...brick.pose,
      yStud: nextYStud,
    },
  }
  const loweredBounds = getBrickBounds(loweredBrick)
  if (!loweredBounds || loweredBounds.minY < -boundsTolerance) return false

  return !hasBrickCollision(loweredBrick, bricks, collisionIndex, context)
}

export const isBrickSupported = (
  brick: PlacedBrick,
  bricks: PlacedBrick[],
  collisionIndexOrGraph?: StructuralCollisionIndex | BuildGraph,
  context?: PlanValidationContext,
) => {
  const bounds = getBrickBounds(brick)
  if (!bounds) return true
  if (bounds.minY < -boundsTolerance) return false
  if (bounds.minY <= boundsTolerance) return true

  if (isBuildGraph(collisionIndexOrGraph)) {
    return collisionIndexOrGraph.groundedIds.has(brick.id)
  }

  const collisionIndex: StructuralCollisionIndex | undefined = collisionIndexOrGraph
  if (!canBrickDescendOneStep(brick, bricks, collisionIndex, context)) return true

  const connectorSupported = bricks.some((other) => other.id !== brick.id && hasSupportConnectorConnection(brick, other, context))
  if (connectorSupported || hasAxleConnection(brick, bricks, context)) return true

  return false
}

export const findOpenPose = (
  brick: PlacedBrick,
  bricks: PlacedBrick[],
  collisionIndex = createBrickCollisionIndex(bricks),
): PlacedBrick => {
  if (isBrickAboveGround(brick) && !hasBrickCollision(brick, bricks, collisionIndex)) return brick

  const bounds = getBounds(bricks)
  const definition = brickById.get(brick.brickId)
  const footprint = definition ? footprintToWorld(definition, brick.pose.rotationQuarterTurns, brick.pose.verticalQuarterTurns ?? 0) : undefined
  const maxX = Math.max(bounds.width + (footprint?.widthStuds ?? 1), 8)
  const maxZ = Math.max(bounds.depth + (footprint?.depthStuds ?? 1), 8)

  for (let yStud = 0; yStud <= bounds.height + 2.4; yStud += HORIZONTAL_EDIT_STEP_STUDS) {
    for (let zStep = 0; zStep <= Math.ceil(maxZ / HORIZONTAL_EDIT_STEP_STUDS); zStep += 1) {
      for (let xStep = 0; xStep <= Math.ceil(maxX / HORIZONTAL_EDIT_STEP_STUDS); xStep += 1) {
        const xStud = normalizeHorizontalStud(xStep * HORIZONTAL_EDIT_STEP_STUDS)
        const zStud = normalizeHorizontalStud(zStep * HORIZONTAL_EDIT_STEP_STUDS)
        const candidate = {
          ...brick,
          pose: {
            ...brick.pose,
            xStud,
            yStud,
            zStud,
          },
        }
        if (isBrickAboveGround(candidate) && !hasBrickCollision(candidate, bricks, collisionIndex)) return candidate
      }
    }
  }

  return liftBrickAboveGround({
    ...brick,
    pose: {
      ...brick.pose,
      xStud: normalizeHorizontalStud(bounds.width + 1),
      yStud: 0,
      zStud: 0,
    },
  })
}

type FindSupportedOpenPoseOptions = {
  allowGroundFallback?: boolean
  preferGroundFallback?: boolean
}

const getNearestRangeValues = (
  start: number,
  endExclusive: number,
  step: number,
  target: number,
) => {
  const values: number[] = []

  for (let value = start; value < endExclusive; value += step) {
    values.push(value)
  }

  values.sort((source, destination) =>
    Math.abs(source - target) - Math.abs(destination - target) ||
    source - destination
  )
  return values
}

export const findSupportedOpenPose = (
  brick: PlacedBrick,
  bricks: PlacedBrick[],
  options: FindSupportedOpenPoseOptions = {},
): PlacedBrick => {
  if (bricks.length === 0) return findOpenPose(brick, bricks)

  const spatialState = PlanSpatialState.fromBricks(bricks, connectorSnapSearchTolerance)
  const staticBricks = spatialState.bricks
  const resultCacheKey = [
    brick.brickId,
    brick.color,
    brick.pose.xStud,
    brick.pose.yStud,
    brick.pose.zStud,
    brick.pose.rotationQuarterTurns,
    brick.pose.verticalQuarterTurns ?? 0,
    options.allowGroundFallback ? 1 : 0,
    options.preferGroundFallback ? 1 : 0,
  ].join(':')
  const cachedResultPose = spatialState.poseResults.get(resultCacheKey)
  if (cachedResultPose) {
    return {
      ...brick,
      pose: { ...cachedResultPose },
    }
  }
  const rememberResult = (result: PlacedBrick) => {
    spatialState.poseResults.set(resultCacheKey, { ...result.pose })
    return result
  }
  const definition = brickById.get(brick.brickId)
  const bounds = spatialState.bounds
  const footprint = definition ? footprintToWorld(definition, brick.pose.rotationQuarterTurns, brick.pose.verticalQuarterTurns ?? 0) : undefined
  const context = createPlanValidationContextFromSpatialState(spatialState)
  const tryCandidate = (candidate: PlacedBrick, knownSupport?: PlacedBrick) =>
    isBrickAboveGround(candidate) &&
    !hasBrickCollision(candidate, staticBricks, spatialState.collisionIndex, context) &&
    isBrickSupported(
      candidate,
      knownSupport ? [knownSupport] : staticBricks,
      knownSupport ? undefined : spatialState.collisionIndex,
      context,
    )
  const testedCandidatePoseKeys = new Set<string>()
  const tryUniqueCandidate = (candidate: PlacedBrick, knownSupport: PlacedBrick) => {
    const poseKey = [
      candidate.pose.xStud,
      candidate.pose.yStud,
      candidate.pose.zStud,
      candidate.pose.rotationQuarterTurns,
      candidate.pose.verticalQuarterTurns ?? 0,
      knownSupport.id,
    ].join(':')
    if (testedCandidatePoseKeys.has(poseKey)) return false
    testedCandidatePoseKeys.add(poseKey)
    return tryCandidate(candidate, knownSupport)
  }

  const groundFallbackPoses: Array<{ xStud: number; yStud: number; zStud: number; outsideAxis: 'x' | 'z' }> = [
    { xStud: bounds.width + HORIZONTAL_EDIT_STEP_STUDS, yStud: 0, zStud: 0 },
    { xStud: 0, yStud: 0, zStud: bounds.depth + HORIZONTAL_EDIT_STEP_STUDS },
  ].map((pose, index) => ({
    ...pose,
    outsideAxis: index === 0 ? 'x' : 'z',
  }))

  const makeGroundFallbackCandidate = (pose: (typeof groundFallbackPoses)[number]): PlacedBrick => ({
    ...brick,
    pose: {
      ...brick.pose,
      xStud: normalizeHorizontalStud(pose.xStud),
      yStud: normalizeYStud(pose.yStud),
      zStud: normalizeHorizontalStud(pose.zStud),
    },
  })

  const isOutsideCurrentBounds = (candidate: PlacedBrick, outsideAxis: 'x' | 'z') => {
    const candidateBounds = getBrickBounds(candidate)
    if (!candidateBounds) return false
    return outsideAxis === 'x'
      ? candidateBounds.minX >= bounds.width - boundsTolerance
      : candidateBounds.minZ >= bounds.depth - boundsTolerance
  }

  if (options.allowGroundFallback && options.preferGroundFallback) {
    for (const pose of groundFallbackPoses) {
      const candidate = makeGroundFallbackCandidate(pose)
      if (
        isBrickAboveGround(candidate) &&
        (isOutsideCurrentBounds(candidate, pose.outsideAxis) || tryCandidate(candidate))
      ) return rememberResult(candidate)
    }
  }

  if ((options.allowGroundFallback || brick.pose.yStud > 0) && tryCandidate(brick)) {
    return rememberResult(brick)
  }

  if (options.allowGroundFallback) {
    for (const pose of groundFallbackPoses) {
      const candidate = makeGroundFallbackCandidate(pose)

      if (tryCandidate(candidate)) return rememberResult(candidate)
    }
  }

  if (footprint) {
    const supportSearchRadius = Math.max(
      defaultLocalSearchRadiusStuds,
      footprint.widthStuds,
      footprint.depthStuds,
    )
    const supportSearchRadiusSq = supportSearchRadius * supportSearchRadius
    const supportOptions = staticBricks
      .flatMap((support) => {
        const supportBounds = spatialState.boundsByBrickId.get(support.id)
        if (!supportBounds) return []

        const centerX = (supportBounds.minX + supportBounds.maxX) / 2
        const centerY = (supportBounds.minY + supportBounds.maxY) / 2
        const centerZ = (supportBounds.minZ + supportBounds.maxZ) / 2
        const dx = centerX - brick.pose.xStud
        const dy = centerY - brick.pose.yStud
        const dz = centerZ - brick.pose.zStud
        const horizontalDistanceSq = dx * dx + dz * dz
        if (horizontalDistanceSq > supportSearchRadiusSq) return []
        return [{
          support,
          supportBounds,
          distanceSq: horizontalDistanceSq + dy * dy,
        }]
      })
      .sort((source, target) =>
        source.distanceSq - target.distanceSq ||
        source.support.id.localeCompare(target.support.id)
      )

    for (const { support, supportBounds } of supportOptions) {
      const xCandidates = getNearestRangeValues(
        supportBounds.minX - footprint.widthStuds + HORIZONTAL_EDIT_STEP_STUDS,
        supportBounds.maxX,
        1,
        brick.pose.xStud,
      )
      const zCandidates = getNearestRangeValues(
        supportBounds.minZ - footprint.depthStuds + HORIZONTAL_EDIT_STEP_STUDS,
        supportBounds.maxZ,
        1,
        brick.pose.zStud,
      )

      for (const xStud of xCandidates) {
        for (const zStud of zCandidates) {
          const candidate: PlacedBrick = {
            ...brick,
            pose: {
              ...brick.pose,
              xStud: normalizeHorizontalStud(xStud),
              yStud: normalizeYStud(supportBounds.maxY),
              zStud: normalizeHorizontalStud(zStud),
            },
          }

          if (tryUniqueCandidate(candidate, support)) return rememberResult(candidate)
        }
      }
    }
  }

  return rememberResult(findOpenPose(brick, staticBricks, spatialState.collisionIndex))
}

const areConnectorsCompatible = (
  source: ReturnType<typeof getBrickConnectors>[number],
  target: ReturnType<typeof getBrickConnectors>[number],
) => {
  if (source.axis !== target.axis) return false

  const sourceDirection = source.direction ?? { x: 0, y: 1, z: 0 }
  const targetDirection = target.direction ?? { x: 0, y: 1, z: 0 }
  const directionDot =
    sourceDirection.x * targetDirection.x +
    sourceDirection.y * targetDirection.y +
    sourceDirection.z * targetDirection.z

  if (source.kind === 'studsocket' && target.kind === 'studsocket') return directionDot < -0.5
  if (source.gender === target.gender) return false

  if (source.kind === 'axle' && target.kind === 'axle') return Math.abs(directionDot) > 0.5
  if (source.kind === 'bar' && target.kind === 'bar') return Math.abs(directionDot) > 0.5
  if (source.kind === 'pin' && target.kind === 'pin') return Math.abs(directionDot) > 0.5

  return (
    directionDot < -0.5 &&
    ((source.kind === 'stud' && target.kind === 'tube') ||
      (source.kind === 'tube' && target.kind === 'stud'))
  )
}

const getConnectorConnectionTolerance = (
  source: ReturnType<typeof getBrickConnectors>[number],
  target: ReturnType<typeof getBrickConnectors>[number],
) =>
  source.kind === 'axle' || target.kind === 'axle' || source.kind === 'bar' || target.kind === 'bar' || source.kind === 'pin' || target.kind === 'pin'
    ? mechanicalConnectorConnectionTolerance
    : connectorConnectionTolerance

const hasAxleConnection = (
  brick: PlacedBrick,
  bricks: PlacedBrick[],
  context?: PlanValidationContext,
) => {
  const sourceConnectors = getPlacedBrickConnectors(brick, context).filter((connector) => connector.kind === 'axle')
  if (sourceConnectors.length === 0) return false

  return bricks.some((other) => {
    if (other.id === brick.id) return false

    const targetConnectors = getPlacedBrickConnectors(other, context).filter((connector) => connector.kind === 'axle')
    return sourceConnectors.some((source) =>
      targetConnectors.some(
        (target) => areConnectorsCompatible(source, target) && connectorDistance(source, target) <= 0.2,
      ),
    )
  })
}

const connectorDistance = (
  source: ReturnType<typeof getBrickConnectors>[number],
  target: ReturnType<typeof getBrickConnectors>[number],
) => {
  const dx = target.pose.xStud - source.pose.xStud
  const dy = target.pose.yStud - source.pose.yStud
  const dz = target.pose.zStud - source.pose.zStud
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

const connectorDirectionDot = (
  source: ReturnType<typeof getBrickConnectors>[number],
  target: ReturnType<typeof getBrickConnectors>[number],
) => {
  const sourceDirection = source.direction ?? { x: 0, y: 1, z: 0 }
  const targetDirection = target.direction ?? { x: 0, y: 1, z: 0 }
  return (
    sourceDirection.x * targetDirection.x +
    sourceDirection.y * targetDirection.y +
    sourceDirection.z * targetDirection.z
  )
}

export const getBrickPlacementDiagnostics = (brick: PlacedBrick, bricks: PlacedBrick[]) => {
  const definition = brickById.get(brick.brickId)
  const bounds = getBrickBounds(brick)
  const connectors = definition ? getBrickConnectors(definition, brick.pose) : []

  const otherDetails = bricks
    .filter((other) => other.id !== brick.id)
    .map((other) => {
      const otherDefinition = brickById.get(other.brickId)
      const otherBounds = getBrickBounds(other)
      const otherConnectors = otherDefinition ? getBrickConnectors(otherDefinition, other.pose) : []
      const connectorPairs = connectors.flatMap((source) =>
        otherConnectors.map((target) => ({
          sourceId: source.id,
          sourceKind: source.kind,
          sourceAxis: source.axis,
          sourceDirection: source.direction,
          sourcePose: source.pose,
          targetId: target.id,
          targetKind: target.kind,
          targetAxis: target.axis,
          targetDirection: target.direction,
          targetPose: target.pose,
          compatible: areConnectorsCompatible(source, target),
          directionDot: connectorDirectionDot(source, target),
          distance: connectorDistance(source, target),
        })),
      )
      const compatiblePairs = connectorPairs
        .filter((pair) => pair.compatible)
        .sort((source, target) => source.distance - target.distance)

      return {
        id: other.id,
        brickId: other.brickId,
        pose: other.pose,
        bounds: otherBounds,
        rawOverlapVolume: bounds && otherBounds ? getBoundsOverlapVolume(bounds, otherBounds) : 0,
        boundsOverlap: doBrickBoundsOverlap(brick, other),
        hasConnectorConnection: hasConnectorConnection(brick, other),
        topSupportOverlap: hasVerticalLoadContact(brick, other),
        nearestCompatibleConnectors: compatiblePairs.slice(0, 5),
        nearestAnyConnectors: connectorPairs
          .sort((source, target) => source.distance - target.distance)
          .slice(0, 5),
      }
    })

  return {
    id: brick.id,
    brickId: brick.brickId,
    pose: brick.pose,
    bounds,
    supported: isBrickSupported(brick, bricks),
    canDescendOneStep: canBrickDescendOneStep(brick, bricks),
    collision: hasBrickCollision(brick, bricks),
    rawOverlapScore: getBrickRawOverlapScore(brick, bricks),
    details: otherDetails.filter(
      (detail) =>
        detail.boundsOverlap ||
        detail.hasConnectorConnection ||
        detail.topSupportOverlap ||
        detail.nearestCompatibleConnectors.length > 0,
    ),
  }
}

const buildPlacedBrickWithPose = (brick: PlacedBrick, pose: BrickPose): PlacedBrick => ({
  ...brick,
  pose: {
    ...pose,
    xStud: normalizeHorizontalStud(pose.xStud),
    yStud: normalizeYStud(pose.yStud),
    zStud: normalizeHorizontalStud(pose.zStud),
    rotationQuarterTurns: normalizeQuarterTurns(pose.rotationQuarterTurns),
    verticalQuarterTurns: normalizeVerticalQuarterTurns(pose.verticalQuarterTurns ?? 0),
  },
})

type SnapBrickToPlanOptions = {
  previousBrick?: PlacedBrick
  spatialState?: PlanSpatialState
}

export const snapBrickToPlan = (
  brick: PlacedBrick,
  bricks: PlacedBrick[],
  options: SnapBrickToPlanOptions = {},
) => {
  const definition = brickById.get(brick.brickId)
  if (!definition) return brick

  const spatialState = options.spatialState ?? createPlanSpatialState(bricks)
  const staticBricks = spatialState.bricks
  const context = createPlanValidationContextFromSpatialState(spatialState)
  const snapCacheKey = [
    brick.brickId,
    brick.color,
    brick.pose.xStud,
    brick.pose.yStud,
    brick.pose.zStud,
    brick.pose.rotationQuarterTurns,
    brick.pose.verticalQuarterTurns ?? 0,
    options.previousBrick?.brickId ?? '',
    options.previousBrick?.pose.xStud ?? '',
    options.previousBrick?.pose.yStud ?? '',
    options.previousBrick?.pose.zStud ?? '',
    options.previousBrick?.pose.rotationQuarterTurns ?? '',
    options.previousBrick?.pose.verticalQuarterTurns ?? '',
  ].join(':')
  const cachedSnapPose = spatialState.snapResults.get(snapCacheKey)
  if (cachedSnapPose) {
    return {
      ...brick,
      pose: { ...cachedSnapPose },
    }
  }
  const rememberSnap = (result: PlacedBrick) => {
    spatialState.snapResults.set(snapCacheKey, { ...result.pose })
    return result
  }

  const sourceConnectors = spatialState.getConnectors(brick)
  const previousSourceConnectorsById = options.previousBrick
    ? new Map(spatialState.getConnectors(options.previousBrick).map((connector) => [connector.id, connector]))
    : undefined
  let best:
    | {
        score: number
        pose: BrickPose
      }
    | undefined

  for (const source of sourceConnectors) {
    for (const { brickId, connector: target } of spatialState.getConnectorSnapCandidates(source)) {
      if (brickId === brick.id) continue
      if (!areConnectorsCompatible(source, target)) continue
      const distance = connectorDistance(source, target)
      if (distance > connectorSnapSearchTolerance) continue
      const previousSource = previousSourceConnectorsById?.get(source.id)
      if (previousSource && areConnectorsCompatible(previousSource, target)) {
        const previousDistance = connectorDistance(previousSource, target)
        if (
          previousDistance <= getConnectorConnectionTolerance(previousSource, target) &&
          distance > previousDistance + connectorUnsnapTolerance
        ) {
          continue
        }
      }

      const snappedPose: BrickPose = {
        xStud: normalizeHorizontalStud(brick.pose.xStud + (target.pose.xStud - source.pose.xStud)),
        yStud: normalizeYStud(brick.pose.yStud + (target.pose.yStud - source.pose.yStud)),
        zStud: normalizeHorizontalStud(brick.pose.zStud + (target.pose.zStud - source.pose.zStud)),
        rotationQuarterTurns: brick.pose.rotationQuarterTurns,
        verticalQuarterTurns: brick.pose.verticalQuarterTurns ?? 0,
      }

      if (!best || distance < best.score) {
        best = {
          score: distance,
          pose: snappedPose,
        }
      }
    }
  }

  if (!best) return rememberSnap(brick)

  const snappedBrick = buildPlacedBrickWithPose(brick, best.pose)
  return rememberSnap(
    hasBrickCollision(snappedBrick, staticBricks, spatialState.collisionIndex, context)
      ? brick
      : snappedBrick,
  )
}

export const getBounds = (bricks: PlacedBrick[]) => {
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

export const duplicateBrick = (brick: PlacedBrick): PlacedBrick => ({
  ...brick,
  id: createId('piece'),
  pose: {
    ...brick.pose,
    yStud: brick.pose.yStud + (
      brickById.get(brick.brickId)
        ? footprintToWorld(
            brickById.get(brick.brickId)!,
            brick.pose.rotationQuarterTurns,
            brick.pose.verticalQuarterTurns ?? 0,
          ).height
        : 1.2
    ),
  },
})

const cloneBrickWithUniqueId = (brick: PlacedBrick, usedIds: Set<string>): PlacedBrick => {
  const nextId = usedIds.has(brick.id) ? createId('piece') : brick.id
  usedIds.add(nextId)

  return {
    ...brick,
    id: nextId,
    pose: {
      xStud: normalizeHorizontalStud(brick.pose.xStud),
      yStud: normalizeYStud(brick.pose.yStud),
      zStud: normalizeHorizontalStud(brick.pose.zStud),
      rotationQuarterTurns: normalizeQuarterTurns(brick.pose.rotationQuarterTurns),
      verticalQuarterTurns: normalizeVerticalQuarterTurns(brick.pose.verticalQuarterTurns ?? 0),
    },
  }
}

const tryPlaceBrick = (brick: PlacedBrick, placed: PlacedBrick[]) => {
  const groundedBrick: PlacedBrick = placed.length === 0
    ? {
        ...brick,
        pose: {
          ...brick.pose,
          yStud: 0,
        },
      }
    : brick

  const snappedBrick = groundedBrick
  const collisionIndex = createBrickCollisionIndex(placed)
  if (!hasBrickCollision(snappedBrick, placed, collisionIndex) && isBrickSupported(snappedBrick, placed, collisionIndex)) {
    if (placed.length === 0 || snappedBrick.pose.yStud > 0) return snappedBrick
  }

  const supportedBrick = findSupportedOpenPose(snappedBrick, placed)
  if (!hasBrickCollision(supportedBrick, placed, collisionIndex) && isBrickSupported(supportedBrick, placed, collisionIndex)) {
    if (placed.length === 0 || supportedBrick.pose.yStud > 0) return supportedBrick
  }

  return undefined
}

export const repairBuildPlan = (plan: BuildPlan): BuildPlan => {
  const placed: PlacedBrick[] = []
  const usedIds = new Set<string>()
  const repairedCounts = new Map<string, number>()

  for (const brick of plan.bricks) {
    const definition = brickById.get(brick.brickId)
    if (!definition || !definition.colors.includes(brick.color)) continue
    const currentCount = repairedCounts.get(brick.brickId) ?? 0
    if (Number.isFinite(definition.inventory) && currentCount >= definition.inventory) continue

    const nextBrick = cloneBrickWithUniqueId(brick, usedIds)
    const placedBrick = tryPlaceBrick(nextBrick, placed)
    if (!placedBrick) continue

    placed.push(placedBrick)
    repairedCounts.set(brick.brickId, currentCount + 1)
  }

  return {
    ...plan,
    bricks: placed,
    steps: createSingleBrickSteps(placed),
  }
}

export const moveBrick = (brick: PlacedBrick, delta: Partial<BrickPose>): PlacedBrick => ({
  ...brick,
  pose: {
    ...brick.pose,
    ...delta,
    xStud: normalizeHorizontalStud(delta.xStud ?? brick.pose.xStud),
    yStud: normalizeYStud(delta.yStud ?? brick.pose.yStud),
    zStud: normalizeHorizontalStud(delta.zStud ?? brick.pose.zStud),
    rotationQuarterTurns: normalizeQuarterTurns(
      delta.rotationQuarterTurns ?? brick.pose.rotationQuarterTurns,
    ),
    verticalQuarterTurns: normalizeVerticalQuarterTurns(
      delta.verticalQuarterTurns ?? brick.pose.verticalQuarterTurns ?? 0,
    ),
  },
})

export type BuildPlanIssue =
  | {
      type: 'unknown-brick'
      brickId: string
    }
  | {
      type: 'invalid-color'
      brickId: string
      color: BrickColor
    }
  | {
      type: 'inventory-exceeded'
      brickId: string
      count: number
      inventory: number
    }
  | {
      type: 'invalid-pose'
      brickId: string
    }
  | {
      type: 'duplicate-id'
      brickId: string
    }
  | {
      type: 'missing-step-brick'
      brickId: string
    }
  | {
      type: 'unassigned-step-brick'
      brickId: string
    }
  | {
      type: 'disconnected-island'
      brickId: string
      componentIndex: number
      componentCount: number
    }
  | {
      type: 'collision'
      brickIds: [string, string]
    }
  | {
      type: 'unsupported'
      brickId: string
    }

export const isBuildPlanIssueBlocking = (issue: BuildPlanIssue) =>
  issue.type !== 'disconnected-island'

export const getBlockingBuildPlanIssues = (issues: BuildPlanIssue[]) =>
  issues.filter(isBuildPlanIssueBlocking)

export const getConnectedBrickComponents = (bricks: PlacedBrick[]) => {
  const attachmentEdges = new Map<string, Set<string>>()
  const context = createPlanValidationContext(bricks)
  const bricksById = new Map(bricks.map((brick) => [brick.id, brick]))
  const boundsById = new Map(
    bricks.flatMap((brick) => {
      const bounds = getBrickSupportBodyBounds(brick)
      return bounds ? [[brick.id, bounds] as const] : []
    }),
  )
  const graphPairBoundsById = new Map(
    bricks.flatMap((brick) => {
      const bounds = getBrickGraphPairBounds(brick, context)
      return bounds ? [[brick.id, bounds] as const] : []
    }),
  )
  const graphPairIndex = createGraphPairSpatialIndex(bricks, graphPairBoundsById)
  const checkedPairs = new Set<string>()

  for (const source of bricks) {
    for (const targetId of getPotentialGraphPairIds(source, graphPairBoundsById, graphPairIndex)) {
      const pairKey = [source.id, targetId].sort().join(':')
      if (checkedPairs.has(pairKey)) continue
      checkedPairs.add(pairKey)

      const target = bricksById.get(targetId)
      if (target && areBricksAttached(source, target, context, boundsById)) {
        addUndirectedGraphEdge(attachmentEdges, source.id, target.id)
      }
    }
  }

  return computeConnectedComponentsFromEdges(bricks, attachmentEdges)
}

export const validateBuildPlanBasics = (plan: BuildPlan): BuildPlanIssue[] => {
  const issues: BuildPlanIssue[] = []
  const seenBrickIds = new Set<string>()
  const brickCounts = countBricks(plan)

  for (const brick of plan.bricks) {
    if (seenBrickIds.has(brick.id)) {
      issues.push({ type: 'duplicate-id', brickId: brick.id })
    }
    seenBrickIds.add(brick.id)

    const definition = brickById.get(brick.brickId)
    if (!definition) {
      issues.push({ type: 'unknown-brick', brickId: brick.id })
    } else if (!definition.colors.includes(brick.color)) {
      issues.push({ type: 'invalid-color', brickId: brick.id, color: brick.color })
    }

    const hasInvalidPose =
      !Number.isFinite(brick.pose.xStud) ||
      !Number.isFinite(brick.pose.yStud) ||
      !Number.isFinite(brick.pose.zStud) ||
      !isHorizontalStudOnGrid(brick.pose.xStud) ||
      !isHorizontalStudOnGrid(brick.pose.zStud) ||
      !isYStudOnGrid(brick.pose.yStud) ||
      brick.pose.yStud < 0 ||
      (definition ? !isBrickAboveGround(brick) : false) ||
      ![0, 1, 2, 3].includes(brick.pose.rotationQuarterTurns) ||
      ![0, 1, 2, 3].includes(brick.pose.verticalQuarterTurns ?? 0)
    if (hasInvalidPose) {
      issues.push({ type: 'invalid-pose', brickId: brick.id })
    }
  }

  for (const [brickId, count] of Object.entries(brickCounts)) {
    const definition = brickById.get(brickId)
    if (definition && Number.isFinite(definition.inventory) && count > definition.inventory) {
      issues.push({ type: 'inventory-exceeded', brickId, count, inventory: definition.inventory })
    }
  }

  const brickIds = new Set(plan.bricks.map((brick) => brick.id))
  const assignedBrickIds = new Set<string>()
  for (const step of plan.steps) {
    for (const brickId of step.brickIds) {
      if (!brickIds.has(brickId)) {
        issues.push({ type: 'missing-step-brick', brickId })
      } else {
        assignedBrickIds.add(brickId)
      }
    }
  }
  for (const brickId of brickIds) {
    if (!assignedBrickIds.has(brickId)) {
      issues.push({ type: 'unassigned-step-brick', brickId })
    }
  }

  return issues
}

export const validateBuildPlanStructural = (plan: BuildPlan): BuildPlanIssue[] => {
  const issues: BuildPlanIssue[] = []
  const context = createPlanValidationContext(plan.bricks)
  const buildGraph = createBuildGraph(plan.bricks, context)
  const collisionBoundsById = new Map(
    plan.bricks.flatMap((brick) => {
      const bounds = getBrickCollisionBroadBounds(brick, context)
      return bounds ? [[brick.id, bounds] as const] : []
    }),
  )
  const boundsPairIndex = createGraphPairSpatialIndex(plan.bricks, collisionBoundsById, 0)
  const bricksById = new Map(plan.bricks.map((brick) => [brick.id, brick]))
  const checkedCollisionPairs = new Set<string>()
  for (const source of plan.bricks) {
    for (const targetId of getPotentialBoundsCollisionPairIds(source, collisionBoundsById, boundsPairIndex)) {
      const pairKey = [source.id, targetId].sort().join(':')
      if (checkedCollisionPairs.has(pairKey)) continue
      checkedCollisionPairs.add(pairKey)

      const target = bricksById.get(targetId)
      if (
        target &&
        doBrickStructuralCellsCollide(source, target) &&
        !hasConnectorConnection(source, target, context) &&
        !hasIndirectMechanicalConnectorClearance(source, target, plan.bricks, context)
      ) {
        issues.push({ type: 'collision', brickIds: [source.id, target.id] })
      }
    }
  }

  for (const brick of plan.bricks) {
    if (!isBrickSupported(brick, plan.bricks, buildGraph)) {
      issues.push({ type: 'unsupported', brickId: brick.id })
    }
  }

  const connectedComponents = buildGraph.components
  if (connectedComponents.length > 1) {
    connectedComponents.slice(1).forEach((component, componentOffset) => {
      for (const brick of component) {
        issues.push({
          type: 'disconnected-island',
          brickId: brick.id,
          componentIndex: componentOffset + 2,
          componentCount: connectedComponents.length,
        })
      }
    })
  }

  return issues
}

export const validateBuildPlan = (plan: BuildPlan): BuildPlanIssue[] => [
  ...validateBuildPlanBasics(plan),
  ...validateBuildPlanStructural(plan),
]

type SummaryLocale = 'zh-CN' | 'en-US'

const issueSummaryLabels: Record<SummaryLocale, {
  unknownBrick: string
  invalidColor: string
  inventoryExceeded: string
  invalidPose: string
  duplicateId: string
  missingStepBrick: string
  unassignedStepBrick: string
  independentStructure: string
  collision: string
  unsupported: string
  ok: string
  separator: string
}> = {
  'zh-CN': {
    unknownBrick: '{count} 个未知零件',
    invalidColor: '{count} 个颜色不在库存中',
    inventoryExceeded: '{count} 类零件超过库存',
    invalidPose: '{count} 个坐标或旋转非法',
    duplicateId: '{count} 个重复实例 id',
    missingStepBrick: '{count} 个步骤引用不存在的零件',
    unassignedStepBrick: '{count} 个零件未分配到步骤',
    independentStructure: '{count} 个独立结构',
    collision: '{count} 处砖块重叠',
    unsupported: '{count} 个砖块悬空',
    ok: '未发现结构问题',
    separator: '，',
  },
  'en-US': {
    unknownBrick: '{count} unknown parts',
    invalidColor: '{count} parts use unavailable colors',
    inventoryExceeded: '{count} part types exceed inventory',
    invalidPose: '{count} invalid coordinates or rotations',
    duplicateId: '{count} duplicate instance ids',
    missingStepBrick: '{count} steps reference missing parts',
    unassignedStepBrick: '{count} parts are not assigned to steps',
    independentStructure: '{count} independent structures',
    collision: '{count} brick overlaps',
    unsupported: '{count} floating bricks',
    ok: 'No structure issues found',
    separator: ', ',
  },
}

const formatIssueCount = (template: string, count: number) =>
  template.replace('{count}', String(count))

export const summarizeBuildPlanIssues = (issues: BuildPlanIssue[], locale: SummaryLocale = 'zh-CN') => {
  const labels = issueSummaryLabels[locale]
  const unknownCount = issues.filter((issue) => issue.type === 'unknown-brick').length
  const invalidColorCount = issues.filter((issue) => issue.type === 'invalid-color').length
  const inventoryExceededCount = issues.filter((issue) => issue.type === 'inventory-exceeded').length
  const invalidPoseCount = issues.filter((issue) => issue.type === 'invalid-pose').length
  const duplicateIdCount = issues.filter((issue) => issue.type === 'duplicate-id').length
  const missingStepBrickCount = issues.filter((issue) => issue.type === 'missing-step-brick').length
  const unassignedStepBrickCount = issues.filter((issue) => issue.type === 'unassigned-step-brick').length
  const disconnectedIssues = issues.filter((issue) => issue.type === 'disconnected-island')
  const independentStructureCount = Math.max(1, ...disconnectedIssues.map((issue) => issue.componentCount))
  const collisionCount = issues.filter((issue) => issue.type === 'collision').length
  const unsupportedCount = issues.filter((issue) => issue.type === 'unsupported').length
  const parts = [
    unknownCount ? formatIssueCount(labels.unknownBrick, unknownCount) : '',
    invalidColorCount ? formatIssueCount(labels.invalidColor, invalidColorCount) : '',
    inventoryExceededCount ? formatIssueCount(labels.inventoryExceeded, inventoryExceededCount) : '',
    invalidPoseCount ? formatIssueCount(labels.invalidPose, invalidPoseCount) : '',
    duplicateIdCount ? formatIssueCount(labels.duplicateId, duplicateIdCount) : '',
    missingStepBrickCount ? formatIssueCount(labels.missingStepBrick, missingStepBrickCount) : '',
    unassignedStepBrickCount ? formatIssueCount(labels.unassignedStepBrick, unassignedStepBrickCount) : '',
    independentStructureCount > 1 ? formatIssueCount(labels.independentStructure, independentStructureCount) : '',
    collisionCount ? formatIssueCount(labels.collision, collisionCount) : '',
    unsupportedCount ? formatIssueCount(labels.unsupported, unsupportedCount) : '',
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(labels.separator) : labels.ok
}
