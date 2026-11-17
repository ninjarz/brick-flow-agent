import { Matrix3, Matrix4, Vector3 } from 'three'
import { brickById } from '../data/basicBricks'
import type { BuildPlan, BuildStep, ConstructionAssembly, ConstructionGroup, PlacedBrick } from '../types/bricks'
import { getBrickBounds } from './planUtils'
import { brickPoseFromRigidMatrix, getRigidBrickMatrix, normalizeRigidOrientation } from './rigidBrickTransform'

export type CompiledConstructionScene = {
  groups: { assemblyId: string; matrix: number[] }[]
  adjustments: { brickId: string; matrix: number[] }[]
  hiddenPrintBrickIds: string[]
  focusBrickIds: string[]
}

const withMatrix = (brick: PlacedBrick, matrix: Matrix4): PlacedBrick => {
  const definition = brickById.get(brick.brickId)
  if (!definition) throw new Error('CONSTRUCTION_UNKNOWN_MOULD')
  return { ...brick, pose: brickPoseFromRigidMatrix(definition, matrix) }
}

/** A proper rotation puts the documented base axes on the worktable, including flips. */
const tableRotation = (base: Matrix4 | undefined, flip = false) => {
  if (!base) return new Matrix4()
  const source = new Matrix3().setFromMatrix4(base).elements
  const orientation = normalizeRigidOrientation([source[0], source[3], source[6], source[1], source[4], source[7], source[2], source[5], source[8]])
  const x = new Vector3(orientation[0], orientation[3], orientation[6])
  const y = new Vector3(orientation[1], orientation[4], orientation[7]).multiplyScalar(flip ? -1 : 1)
  const z = new Vector3().crossVectors(x, y)
  const rotation = new Matrix4().set(x.x,x.y,x.z,0, y.x,y.y,y.z,0, z.x,z.y,z.z,0, 0,0,0,1)
  return rotation.multiply(new Matrix4().makeTranslation(-base.elements[12], -base.elements[13], -base.elements[14]))
}

/** Compilation and playback share these transforms across the viewport and exports. */
export const createConstructionSceneBuilder = (plan: BuildPlan) => {
  const byId = new Map(plan.bricks.map(brick => [brick.id, brick]))
  const matrices = new Map<string, Matrix4>()
  const matrixFor = (brick: PlacedBrick) => {
    let matrix = matrices.get(brick.id)
    if (!matrix) {
      const definition = brickById.get(brick.brickId)
      if (!definition) throw new Error('CONSTRUCTION_UNKNOWN_MOULD')
      matrix = getRigidBrickMatrix(definition, brick.pose)
      matrices.set(brick.id, matrix)
    }
    return matrix
  }

  return (step: BuildStep, completedIds: Pick<ReadonlySet<string>, 'has'>) => {
    const construction = step.construction
    const assemblies = plan.constructionAssemblies
    if (!construction || !assemblies) return undefined
    const groups: ConstructionGroup[] = construction.groups ?? [construction]
    if (groups.some(group => !assemblies[group.assemblyId] || group.baseBrickId && !byId.has(group.baseBrickId))) return undefined
    const adjustments = new Map<string, Matrix4>()
    for (const adjustment of construction.adjustments ?? []) {
      const anchor = byId.get(adjustment.anchorBrickId)
      if (!anchor || !byId.has(adjustment.brickId)) return undefined
      const reference = matrixFor(anchor)
      adjustments.set(adjustment.brickId, reference.clone().multiply(new Matrix4().fromArray(adjustment.matrix)).multiply(reference.clone().invert()))
    }
    const scene: CompiledConstructionScene = {
      groups: [],
      adjustments: [...adjustments].map(([brickId, matrix]) => ({ brickId, matrix: matrix.toArray() })),
      hiddenPrintBrickIds: construction.hiddenPrintBrickIds ?? [],
      focusBrickIds: construction.focusBrickIds ?? step.brickIds,
    }
    const parts: PlacedBrick[] = []
    const displayed = new Set<string>()
    let offsetX = 0
    for (const group of groups) {
      const members = assemblies[group.assemblyId].brickIds.filter(id => completedIds.has(id) && byId.has(id)).map(id => byId.get(id)!)
      if (!members.length) continue
      if (members.some(brick => displayed.has(brick.id))) throw new Error('CONSTRUCTION_DUPLICATE_GROUP_MEMBER')
      const base = group.baseBrickId ? byId.get(group.baseBrickId) : undefined
      const rotation = tableRotation(base ? matrixFor(base) : undefined, group.flip)
      const prepared = members.map(brick => {
        const matrix = matrixFor(brick).clone()
        const adjustment = adjustments.get(brick.id)
        if (adjustment) matrix.premultiply(adjustment)
        return withMatrix(brick, matrix.premultiply(rotation))
      })
      const bounds = prepared.map(getBrickBounds)
      if (bounds.some(bound => !bound)) throw new Error('CONSTRUCTION_MISSING_BOUNDS')
      const minX = Math.min(...bounds.map(bound => bound!.minX))
      const minY = Math.min(...bounds.map(bound => bound!.minY))
      const minZ = Math.min(...bounds.map(bound => bound!.minZ))
      const maxX = Math.max(...bounds.map(bound => bound!.maxX))
      const placement = new Matrix4().makeTranslation(offsetX - minX, -minY, -minZ)
      scene.groups.push({ assemblyId: group.assemblyId, matrix: placement.clone().multiply(rotation).toArray() })
      for (const brick of prepared) {
        const definition = brickById.get(brick.brickId)!
        parts.push(withMatrix(brick, getRigidBrickMatrix(definition, brick.pose).premultiply(placement)))
        displayed.add(brick.id)
      }
      offsetX += maxX - minX + 2
    }
    return { scene, bricks: parts }
  }
}

export const createConstructionReplay = (bricks: PlacedBrick[], assemblies: Record<string, ConstructionAssembly>) => {
  const byId = new Map(bricks.map(brick => [brick.id, brick]))
  const matrices = new Map<string, Matrix4>()
  return (scene: CompiledConstructionScene, completedIds: Pick<ReadonlySet<string>, 'has'>) => {
    const adjustments = new Map(scene.adjustments.map(adjustment => [adjustment.brickId, new Matrix4().fromArray(adjustment.matrix)]))
    return scene.groups.flatMap(group => {
      const transform = new Matrix4().fromArray(group.matrix)
      return (assemblies[group.assemblyId]?.brickIds ?? []).filter(id => completedIds.has(id) && byId.has(id)).map(id => {
        const brick = byId.get(id)!
        let source = matrices.get(id)
        if (!source) { source = getRigidBrickMatrix(brickById.get(brick.brickId)!, brick.pose); matrices.set(id, source) }
        const matrix = source.clone()
        const adjustment = adjustments.get(id)
        if (adjustment) matrix.premultiply(adjustment)
        return withMatrix(brick, matrix.premultiply(transform))
      })
    })
  }
}

export const replayConstructionScene = (bricks: PlacedBrick[], assemblies: Record<string, ConstructionAssembly>, scene: CompiledConstructionScene, completedIds: Pick<ReadonlySet<string>, 'has'>) =>
  createConstructionReplay(bricks, assemblies)(scene, completedIds)
