import { yieldToBrowser } from './yieldToBrowser'
import { Box3, BoxGeometry, BufferGeometry, Color, DoubleSide, FrontSide, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Intersection, type Raycaster } from 'three'
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh'
import { brickById, colorHex, colorOpacity } from '../data/basicBricks'
import type { BrickDefinition, PlacedBrick } from '../types/bricks'
import { mergeLDrawPrintBatches, prepareLDrawPrintBatches, prepareLDrawPickingGeometry, type LDrawPrintBatch } from './ldrawPrintBatches'
import { getBrickWorldFrame } from './brickUnits'
import { getBrickWorldBoundsFrame } from './ldrawBounds'
import { getLDrawEdgePoints } from './ldrawEdgePoints'
import { onLDrawGeneratedVisualLoaded } from './ldrawGeneratedVisualLoader'
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
export type LDrawMeshBatch = { key: string; geometry: BufferGeometry; instances: LDrawBatchInstance[]; print: boolean; doubleSide: boolean; opacity?: number }
export type LDrawLineBatch = { key: string; color: string; points: Float32Array; sources: { brick: PlacedBrick; points: number[] }[] }

export type LDrawSceneBatches = { meshBatches: LDrawMeshBatch[]; printBatches: LDrawPrintBatch[]; lineBatches: LDrawLineBatch[]; individualBricks: PlacedBrick[]; printSources: LDrawMeshBatch[] }

/** Matches the opacity used by an individually rendered, risk-coloured brick. */
const DISPLAY_COLOR_BATCH_OPACITY = 0.92

type Options = {
  selectedId?: string
  highlightedIds: Set<string>
  supportedByBrickId: Map<string, boolean>
  displayColorByBrickId?: Map<string, string>
  excludedIds: Set<string>
  showEdges: boolean
}

let visualVersion = 0
onLDrawGeneratedVisualLoaded(() => { visualVersion++ })
const snapshots = new WeakMap<LDrawSceneBatches, { bricks: PlacedBrick[]; options: Options; version: number }>()
const sameSet = (a: Set<string>, b: Set<string>) => a === b || (a.size === b.size && [...a].every(id => b.has(id)))

const preparedScenes = new WeakMap<PlacedBrick[], LDrawSceneBatches>()
export const buildLDrawSceneBatches = (bricks: PlacedBrick[], options: Options, previous?: LDrawSceneBatches,
  mergePrints = mergeLDrawPrintBatches): LDrawSceneBatches => {
  if (!previous?.printSources.length) previous = preparedScenes.get(bricks) ?? previous
  const snapshot = previous && snapshots.get(previous)
  if (bricks.length >= 800 && snapshot?.version === visualVersion && snapshot.bricks === bricks && snapshot.options.selectedId === options.selectedId
    && snapshot.options.showEdges === options.showEdges
    && snapshot.options.supportedByBrickId === options.supportedByBrickId
    && snapshot.options.displayColorByBrickId === options.displayColorByBrickId
    && sameSet(snapshot.options.highlightedIds, options.highlightedIds)
    && sameSet(snapshot.options.excludedIds, options.excludedIds)) return previous!
  const groups = new Map<string, LDrawMeshBatch>()
  const lines = new Map<string, { color: string; items: { points: number[]; matrix: Matrix4; brick: PlacedBrick }[]; length: number }>()
  const individualBricks: PlacedBrick[] = []
  const appendLines = (key: string, color: string, points: number[], matrix: Matrix4, brick: PlacedBrick) => {
    const group = lines.get(key) ?? { color, items: [], length: 0 }
    group.items.push({ points, matrix, brick }); group.length += points.length
    lines.set(key, group)
  }
  const addMesh = (geometry: BufferGeometry, matrix: Matrix4, brick: PlacedBrick, color: string, print: boolean, doubleSide: boolean, opacity: number) => {
    const positive = getPositiveLDrawGeometry(geometry, matrix)
    const key = `${positive.geometry.uuid}:${print}:${doubleSide}:${opacity}`
    const group = groups.get(key) ?? { key, geometry: positive.geometry, instances: [], print, doubleSide, opacity }
    group.instances.push({ brick, matrix: positive.matrix, color }); groups.set(key, group)
  }
  // Body/print geometries only depend on the mould, not on the placed brick.
  // A 6,000-piece castle reuses ~390 of them; resolve each mould once.
  const geometryCache = new Map<string, {
    body: BufferGeometry | undefined
    prints: ReturnType<typeof createLDrawPrintGeometries>
  }>()
  for (const brick of bricks) {
    const definition = brickById.get(brick.brickId)
    let resources = definition ? geometryCache.get(definition.id) : undefined
    if (definition && !resources) {
      const body = definition.pack === 'lego'
        ? createLoadedLDrawBodyGeometry(definition.partNumber, definition.footprint)
        : undefined
      resources = { body, prints: body ? createLDrawPrintGeometries(definition.partNumber, definition.footprint) : [] }
      geometryCache.set(definition.id, resources)
    }
    const body = resources?.body
    const prints = resources?.prints ?? []
    const displayColor = options.displayColorByBrickId?.get(brick.id)
    // Printed faces keep their own colours and still need the independent
    // renderer. Plain coloured bricks can stay instanced with an overridden
    // instance colour, which avoids thousands of individual meshes in xray.
    const needsIndividualRender = !definition || !body || options.excludedIds.has(brick.id)
      || (displayColor !== undefined && prints.length > 0)
      || colorOpacity[brick.color] < 1 || prints.some(layer => layer.opacity < 1) || brick.brickId.startsWith('tile-eye-')
    // Preserve the original sorted transparent path and procedural eye artwork.
    if (needsIndividualRender) {
      individualBricks.push(brick); continue
    }
    const matrix = getLDrawSceneMatrix(definition!, brick)
    const opacity = displayColor !== undefined ? DISPLAY_COLOR_BATCH_OPACITY : 1
    if (brick.id === options.selectedId) individualBricks.push(brick)
    else addMesh(body!, matrix, brick, displayColor ?? colorHex[brick.color], false, definition!.kind === 'slope', opacity)
    for (const layer of prints) addMesh(layer.geometry, matrix, brick, layer.color, true, false, opacity)
    if (brick.id === options.selectedId) continue
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
  const result = { meshBatches: allMeshes.filter(batch => !batch.print), printBatches: mergePrints(printSources, previous?.printBatches), printSources, lineBatches, individualBricks }
  snapshots.set(result, { bricks, version: visualVersion, options: { ...options, highlightedIds: new Set(options.highlightedIds), excludedIds: new Set(options.excludedIds) } })
  return result
}

/** Local BVH per shared mould, without changing Mesh.prototype or other scenes. */
export const createLDrawBatchMesh = (batch: LDrawMeshBatch) => {
  const geometry = batch.geometry
  const opacity = batch.opacity ?? 1
  if (!geometry.boundsTree) geometry.boundsTree = new MeshBVH(geometry)
  const material = new MeshStandardMaterial({ color: 'white', roughness: batch.print ? .4 : .48, metalness: batch.print ? 0 : .02,
    side: batch.doubleSide ? DoubleSide : FrontSide, polygonOffset: batch.print, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    transparent: opacity < 1, opacity, depthWrite: opacity >= 1 })
  const mesh = new InstancedMesh(geometry, material, batch.instances.length)
  const color = new Color()
  batch.instances.forEach((instance, i) => { mesh.setMatrixAt(i, instance.matrix); mesh.setColorAt(i, color.set(instance.color)) })
  mesh.instanceMatrix.needsUpdate = true
  mesh.castShadow = !batch.print; mesh.receiveShadow = !batch.print; mesh.renderOrder = batch.print ? 1 : 0
  mesh.computeBoundingSphere()
  const proxy = new Mesh(geometry, material)
  const hits: Intersection[] = []
  // Reject missed instances before traversing their triangle BVHs. Test in
  // world space so near/far and non-uniform parent transforms remain exact.
  geometry.computeBoundingBox()
  const instanceBounds = batch.instances.map(instance => geometry.boundingBox!.clone().applyMatrix4(instance.matrix))
  const worldBounds = new Box3()

  const nativeRaycast = mesh.raycast.bind(mesh)
  mesh.raycast = (raycaster: Raycaster, intersects: Intersection[]) => {
    // Same per-instance transform and result shape as Three's native raycaster.
    // The shared BVH replaces triangle scans; no broad boxes are used as hits.
    if (!geometry.boundsTree) return nativeRaycast(raycaster, intersects)
    const previous = raycaster.firstHitOnly
    raycaster.firstHitOnly = true
    try {
      batch.instances.forEach((instance, instanceId) => {
        worldBounds.copy(instanceBounds[instanceId]).applyMatrix4(mesh.matrixWorld)
        if (!raycaster.ray.intersectsBox(worldBounds)) return
        proxy.matrixWorld.multiplyMatrices(mesh.matrixWorld, instance.matrix)
        acceleratedRaycast.call(proxy, raycaster, hits)
        for (const hit of hits) intersects.push({ ...hit, object: mesh, instanceId })
        hits.length = 0
      })
    } finally { raycaster.firstHitOnly = previous }
  }
  return mesh
}

/** Prepare immutable large scenes cooperatively before enabling detailed view. */
export const prepareLDrawSceneBatches = async (bricks: PlacedBrick[], onProgress?: (fraction: number) => void) => {
  if (bricks.length < 800 || preparedScenes.has(bricks)) { onProgress?.(1); return }
  const scene = buildLDrawSceneBatches(bricks, {
    highlightedIds: new Set(), excludedIds: new Set(), supportedByBrickId: new Map(), showEdges: false,
  }, undefined, () => [])
  const geometries = new Set([...scene.meshBatches, ...scene.printSources].map(batch => batch.geometry))
  let completed = 0
  for (const geometry of geometries) {
    prepareLDrawPickingGeometry(geometry)
    if (scene.meshBatches.some(batch => batch.geometry === geometry)) getLDrawEdgePoints(geometry)
    onProgress?.(.5 * ++completed / geometries.size)
    await yieldToBrowser()
  }
  scene.printBatches = await prepareLDrawPrintBatches(scene.printSources, fraction => onProgress?.(.5 + fraction * .5))
  preparedScenes.set(bricks, scene)
  onProgress?.(1)
}
