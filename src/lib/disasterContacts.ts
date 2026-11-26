import { brickById } from '../data/basicBricks'
import type { BrickDefinition, PlacedBrick } from '../types/bricks'
import { transformBrickLocalPoint } from './brickUnits'
import { getBrickBounds, getMatchedBrickConnectorSites, type BuildGraph } from './planUtils'
import { createConvexHull, type StabilityPoint2, type StabilityPoint3 } from './stabilityAnalysis'
import { getBrickStructuralCells, getBrickWorldSupportFaces, getStructuralCacheVersion } from './structuralGrid'

// Luo et al., Legolization (SIGGRAPH 2015), Table 1 and Appendix A.
const measuredBrickGrams = new Map([
  ['3005', 0.44], ['3004', 0.78], ['3622', 1.18], ['3010', 1.74], ['3009', 2.23], ['3008', 3.08],
  ['3003', 1.18], ['3002', 1.78], ['3001', 2.20], ['2456', 3.28], ['3007', 4.40],
])

export const studPulloutNewtons = 0.702
export const estimatedShearNewtons = 0.7
export const estimatedPlasticFriction = 0.35
export const estimatedBearingNewtonsPerSquareStud = 35
export const gravity = 9.80665
const tolerance = 1e-6
// 0.2 mm allows for rounding and small seating gaps in imported models.
const floorToleranceStuds = 0.025
const minimumBearingWidth = 0.008
const studSeatHalfWidth = 0.4

type MassEstimate = { kilograms: number; localCenter?: StabilityPoint3 }
const massByDefinition = new WeakMap<BrickDefinition, { version: number; estimate: MassEstimate }>()

const estimateMouldMass = (definition: BrickDefinition): MassEstimate => {
  const measured = measuredBrickGrams.get(definition.partNumber)
  if (measured !== undefined) return { kilograms: measured / 1000 }
  const { widthStuds, depthStuds, heightStuds } = definition.footprint
  const boxMass = Math.max(0.05, widthStuds * depthStuds * heightStuds) * 0.00025
  if (definition.pack !== 'lego') return { kilograms: boxMass }

  let volume = 0
  const moments = { x: 0, y: 0, z: 0 }
  for (const cell of getBrickStructuralCells(definition)) {
    if (cell.kind !== 'solid') continue
    const amount = (cell.maxX - cell.minX) * (cell.maxY - cell.minY) * (cell.maxZ - cell.minZ)
    volume += amount
    moments.x += amount * (cell.maxX + cell.minX) / 2
    moments.y += amount * (cell.maxY + cell.minY) / 2
    moments.z += amount * (cell.maxZ + cell.minZ) / 2
  }
  // A geometry-based estimate for hollow pieces. The effective density
  // matches the sampled volume of the weighed 2 × 6 brick (2456).
  const shellMass = volume * 0.00042
  if (volume <= tolerance || shellMass >= boxMass) return { kilograms: boxMass }
  return {
    kilograms: shellMass,
    localCenter: { x: moments.x / volume, y: moments.y / volume, z: moments.z / volume },
  }
}

export const getDisasterMassProperties = (brick: PlacedBrick, fallbackVolume: number, fallbackCenter: StabilityPoint3) => {
  const definition = brickById.get(brick.brickId)
  if (!definition) return { mass: fallbackVolume * 0.00025, center: fallbackCenter }
  const version = getStructuralCacheVersion()
  let cached = massByDefinition.get(definition)
  if (!cached || cached.version !== version) {
    cached = { version, estimate: estimateMouldMass(definition) }
    massByDefinition.set(definition, cached)
  }
  const { kilograms, localCenter } = cached.estimate
  return {
    mass: kilograms,
    center: localCenter ? transformBrickLocalPoint(definition, brick.pose, localCenter) : fallbackCenter,
  }
}

type Site = ReturnType<typeof getMatchedBrickConnectorSites>[number]

export type BearingPatch = {
  height: number
  area: number
  center: StabilityPoint2
  hull: StabilityPoint2[]
}

export type DisasterBond = {
  index: number
  a: number
  b: number
  bearing?: BearingPatch & { upper: number }
  sites: Site[]
  /** Matched vertical stud sites only, close to the contact plane. */
  studs: Site[]
}

const rectangleCorners = (minX: number, maxX: number, minZ: number, maxZ: number) => [
  { x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ },
]

const findBearing = (
  bottomPlanes: ReturnType<typeof getBrickWorldSupportFaces>['bottomPlanes'],
  topPlanes: ReturnType<typeof getBrickWorldSupportFaces>['topPlanes'],
): BearingPatch | undefined => {
  let area = 0
  let xMoment = 0
  let zMoment = 0
  let yMoment = 0
  const corners: StabilityPoint2[] = []
  for (const [key, bottomFaces] of bottomPlanes) {
    const topFaces = topPlanes.get(key) ?? []
    for (const bottom of bottomFaces) {
      for (const top of topFaces) {
        const minX = Math.max(bottom.minX, top.minX)
        const maxX = Math.min(bottom.maxX, top.maxX)
        const minZ = Math.max(bottom.minZ, top.minZ)
        const maxZ = Math.min(bottom.maxZ, top.maxZ)
        if (maxX - minX <= minimumBearingWidth || maxZ - minZ <= minimumBearingWidth) continue
        const faceArea = (maxX - minX) * (maxZ - minZ)
        area += faceArea
        xMoment += faceArea * (minX + maxX) / 2
        zMoment += faceArea * (minZ + maxZ) / 2
        yMoment += faceArea * (bottom.y + top.y) / 2
        corners.push(...rectangleCorners(minX, maxX, minZ, maxZ))
      }
    }
  }
  return area > tolerance ? {
    area,
    height: yMoment / area,
    center: { x: xMoment / area, z: zMoment / area },
    hull: createConvexHull(corners),
  } : undefined
}

export const prepareDisasterContacts = (bricks: PlacedBrick[], graph: BuildGraph) => {
  const indexById = new Map(bricks.map((brick, index) => [brick.id, index]))
  const faces = bricks.map(getBrickWorldSupportFaces)
  const ground = bricks.map((brick, index) => {
    const bounds = getBrickBounds(brick)
    if (!bounds || Math.abs(bounds.minY) > floorToleranceStuds) return undefined
    const points = faces[index].bottom.flatMap((face) =>
      Math.abs(face.y) <= floorToleranceStuds
        ? rectangleCorners(face.minX, face.maxX, face.minZ, face.maxZ)
        : [],
    )
    return createConvexHull(points.length ? points : rectangleCorners(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ))
  })
  const bonds: DisasterBond[] = []
  const neighbors: DisasterBond[][] = bricks.map(() => [])
  for (const [a, brick] of bricks.entries()) {
    for (const id of graph.attachmentEdges.get(brick.id) ?? []) {
      const b = indexById.get(id)
      if (b === undefined || b <= a) continue
      const aOnB = findBearing(faces[a].bottomPlanes, faces[b].topPlanes)
      const bOnA = findBearing(faces[b].bottomPlanes, faces[a].topPlanes)
      let bearing = aOnB && (!bOnA || aOnB.area >= bOnA.area)
        ? { ...aOnB, upper: a }
        : bOnA && { ...bOnA, upper: b }
      const sites = getMatchedBrickConnectorSites(brick, bricks[b])
      const studs = sites.filter(site => site.stud && site.vertical &&
        (!bearing || Math.abs(site.y - bearing.height) < 0.35))
      if (studs.length) {
        const seatCorners = studs.flatMap(({ x, z }) => rectangleCorners(
          x - studSeatHalfWidth, x + studSeatHalfWidth, z - studSeatHalfWidth, z + studSeatHalfWidth,
        ))
        if (bearing) {
          bearing = { ...bearing, hull: createConvexHull([...bearing.hull, ...seatCorners]) }
        } else {
          const boundsA = graph.boundsById.get(brick.id)!
          const boundsB = graph.boundsById.get(bricks[b].id)!
          bearing = {
            upper: boundsA.minY + boundsA.maxY > boundsB.minY + boundsB.maxY ? a : b,
            area: studs.length * (2 * studSeatHalfWidth) ** 2,
            height: studs.reduce((sum, site) => sum + site.y / studs.length, 0),
            center: {
              x: studs.reduce((sum, site) => sum + site.x / studs.length, 0),
              z: studs.reduce((sum, site) => sum + site.z / studs.length, 0),
            },
            hull: createConvexHull(seatCorners),
          }
        }
      }
      if (!bearing && !sites.length) continue
      const bond = { index: bonds.length, a, b, bearing, sites, studs }
      bonds.push(bond)
      neighbors[a].push(bond)
      neighbors[b].push(bond)
    }
  }
  return { ground, bonds, neighbors }
}

type SupportPoint = StabilityPoint2 & { support: number }
type SupportSite = StabilityPoint3 & { support: number }

export type DisasterBearingGeometry = {
  patches: BearingPatch[]
  area: number
  height: number
  center: StabilityPoint2
  hull: SupportPoint[]
  studs: SupportSite[]
}

export const prepareBearingGeometry = (supports: DisasterBond[]): DisasterBearingGeometry => {
  const patches = supports.map(bond => bond.bearing!)
  const area = patches.reduce((sum, patch) => sum + patch.area, 0)
  return {
    patches,
    area,
    height: patches.reduce((sum, patch) => sum + patch.height * patch.area / area, 0),
    center: {
      x: patches.reduce((sum, patch) => sum + patch.center.x * patch.area / area, 0),
      z: patches.reduce((sum, patch) => sum + patch.center.z * patch.area / area, 0),
    },
    hull: createConvexHull(patches.flatMap((patch, support) =>
      patch.hull.map(point => ({ ...point, support })),
    )),
    studs: supports.flatMap((bond, support) => bond.studs.map(site => ({ ...site, support }))),
  }
}

type BoundaryHit = { distance: number; from: SupportPoint; to: SupportPoint; fraction: number }

/** Last intersection between a ray and the closed, counterclockwise support hull. */
const getBoundaryHit = (
  hull: SupportPoint[],
  start: StabilityPoint2,
  dx: number,
  dz: number,
): BoundaryHit | undefined => {
  let hit: BoundaryHit | undefined
  let entry = 0
  for (let i = 0; i < hull.length; i += 1) {
    const from = hull[i]
    const to = hull[(i + 1) % hull.length]
    const edgeX = to.x - from.x
    const edgeZ = to.z - from.z
    const denominator = edgeZ * dx - edgeX * dz
    const offset = edgeX * (start.z - from.z) - edgeZ * (start.x - from.x)
    if (denominator < -tolerance) {
      entry = Math.max(entry, offset / denominator)
      continue
    }
    if (denominator <= tolerance) {
      if (offset < -tolerance) return undefined
      continue
    }
    const distance = offset / denominator
    if (distance >= (hit?.distance ?? Infinity)) continue
    const fraction = ((start.x + dx * distance - from.x) * edgeX +
      (start.z + dz * distance - from.z) * edgeZ) / (edgeX ** 2 + edgeZ ** 2)
    hit = { distance, from, to, fraction: Math.max(0, Math.min(1, fraction)) }
  }
  return hit && hit.distance >= entry - tolerance ? hit : undefined
}

export type BearingReaction = {
  normal: number
  xMoment: number
  zMoment: number
  pressure: number
  maxStudTension: number
  requiresTie: boolean
}

export const solveBearingReactions = (
  geometry: DisasterBearingGeometry,
  normal: number,
  xMoment: number,
  zMoment: number,
): BearingReaction[] => {
  const { center, hull, studs, patches, area } = geometry
  const reactions = patches.map(() => ({ normal: 0, xMoment: 0, zMoment: 0, pressure: 0, maxStudTension: 0, requiresTie: false }))
  const add = (support: number, point: StabilityPoint2, force: number) => {
    const result = reactions[support]
    result.normal += force
    result.xMoment += force * point.x
    result.zMoment += force * point.z
    if (force > 0) result.pressure += force
  }
  const addTension = (sites: SupportSite[], force: number, existingPerStud: number) => {
    const perSite = force / sites.length
    for (const site of sites) {
      add(site.support, site, -perSite)
      reactions[site.support].maxStudTension = Math.max(
        reactions[site.support].maxStudTension, existingPerStud + perSite,
      )
    }
  }
  // If the net load lifts the brick, the studs first carry that uplift.
  const uplift = studs.length ? Math.max(0, -normal) : 0
  const studCenter = studs.length ? {
    x: studs.reduce((sum, site) => sum + site.x, 0) / studs.length,
    z: studs.reduce((sum, site) => sum + site.z, 0) / studs.length,
  } : center
  if (uplift) addTension(studs, uplift, 0)

  const pressure = Math.max(0, normal)
  const residualX = xMoment + uplift * studCenter.x - pressure * center.x
  const residualZ = zMoment + uplift * studCenter.z - pressure * center.z
  const moment = Math.hypot(residualX, residualZ)
  const ux = moment > tolerance ? residualX / moment : 0
  const uz = moment > tolerance ? residualZ / moment : 0
  const boundary = getBoundaryHit(hull, center, ux, uz)
  const edgeMoment = Math.max(0, boundary?.distance ?? 0) * pressure
  const addBearingPressure = () => {
    const toEdge = edgeMoment > tolerance ? Math.min(1, moment / edgeMoment) : Number(Boolean(boundary && moment > tolerance))
    for (const [index, patch] of patches.entries()) {
      add(index, patch.center, pressure * (1 - toEdge) * patch.area / area)
    }
    if (boundary) {
      add(boundary.from.support, boundary.from, pressure * toEdge * (1 - boundary.fraction))
      add(boundary.to.support, boundary.to, pressure * toEdge * boundary.fraction)
    }
  }
  if (moment <= edgeMoment + tolerance && normal >= -uplift - tolerance) {
    addBearingPressure()
    return reactions
  }

  const siteProjection = (site: StabilityPoint2) => (site.x - center.x) * ux + (site.z - center.z) * uz
  if (studs.length) {
    const trailing = Math.min(...studs.map(siteProjection))
    const ties = studs.filter(site => siteProjection(site) <= trailing + 0.15)
    const tieCenter = {
      x: ties.reduce((sum, site) => sum + site.x, 0) / ties.length,
      z: ties.reduce((sum, site) => sum + site.z, 0) / ties.length,
    }
    const dx = residualX + pressure * (center.x - tieCenter.x)
    const dz = residualZ + pressure * (center.z - tieCenter.z)
    const momentArmDemand = Math.hypot(dx, dz)
    const lever = getBoundaryHit(hull, tieCenter, dx, dz)
    // A stud row sitting right on the overturning edge (physical lever arm < 0.15 studs)
    // cannot form a meaningful resisting couple; treat it as an unresolved tie instead
    // of dividing by a near-zero lever arm and inventing megaton reactions.
    const physicalLeverArm = lever ? lever.distance * momentArmDemand : 0
    if (lever && lever.distance > tolerance && physicalLeverArm >= 0.15) {
      const compression = Math.max(pressure, 1 / lever.distance)
      const extraTension = compression - pressure
      addTension(ties, extraTension, uplift / studs.length)
      add(lever.from.support, lever.from, compression * (1 - lever.fraction))
      add(lever.to.support, lever.to, compression * lever.fraction)
      return reactions
    }
  }

  // Report the missing resisting couple. Only forward the positive pressure
  // that these faces can actually deliver, never an invented tensile reaction.
  addBearingPressure()
  let trailing = 0
  for (let index = 1; index < patches.length; index += 1) {
    if (siteProjection(patches[index].center) < siteProjection(patches[trailing].center)) trailing = index
  }
  reactions[trailing].requiresTie = true
  return reactions
}
