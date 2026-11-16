import { Box3, Matrix4, Ray } from 'three'

type BoundsNode = { bounds: Box3; indices?: number[]; left?: BoundsNode; right?: BoundsNode }
const leafSize = 8

/** Immutable instance broad phase. Results retain source order and exact leaf AABB semantics. */
export const createInstanceBoundsQuery = (bounds: Box3[]) => {
  const build = (indices: number[]): BoundsNode => {
    const envelope = new Box3()
    for (const index of indices) envelope.union(bounds[index])
    if (indices.length <= leafSize) return { bounds: envelope, indices }
    const extent = envelope.max.clone().sub(envelope.min)
    const axis = extent.x >= extent.y && extent.x >= extent.z ? 'x' : extent.y >= extent.z ? 'y' : 'z'
    indices.sort((a, b) => (bounds[a].min[axis] + bounds[a].max[axis]) - (bounds[b].min[axis] + bounds[b].max[axis]))
    const middle = Math.floor(indices.length / 2)
    return { bounds: envelope, left: build(indices.slice(0, middle)), right: build(indices.slice(middle)) }
  }
  const root = build(bounds.map((_, index) => index))
  return (ray: Ray, matrixWorld: Matrix4): number[] => {
    const candidates: number[] = []
    const worldBounds = new Box3()
    const visit = (node: BoundsNode) => {
      if (!ray.intersectsBox(worldBounds.copy(node.bounds).applyMatrix4(matrixWorld))) return
      if (node.indices) {
        for (const index of node.indices) {
          if (ray.intersectsBox(worldBounds.copy(bounds[index]).applyMatrix4(matrixWorld))) candidates.push(index)
        }
      } else {
        visit(node.left!)
        visit(node.right!)
      }
    }
    visit(root)
    return candidates.sort((a, b) => a - b)
  }
}
