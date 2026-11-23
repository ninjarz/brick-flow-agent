import { Matrix4, Vector3 } from 'three'
import type { PlacedBrick } from '../types/bricks'
import { getSharedBatchTransform, getRigidChunkAssignments } from './sharedBatchTransform'
import { yieldToBrowser } from './yieldToBrowser'

export type LDrawLineSource = { brick: PlacedBrick; points: number[]; matrix: Matrix4 }
export type LDrawLineGroup = { color: string; items: LDrawLineSource[]; length: number; rigid?: boolean }
export type LDrawLineBatch = { key: string; color: string; points: Float32Array; transform?: Matrix4; sources: LDrawLineSource[]; rigid?: boolean }

function* generateLines(lines: Map<string, LDrawLineGroup>, previous: LDrawLineBatch[]): Generator<LDrawLineBatch | undefined> {
  const previousLines = new Map(previous.map(batch => [batch.key, batch]))
  const previousLinesBySources = new Map(previous.map(batch => [JSON.stringify([batch.color, batch.sources.map(source => source.brick.id)]), batch]))
  const rigidChunks = new Map<string, string>()
  const kinds = new Set([...lines].filter(([, group]) => group.rigid).map(([key]) => key.split(':')[0]))
  for (const kind of kinds) {
    const assignments = getRigidChunkAssignments(
      [...lines].filter(([key, group]) => group.rigid && key.startsWith(`${kind}:`)).flatMap(([, group]) => group.items.map(item => ({ id: item.brick.id, matrix: item.matrix }))),
      previous.filter(batch => batch.rigid && batch.key.startsWith(`${kind}:`)).flatMap(batch => batch.sources.map(item => ({ id: item.brick.id, matrix: item.matrix, chunk: batch.key }))),
    )
    for (const [id, chunk] of assignments ?? []) rigidChunks.set(`${kind}:${id}`, chunk)
  }
  const chunks = new Map<string, LDrawLineGroup>()
  for (const [spatialKey, group] of lines) for (const item of group.items) {
    const key = group.rigid ? rigidChunks.get(`${spatialKey.split(':')[0]}:${item.brick.id}`) ?? spatialKey : spatialKey
    const chunk = chunks.get(key) ?? { color: group.color, rigid: group.rigid, items: [], length: 0 }
    chunk.items.push(item)
    chunk.length += item.points.length
    chunks.set(key, chunk)
  }
  const rigidOrder = new Map(previous.filter(batch => batch.rigid).flatMap(batch => batch.sources.map((item, index) => [`${batch.key.split(':')[0]}:${item.brick.id}`, index] as const)))
  for (const [key, group] of chunks) {
    const kind = key.split(':')[0]
    if (group.rigid && rigidChunks.has(`${kind}:${group.items[0].brick.id}`)) {
      group.items.sort((a, b) => rigidOrder.get(`${kind}:${a.brick.id}`)! - rigidOrder.get(`${kind}:${b.brick.id}`)!)
    }
  }
  const point = new Vector3()
  let sliceStart = performance.now()
  for (const [key, group] of chunks) {
    const cached = previousLinesBySources.get(JSON.stringify([group.color, group.items.map(item => item.brick.id)])) ?? previousLines.get(key)
    if (cached?.sources.length === group.items.length && group.items.every((item, i) => item.brick === cached.sources[i].brick && item.points === cached.sources[i].points)) { yield cached.key === key && cached.rigid === group.rigid ? cached : { ...cached, key, rigid: group.rigid }; continue }
    if (cached?.sources.length === group.items.length && group.items.every((item, i) => item.brick.id === cached.sources[i].brick.id && item.points === cached.sources[i].points)) {
      const delta = getSharedBatchTransform(group.items.map(item => item.matrix), cached.sources.map(item => item.matrix))
      if (delta) { yield { ...cached, key, rigid: group.rigid, sources: group.items, transform: delta.multiply(cached.transform ?? new Matrix4()) }; continue }
    }
    const points = new Float32Array(group.length)
    let offset = 0
    for (const item of group.items) for (let i = 0; i < item.points.length; i += 3) {
      point.fromArray(item.points, i).applyMatrix4(item.matrix)
      points[offset] = point.x
      points[offset + 1] = point.y
      points[offset + 2] = point.z
      offset += 3
      if (i % 12288 === 0 && performance.now() - sliceStart >= 8) { yield undefined; sliceStart = performance.now() }
    }
    yield { key, color: group.color, points, sources: group.items, rigid: group.rigid }
  }
}

export const mergeLDrawLineBatches = (lines: Map<string, LDrawLineGroup>, previous: LDrawLineBatch[] = []) =>
  [...generateLines(lines, previous)].filter((batch): batch is LDrawLineBatch => Boolean(batch))

export const prepareLDrawLineBatches = async (lines: Map<string, LDrawLineGroup>, onProgress?: (fraction: number) => void, canceled: () => boolean = () => false) => {
  const result: LDrawLineBatch[] = []
  let sliceStart = performance.now()
  for (const batch of generateLines(lines, [])) {
    if (canceled()) return []
    if (batch) { result.push(batch); onProgress?.(result.length / Math.max(1, lines.size)) }
    if (!batch || performance.now() - sliceStart >= 8) { await yieldToBrowser(); sliceStart = performance.now() }
  }
  return result
}
