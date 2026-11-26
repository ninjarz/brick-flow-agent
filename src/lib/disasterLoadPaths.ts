import {
  estimatedBearingNewtonsPerSquareStud,
  estimatedPlasticFriction,
  estimatedShearNewtons,
  prepareBearingGeometry,
  solveBearingReactions,
  studPulloutNewtons,
  type DisasterBond,
} from './disasterContacts'
import { createConvexHull, type StabilityPoint2 } from './stabilityAnalysis'

const epsilon = 1e-6

export type DisasterWrench = {
  weight: number
  weightX: number
  weightZ: number
  lateral: number
  lateralX: number
  lateralY: number
  lateralZ: number
  unresolved: boolean
}

export const createDisasterWrench = (): DisasterWrench => ({
  weight: 0, weightX: 0, weightZ: 0, lateral: 0, lateralX: 0, lateralY: 0, lateralZ: 0,
  unresolved: false,
})

export const addDisasterWrench = (target: DisasterWrench, load: DisasterWrench, share = 1) => {
  target.weight += share * load.weight
  target.weightX += share * load.weightX
  target.weightZ += share * load.weightZ
  target.lateral += share * load.lateral
  target.lateralX += share * load.lateralX
  target.lateralY += share * load.lateralY
  target.lateralZ += share * load.lateralZ
  target.unresolved ||= share > epsilon && load.unresolved
}

export type DisasterSupport = {
  bond: DisasterBond
  target: number
}

type LoadRoute = {
  supports: DisasterSupport[]
  joints: DisasterSupport[]
  geometry?: ReturnType<typeof prepareBearingGeometry>
}

const otherEnd = (bond: DisasterBond, index: number) => bond.a === index ? bond.b : bond.a

export const createDisasterLoadPaths = (
  neighbors: DisasterBond[][],
  ground: Array<StabilityPoint2[] | undefined>,
  heights: number[],
  failed: Uint8Array,
  broken: Uint8Array,
  previousRoutes?: LoadRoute[],
) => {
  // Across a direct bearing surface, load can travel down for free. A side
  // joint or a reversed, tensile attachment adds a step to the path.
  const rank = new Int32Array(neighbors.length).fill(-1)
  const buckets: number[][] = [[]]
  for (const [index, hull] of ground.entries()) {
    if (hull && !failed[index]) {
      buckets[0].push(index)
      rank[index] = 0
    }
  }
  const carriesDown = (bond: DisasterBond, upper: number, lower: number) =>
    bond.bearing?.upper === upper && heights[upper] > heights[lower] + epsilon

  for (let depth = 0; depth < buckets.length; depth += 1) {
    const queue = buckets[depth]
    for (let i = 0; i < queue.length; i += 1) {
      const index = queue[i]
      if (rank[index] !== depth) continue
      for (const bond of neighbors[index]) {
        const target = otherEnd(bond, index)
        if (broken[bond.index] || failed[target]) continue
        const bearing = carriesDown(bond, target, index)
        if (!bearing && !bond.sites.length) continue
        const next = depth + Number(!bearing)
        if (rank[target] >= 0 && rank[target] <= next) continue
        rank[target] = next
        buckets[next] ??= []
        buckets[next].push(target)
      }
    }
  }

  const order = [...rank.keys()].filter(index => rank[index] >= 0)
    .sort((a, b) => rank[b] - rank[a] || heights[b] - heights[a] || a - b)
  const routes = neighbors.map((bonds, index): LoadRoute => {
    const bearing: DisasterSupport[] = []
    const joints: DisasterSupport[] = []
    if (rank[index] < 0 || ground[index]) return { supports: [], joints: [] }
    for (const bond of bonds) {
      if (broken[bond.index]) continue
      const target = otherEnd(bond, index)
      if (rank[target] < 0) continue
      if (rank[target] <= rank[index] && carriesDown(bond, index, target)) {
        bearing.push({ bond, target })
        if (bond.sites.length > bond.studs.length) joints.push({ bond, target })
      } else if (bond.sites.length && (rank[target] < rank[index] ||
        (rank[target] === rank[index] && heights[target] < heights[index] - epsilon))) {
        joints.push({ bond, target })
      }
    }
    if (bearing.length) {
      const previous = previousRoutes?.[index]
      const geometry = previous?.geometry && previous.supports.length === bearing.length &&
        previous.supports.every(({ bond }, offset) => bond === bearing[offset].bond)
        ? previous.geometry
        : prepareBearingGeometry(bearing.map(({ bond }) => bond))
      return { supports: bearing, joints, geometry }
    }
    return { supports: joints, joints: [] }
  })

  const visited = new Uint8Array(neighbors.length)
  const components: Array<{ members: number[]; hull: StabilityPoint2[] }> = []
  for (const start of order) {
    if (visited[start]) continue
    const members = [start]
    visited[start] = 1
    for (let i = 0; i < members.length; i += 1) {
      for (const bond of neighbors[members[i]]) {
        const next = otherEnd(bond, members[i])
        if (broken[bond.index] || visited[next] || rank[next] < 0) continue
        visited[next] = 1
        members.push(next)
      }
    }
    components.push({ members, hull: createConvexHull(members.flatMap(index => ground[index] ?? [])) })
  }
  return { rank, order, routes, components }
}

export type DisasterConnectionDemand = {
  support: DisasterSupport
  utilization: number
  overturning: boolean
  compressionLimited: boolean
  pivot: StabilityPoint2 & { y: number }
  outward: StabilityPoint2
  unverified: boolean
}

type TransferWrench = (target: number, load: DisasterWrench, share: number) => void

const solveSupportRoute = (
  route: LoadRoute,
  load: DisasterWrench,
  direction: StabilityPoint2,
  transfer: TransferWrench,
): DisasterConnectionDemand | undefined => {
  const { geometry, supports } = route
  if (!supports.length) return undefined
  let peak: DisasterConnectionDemand | undefined
  const momentAt = (point: StabilityPoint2 & { y: number }) => ({
    x: load.weightX - point.x * load.weight + direction.x * (load.lateralY - point.y * load.lateral),
    z: load.weightZ - point.z * load.weight + direction.z * (load.lateralY - point.y * load.lateral),
    yaw: direction.x * (load.lateralZ - point.z * load.lateral) -
      direction.z * (load.lateralX - point.x * load.lateral),
  })

  if (!geometry) {
    const totalSites = supports.reduce((sum, { bond }) => sum + bond.sites.length, 0)
    for (const support of supports) {
      const { sites } = support.bond
      const pivot = {
        x: sites.reduce((sum, site) => sum + site.x / sites.length, 0),
        y: sites.reduce((sum, site) => sum + site.y / sites.length, 0),
        z: sites.reduce((sum, site) => sum + site.z / sites.length, 0),
      }
      const share = sites.length / totalSites
      const force = Math.hypot(load.weight, load.lateral) * share
      const moment = momentAt(pivot)
      const lever = sites.reduce((max, site) => Math.max(max, Math.hypot(
        site.x - pivot.x, site.y - pivot.y, site.z - pivot.z,
      ) + 0.22), 0.22)
      const momentForce = Math.hypot(moment.x, moment.z, moment.yaw) * share / lever
      const utilization = Math.hypot(force, momentForce) / (sites.length * estimatedShearNewtons)
      if (!peak || utilization > peak.utilization) {
        peak = {
          support, utilization, overturning: momentForce > force, compressionLimited: false, pivot, outward: moment,
          unverified: utilization >= 1,
        }
      }
      transfer(support.target, load, share)
    }
    return peak
  }

  const center = { ...geometry.center, y: geometry.height }
  const moment = momentAt(center)
  const reactions = solveBearingReactions(geometry, load.weight,
    moment.x + center.x * load.weight, moment.z + center.z * load.weight,
  )
  const grips = supports.map(({ bond }, index) =>
    bond.studs.length * estimatedShearNewtons + reactions[index].pressure * estimatedPlasticFriction,
  )
  const totalGrip = grips.reduce((sum, grip) => sum + grip, 0)
  const unresolvedMoment = reactions.some(reaction => reaction.requiresTie)

  for (const [index, support] of supports.entries()) {
    const patch = geometry.patches[index]
    const reaction = reactions[index]
    const grip = grips[index]
    const share = totalGrip > epsilon ? grip / totalGrip : patch.area / geometry.area
    const lever = patch.hull.reduce((max, point) => Math.max(max, Math.hypot(
      point.x - center.x, point.z - center.z,
    )), 0.22)
    const lateralDemand = Math.abs(load.lateral) * share + Math.abs(moment.yaw) * share / lever
    const hasGrip = support.bond.studs.length > 0 ? grip > epsilon : grip > 0.01
    const shear = lateralDemand <= epsilon ? 0 : hasGrip ? lateralDemand / grip : 1
    const pullout = reaction.maxStudTension / studPulloutNewtons
    const compression = reaction.pressure / (patch.area * estimatedBearingNewtonsPerSquareStud)
    const utilization = Math.max(compression, Math.hypot(shear, pullout))
    const unverified = reaction.requiresTie || (!hasGrip && lateralDemand > epsilon) || (utilization >= 1 && (load.unresolved || !support.bond.studs.length))

    if (!peak || (unverified ? Math.max(1, utilization) : utilization) >
      (peak.unverified ? Math.max(1, peak.utilization) : peak.utilization)) {
      const onLever = patch.hull.reduce((best, point) => (
        (point.x - best.x) * moment.x + (point.z - best.z) * moment.z > 0 ? point : best
      ), patch.center)
      peak = {
        support,
        utilization,
        overturning: reaction.requiresTie || pullout > shear,
        compressionLimited: !reaction.requiresTie && compression > Math.hypot(shear, pullout),
        pivot: { ...onLever, y: patch.height },
        outward: moment,
        unverified,
      }
    }

    if (supports.length === 1 && !unresolvedMoment) {
      transfer(support.target, load, 1)
    } else {
      transfer(support.target, {
        weight: reaction.normal,
        weightX: reaction.xMoment,
        weightZ: reaction.zMoment,
        lateral: load.lateral * share,
        lateralX: load.lateralX * share,
        lateralY: load.lateral * geometry.height * share,
        lateralZ: load.lateralZ * share,
        unresolved: unresolvedMoment || load.unresolved,
      }, 1)
    }
  }
  return peak
}

export const resolveDisasterSupports = (
  route: LoadRoute,
  load: DisasterWrench,
  direction: StabilityPoint2,
  downstream: DisasterWrench[],
) => {
  const transfer: TransferWrench = (target, wrench, share) => addDisasterWrench(downstream[target], wrench, share)
  if (!route.joints.length) return solveSupportRoute(route, load, direction, transfer)

  // A seated brick can also be held by a clip, side stud or neighboring
  // assembly. Try that independent path before declaring the seat failed.
  const reactions: Array<Parameters<TransferWrench>> = []
  const bearing = solveSupportRoute(route, load, direction, (...reaction) => reactions.push(reaction))
  if (bearing && (bearing.unverified || bearing.utilization >= 1)) {
    const jointReactions: typeof reactions = []
    const joint = solveSupportRoute({ supports: route.joints, joints: [] }, load, direction,
      (...reaction) => jointReactions.push(reaction))
    if (joint && !joint.unverified && (bearing.unverified || joint.utilization < bearing.utilization)) {
      for (const reaction of jointReactions) transfer(...reaction)
      return joint
    }
  }
  for (const reaction of reactions) transfer(...reaction)
  return bearing
}
