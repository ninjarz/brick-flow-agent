import { BoxGeometry, BufferGeometry, Color, DoubleSide, FrontSide, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Intersection, type Raycaster } from 'three'
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh'
import { brickById, colorHex, colorOpacity } from '../data/basicBricks'
import type { BrickDefinition, PlacedBrick } from '../types/bricks'
import { mergeLDrawPrintBatches, type LDrawPrintBatch } from './ldrawPrintBatches'
import { getBrickWorldFrame } from './brickUnits'
import { getBrickWorldBoundsFrame } from './ldrawBounds'
import { getLDrawEdgePoints } from './ldrawEdgePoints'
import { createLoadedLDrawBodyGeometry, createLDrawPrintGeometries } from './ldrawVisualGeometry'

const mirrorX = new Matrix4().makeScale(-1, 1, 1)
const reflected = new WeakMap<BufferGeometry, BufferGeometry>()
const box = new BoxGeometry(1, 1, 1)
const boxEdges = getLDrawEdgePoints(box)
const edgeChunkSize = 16
const matrices = new WeakMap<BrickDefinition, WeakMap<PlacedBrick, Matrix4>>()

/** Exactly the same nested yaw / pitch / roll / source matrix as BrickPoseRotation. */
export const getLDrawSceneMatrix = (definition: BrickDefinition, brick: PlacedBrick) => {
  let byBrick = matrices.get(definition)
  if (!byBrick) { byBrick = new WeakMap(); matrices.set(definition, byBrick) }
  const cached = byBrick.get(brick)
  if (cached) return cached
  const frame = getBrickWorldFrame(definition, brick.pose)
  const { pose } = brick
  const matrix = new Matrix4().makeTranslation(frame.x, frame.y, frame.z)
  matrix.multiply(new Matrix4().makeRotationY(-pose.rotationQuarterTurns * Math.PI / 2))
  matrix.multiply(new Matrix4().makeRotationX(-(pose.verticalQuarterTurns ?? 0) * Math.PI / 2))
  matrix.multiply(new Matrix4().makeRotationZ((pose.rollQuarterTurns ?? 0) * Math.PI / 2))
  const m = pose.orientationMatrix
  if (m) matrix.multiply(new Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1))
  byBrick.set(brick, matrix)
  return matrix
}

// InstancedMesh does not support negative determinants. Reflect the shared mould
// once and reverse its winding, then give every instance a positive transform.
export const getPositiveLDrawGeometry = (geometry: BufferGeometry, matrix: Matrix4) => {
  if (matrix.determinant() >= 0) return { geometry, matrix }
  let mirrored = reflected.get(geometry)
  if (!mirrored) {
    mirrored = geometry.clone().applyMatrix4(mirrorX)
    const indices = geometry.index?.array ?? Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i)
    const reversed: number[] = []
    for (let i = 0; i < indices.length; i += 3) reversed.push(indices[i], indices[i + 2], indices[i + 1])
    mirrored.setIndex(reversed)
    reflected.set(geometry, mirrored)
  }
  return { geometry: mirrored, matrix: matrix.clone().multiply(mirrorX) }
}

export type LDrawBatchInstance = { brick: PlacedBrick; matrix: Matrix4; color: string }
export type LDrawMeshBatch = { key: string; geometry: BufferGeometry; instances: LDrawBatchInstance[]; print: boolean; doubleSide: boolean }
export type LDrawLineBatch = { key: string; color: string; points: Float32Array; sources: { brick: PlacedBrick; points: number[] }[] }

export type LDrawSceneBatches = { meshBatches: LDrawMeshBatch[]; printBatches: LDrawPrintBatch[]; lineBatches: LDrawLineBatch[]; individualBricks: PlacedBrick[]; printSources: LDrawMeshBatch[] }

type Options = {
  selectedId?: string
  highlightedIds: Set<string>
  supportedByBrickId: Map<string, boolean>
  displayColorByBrickId?: Map<string, string>
  excludedIds: Set<string>
  showEdges: boolean
}

export const buildLDrawSceneBatches = (bricks: PlacedBrick[], options: Options, previous?: LDrawSceneBatches): LDrawSceneBatches => {
  const groups = new Map<string, LDrawMeshBatch>()
  const lines = new Map<string, { color: string; items: { points: number[]; matrix: Matrix4; brick: PlacedBrick }[]; length: number }>()
  const individualBricks: PlacedBrick[] = []
  const appendLines = (key: string, color: string, points: number[], matrix: Matrix4, brick: PlacedBrick) => {
    const group = lines.get(key) ?? { color, items: [], length: 0 }
    group.items.push({ points, matrix, brick }); group.length += points.length
    lines.set(key, group)
  }
  const addMesh = (geometry: BufferGeometry, matrix: Matrix4, brick: PlacedBrick, color: string, print: boolean, doubleSide: boolean) => {
    const positive = getPositiveLDrawGeometry(geometry, matrix)
    const key = `${positive.geometry.uuid}:${print}:${doubleSide}`
    const group = groups.get(key) ?? { key, geometry: positive.geometry, instances: [], print, doubleSide }
    group.instances.push({ brick, matrix: positive.matrix, color }); groups.set(key, group)
  }
  for (const brick of bricks) {
    const definition = brickById.get(brick.brickId)
    const body = definition?.pack === 'lego' ? createLoadedLDrawBodyGeometry(definition.partNumber, definition.footprint) : undefined
    const prints = definition && body ? createLDrawPrintGeometries(definition.partNumber, definition.footprint) : []
    // Preserve the original sorted transparent path and procedural eye artwork.
    if (!definition || !body || brick.id === options.selectedId || options.excludedIds.has(brick.id) || options.displayColorByBrickId?.has(brick.id)
      || colorOpacity[brick.color] < 1 || prints.some(layer => layer.opacity < 1) || brick.brickId.startsWith('tile-eye-')) {
      individualBricks.push(brick); continue
    }
    const matrix = getLDrawSceneMatrix(definition, brick)
    addMesh(body, matrix, brick, colorHex[brick.color], false, definition.kind === 'slope')
    for (const layer of prints) addMesh(layer.geometry, matrix, brick, layer.color, true, false)
    const highlighted = options.highlightedIds.has(brick.id)
    const floating = options.supportedByBrickId.get(brick.id) === false
    const chunk = `${Math.floor(brick.pose.xStud / edgeChunkSize)}:${Math.floor(brick.pose.zStud / edgeChunkSize)}`
    if (options.showEdges || highlighted || floating) appendLines(`body:${chunk}`, '#172033', getLDrawEdgePoints(body), matrix, brick)
    if (highlighted || floating) {
      const bounds = getBrickWorldBoundsFrame(definition, brick.pose)
      const boundsMatrix = (x: number, y: number, z: number) => new Matrix4().makeTranslation(bounds.x, bounds.y, bounds.z)
        .scale(new Vector3(bounds.width + x, bounds.height + y, bounds.depth + z))
      if (highlighted) appendLines(`highlight:${chunk}`, '#f59e0b', boxEdges, boundsMatrix(.16, .2, .16), brick)
      if (floating) appendLines(`floating:${chunk}`, '#ef4444', boxEdges, boundsMatrix(.14, .18, .14), brick)
    }
  }
  const previousLines = new Map(previous?.lineBatches.map(batch => [batch.key, batch]))
  const point = new Vector3()
  const lineBatches: LDrawLineBatch[] = [...lines].map(([key, group]) => {
    const cached = previousLines.get(key)
    if (cached?.sources.length === group.items.length && group.items.every((item, i) => item.brick === cached.sources[i].brick && item.points === cached.sources[i].points)) return cached
    const points = new Float32Array(group.length)
    let offset = 0
    for (const item of group.items) for (let i = 0; i < item.points.length; i += 3) {
      point.fromArray(item.points, i).applyMatrix4(item.matrix).toArray(points, offset); offset += 3
    }
    return { key, color: group.color, points, sources: group.items }
  })
  const previousMeshes = new Map([...(previous?.meshBatches ?? []), ...(previous?.printSources ?? [])].map(batch => [batch.key, batch]))
  const allMeshes = [...groups.values()].map(batch => {
    const cached = previousMeshes.get(batch.key)
    return cached?.instances.length === batch.instances.length && batch.instances.every((instance, i) => instance.brick === cached.instances[i].brick && instance.color === cached.instances[i].color) ? cached : batch
  })
  const printSources = allMeshes.filter(batch => batch.print)
  return { meshBatches: allMeshes.filter(batch => !batch.print), printBatches: mergeLDrawPrintBatches(printSources, previous?.printBatches), printSources, lineBatches, individualBricks }
}

/** Local BVH per shared mould, without changing Mesh.prototype or other scenes. */
export const createLDrawBatchMesh = (batch: LDrawMeshBatch) => {
  const geometry = batch.geometry
  if (!geometry.boundsTree) geometry.boundsTree = new MeshBVH(geometry)
  const material = new MeshStandardMaterial({ color: 'white', roughness: batch.print ? .4 : .48, metalness: batch.print ? 0 : .02,
    side: batch.doubleSide ? DoubleSide : FrontSide, polygonOffset: batch.print, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  const mesh = new InstancedMesh(geometry, material, batch.instances.length)
  const color = new Color()
  batch.instances.forEach((instance, i) => { mesh.setMatrixAt(i, instance.matrix); mesh.setColorAt(i, color.set(instance.color)) })
  mesh.instanceMatrix.needsUpdate = true
  mesh.castShadow = !batch.print; mesh.receiveShadow = !batch.print; mesh.renderOrder = batch.print ? 1 : 0
  mesh.computeBoundingSphere()
  const proxy = new Mesh(geometry, material)
  const hits: Intersection[] = []
  const nativeRaycast = mesh.raycast.bind(mesh)
  mesh.raycast = (raycaster: Raycaster, intersects: Intersection[]) => {
    // Same per-instance transform and result shape as Three's native raycaster.
    // The shared BVH replaces triangle scans; no broad boxes are used as hits.
    if (!geometry.boundsTree) return nativeRaycast(raycaster, intersects)
    const previous = raycaster.firstHitOnly
    raycaster.firstHitOnly = true
    try {
      batch.instances.forEach((instance, instanceId) => {
        proxy.matrixWorld.multiplyMatrices(mesh.matrixWorld, instance.matrix)
        acceleratedRaycast.call(proxy, raycaster, hits)
        for (const hit of hits) intersects.push({ ...hit, object: mesh, instanceId })
        hits.length = 0
      })
    } finally { raycaster.firstHitOnly = previous }
  }
  return mesh
}
