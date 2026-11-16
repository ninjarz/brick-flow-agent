import { Matrix4 } from 'three'

/** Factor a shared affine transform out of immutable instance matrices. */
export const getSharedBatchTransform = (current: Matrix4[], previous: Matrix4[]) => {
  if (!current.length || current.length !== previous.length || previous[0].determinant() === 0) return undefined
  const delta = new Matrix4().multiplyMatrices(current[0], previous[0].clone().invert())
  const transformed = new Matrix4()
  const matches = current.every((matrix, index) => {
    transformed.multiplyMatrices(delta, previous[index])
    return matrix.elements.every((value, axis) => Math.abs(value - transformed.elements[axis]) < 1e-10)
  })
  return matches ? delta : undefined
}

type ChunkInstance = { id: string; matrix: Matrix4 }

/** Preserve spatial membership while every member undergoes the same rigid edit. */
export const getRigidChunkAssignments = (current: ChunkInstance[], previous: Array<ChunkInstance & { chunk: string }>) => {
  if (!current.length || current.length !== previous.length) return undefined
  const byId = new Map(previous.map(item => [item.id, item]))
  if (byId.size !== previous.length || new Set(current.map(item => item.id)).size !== current.length) return undefined
  const old = current.map(item => byId.get(item.id))
  if (old.some(item => !item)) return undefined
  if (!getSharedBatchTransform(current.map(item => item.matrix), old.map(item => item!.matrix))) return undefined
  return new Map(previous.map(item => [item.id, item.chunk]))
}
