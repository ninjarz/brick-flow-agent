import { mergeLDrawLineBatches, prepareLDrawLineBatches, type LDrawLineGroup } from './ldrawLineBatches'
import type { LDrawLineBatch } from './ldrawLineBatches'
export type { LDrawLineBatch } from './ldrawLineBatches'
import { createInstanceBoundsQuery } from './instanceBoundsTree'
import { getSharedBatchTransform } from './sharedBatchTransform'
import { yieldToBrowser } from './yieldToBrowser'
import { Box3, Sphere, DynamicDrawUsage, BoxGeometry, BufferGeometry, Color, DoubleSide, FrontSide, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Intersection, type Raycaster } from 'three'
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
export type LDrawMeshBatch = { key: string; geometry: BufferGeometry; instances: LDrawBatchInstance[]; print: boolean; doubleSide: boolean; opacity?: number; scope?: 'active'; transform?: Matrix4 }


export type LDrawSceneBatches = { meshBatches: LDrawMeshBatch[]; printBatches: LDrawPrintBatch[]; lineBatches: LDrawLineBatch[]; individualBricks: PlacedBrick[]; printSources: LDrawMeshBatch[] }

/** Matches the opacity used by an individually rendered, risk-coloured brick. */
const DISPLAY_COLOR_BATCH_OPACITY = 0.92

type Options = {
  selectedId?: string
  highlightedIds: Set<string>
  supportedByBrickId: Map<string, boolean>
  displayColorByBrickId?: Map<string, string>
  excludedIds: Set<string>
  hiddenPrintIds?: Set<string>
  showEdges: boolean
}

let visualVersion = 0
onLDrawGeneratedVisualLoaded(() => { visualVersion++ })
const snapshots = new WeakMap<LDrawSceneBatches, { bricks: PlacedBrick[]; options: Options; version: number }>()
const sameSet = (a: Set<string>, b: Set<string>) => a === b || (a.size === b.size && [...a].every(id => b.has(id)))
const emptyPrintIds = new Set<string>()

const preparedScenes = new Map<PlacedBrick[], LDrawSceneBatches>()
export const clearPreparedLDrawScenes = () => preparedScenes.clear()
function* generateLDrawSceneBatches(bricks: PlacedBrick[], options: Options, previous?: LDrawSceneBatches,
  mergePrints = mergeLDrawPrintBatches, mergeLines = mergeLDrawLineBatches): Generator<void, LDrawSceneBatches> {
  // A prepared destination supersedes the previous step, including when that
  // step already contains artwork. Otherwise jumping steps merges every print
  // triangle synchronously despite the completed cooperative preparation.
  const prepared = preparedScenes.get(bricks)
  if (prepared && snapshots.get(prepared)?.version === visualVersion
    && (!previous || snapshots.get(previous)?.bricks !== bricks)) previous = prepared
  const snapshot = previous && snapshots.get(previous)
  if (bricks.length >= 800 && snapshot?.version === visualVersion && snapshot.bricks === bricks && snapshot.options.selectedId === options.selectedId
    && snapshot.options.showEdges === options.showEdges
    && snapshot.options.supportedByBrickId === options.supportedByBrickId
    && snapshot.options.displayColorByBrickId === options.displayColorByBrickId
    && sameSet(snapshot.options.highlightedIds, options.highlightedIds)
    && sameSet(snapshot.options.hiddenPrintIds ?? emptyPrintIds, options.hiddenPrintIds ?? emptyPrintIds)
    && sameSet(snapshot.options.excludedIds, options.excludedIds)) return previous!
  const groups = new Map<string, LDrawMeshBatch>()
  const lines = new Map<string, LDrawLineGroup>()
  const individualBricks: PlacedBrick[] = []
  const appendLines = (key: string, color: string, points: number[], matrix: Matrix4, brick: PlacedBrick, rigid = false) => {
    const group = lines.get(key) ?? { color, items: [], length: 0, rigid }
    group.items.push({ points, matrix, brick }); group.length += points.length
    lines.set(key, group)
  }
  const addMesh = (geometry: BufferGeometry, matrix: Matrix4, brick: PlacedBrick, color: string, print: boolean, doubleSide: boolean, opacity: number) => {
    const positive = getPositiveLDrawGeometry(geometry, matrix)
    const scope = opacity >= 1 && options.highlightedIds.size > 1 && options.highlightedIds.has(brick.id) ? 'active' as const : undefined
    const key = `${positive.geometry.uuid}:${print}:${doubleSide}:${opacity}:${scope ?? ''}`
    const group = groups.get(key) ?? { key, geometry: positive.geometry, instances: [], print, doubleSide, opacity, scope }
    group.instances.push({ brick, matrix: positive.matrix, color }); groups.set(key, group)
  }
  // Body/print geometries only depend on the mould, not on the placed brick.
  // A 6,000-piece castle reuses ~390 of them; resolve each mould once.
  const geometryCache = new Map<string, {
    body: BufferGeometry | undefined
    prints: ReturnType<typeof createLDrawPrintGeometries>
  }>()
  let sliceStart = performance.now()
  for (const brick of bricks) {
    if (performance.now() - sliceStart >= 8) { yield; sliceStart = performance.now() }
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
    const prints = options.hiddenPrintIds?.has(brick.id) ? [] : resources?.prints ?? []
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
    if (options.showEdges || highlighted || floating) {
      const rigid = options.highlightedIds.size > 1 && highlighted
      appendLines(`body:${rigid ? 'active:' : ''}${chunk}`, '#172033', getLDrawEdgePoints(body), matrix, brick, rigid)
    }
    if (highlighted || floating) {
      const bounds = getBrickWorldBoundsFrame(definition, brick.pose)
      const boundsMatrix = (x: number, y: number, z: number) => new Matrix4().makeTranslation(bounds.x, bounds.y, bounds.z)
        .scale(new Vector3(bounds.width + x, bounds.height + y, bounds.depth + z))
      const rigid = options.highlightedIds.size > 1 && highlighted
      if (highlighted) appendLines(`highlight:${rigid ? 'active:' : ''}${chunk}`, '#f59e0b', boxEdges, boundsMatrix(.16, .2, .16), brick, rigid)
      if (floating) appendLines(`floating:${rigid ? 'active:' : ''}${chunk}`, '#ef4444', boxEdges, boundsMatrix(.14, .18, .14), brick, rigid)
    }
  }
  const lineBatches = mergeLines(lines, previous?.lineBatches)
  const previousMeshes = new Map([...(previous?.meshBatches ?? []), ...(previous?.printSources ?? [])].map(batch => [batch.key, batch]))
  const allMeshes = [...groups.values()].map(batch => {
    const cached = previousMeshes.get(batch.key)
    const sameInstances = cached?.instances.length === batch.instances.length
    if (sameInstances && batch.instances.every((instance, i) => instance.brick === cached.instances[i].brick && instance.color === cached.instances[i].color)) return cached
    if (!batch.print && batch.scope === 'active' && sameInstances && batch.instances.every((instance, i) => instance.brick.id === cached.instances[i].brick.id)) {
      const delta = getSharedBatchTransform(batch.instances.map(instance => instance.matrix), cached.instances.map(instance => instance.matrix))
      if (delta) return { ...batch, transform: delta.multiply(cached.transform ?? new Matrix4()) }
    }
    return batch
  })
  const printSources = allMeshes.filter(batch => batch.print)
  const result = { meshBatches: allMeshes.filter(batch => !batch.print), printBatches: mergePrints(printSources, previous?.printBatches), printSources, lineBatches, individualBricks }
  snapshots.set(result, { bricks, version: visualVersion, options: { ...options, highlightedIds: new Set(options.highlightedIds), excludedIds: new Set(options.excludedIds) } })
  return result
}

export const buildLDrawSceneBatches = (bricks: PlacedBrick[], options: Options, previous?: LDrawSceneBatches,
  mergePrints = mergeLDrawPrintBatches, mergeLines = mergeLDrawLineBatches): LDrawSceneBatches => {
  const builder = generateLDrawSceneBatches(bricks, options, previous, mergePrints, mergeLines)
  while (true) {
    const next = builder.next()
    if (next.done === true) return next.value
  }
}

type BatchMeshState = { batch: LDrawMeshBatch; localMatrices: Matrix4[]; query: ReturnType<typeof createInstanceBoundsQuery> }
const batchMeshStates = new WeakMap<InstancedMesh, BatchMeshState>()

/** Reuse allocated GPU storage while preserving the instance IDs used by picking. */
export const updateLDrawBatchMesh = (mesh: InstancedMesh, batch: LDrawMeshBatch) => {
  const previous = batchMeshStates.get(mesh)
  if (mesh.geometry !== batch.geometry || mesh.instanceMatrix.count < batch.instances.length) throw new Error('LDRAW_BATCH_CAPACITY')
  const color = new Color()
  const transform = batch.transform ?? new Matrix4()
  const inverse = transform.clone().invert()
  const localMatrices = batch.instances.map(instance => batch.transform ? new Matrix4().multiplyMatrices(inverse, instance.matrix) : instance.matrix)
  mesh.matrix.copy(transform)
  mesh.matrixAutoUpdate = !batch.transform
  mesh.matrixWorldNeedsUpdate = true
  let firstMatrix = Infinity, lastMatrix = -1, firstColor = Infinity, lastColor = -1
  batch.instances.forEach((instance, index) => {
    const old = previous?.batch.instances[index]
    const matrix = localMatrices[index]
    if (!previous?.localMatrices[index] || matrix.elements.some((value, i) => Math.abs(value - previous.localMatrices[index].elements[i]) > 1e-10)) {
      mesh.setMatrixAt(index, matrix)
      firstMatrix = Math.min(firstMatrix, index); lastMatrix = index
    } else localMatrices[index] = previous!.localMatrices[index]
    if (!old || old.color !== instance.color) {
      mesh.setColorAt(index, color.set(instance.color))
      firstColor = Math.min(firstColor, index); lastColor = index
    }
  })
  // Merge pending writes as a single span, including updates made before the
  // renderer next uploads the attribute. Three r168 submits each range separately.
  const mark = (attribute: typeof mesh.instanceMatrix, first: number, last: number, stride: number) => {
    if (last < 0) return
    let start = first * stride, end = (last + 1) * stride
    for (const range of attribute.updateRanges) { start = Math.min(start, range.start); end = Math.max(end, range.start + range.count) }
    attribute.clearUpdateRanges()
    attribute.addUpdateRange(start, end - start)
    attribute.needsUpdate = true
  }
  mark(mesh.instanceMatrix, firstMatrix, lastMatrix, 16)
  if (mesh.instanceColor) { mesh.instanceColor.setUsage(DynamicDrawUsage); mark(mesh.instanceColor, firstColor, lastColor, 3) }
  mesh.count = batch.instances.length
  if (firstMatrix === Infinity && previous?.localMatrices.length === localMatrices.length) {
    batchMeshStates.set(mesh, { batch, localMatrices, query: previous.query })
    return
  }
  if (!batch.geometry.boundingBox) batch.geometry.computeBoundingBox()
  const bounds = localMatrices.map(matrix => batch.geometry.boundingBox!.clone().applyMatrix4(matrix))
  const envelope = new Box3()
  for (const box of bounds) envelope.union(box)
  mesh.boundingBox = envelope
  mesh.boundingSphere = envelope.getBoundingSphere(new Sphere())
  batchMeshStates.set(mesh, { batch, localMatrices, query: createInstanceBoundsQuery(bounds) })
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
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.castShadow = !batch.print; mesh.receiveShadow = !batch.print; mesh.renderOrder = batch.print ? 1 : 0
  updateLDrawBatchMesh(mesh, batch)
  const proxy = new Mesh(geometry, material)
  const hits: Intersection[] = []
  const nativeRaycast = mesh.raycast.bind(mesh)
  mesh.raycast = (raycaster: Raycaster, intersects: Intersection[]) => {
    if (!geometry.boundsTree) return nativeRaycast(raycaster, intersects)
    const state = batchMeshStates.get(mesh)!
    const previous = raycaster.firstHitOnly
    raycaster.firstHitOnly = true
    try {
      for (const instanceId of state.query(raycaster.ray, mesh.matrixWorld)) {
        proxy.matrixWorld.multiplyMatrices(mesh.matrixWorld, state.localMatrices[instanceId])
        acceleratedRaycast.call(proxy, raycaster, hits)
        for (const hit of hits) intersects.push({ ...hit, object: mesh, instanceId })
        hits.length = 0
      }
    } finally { raycaster.firstHitOnly = previous }
  }
  return mesh
}

/** Prepare immutable large scenes cooperatively before enabling detailed view. */
export const prepareLDrawSceneBatches = async (bricks: PlacedBrick[], onProgress?: (fraction: number) => void, options?: Options, canceled: () => boolean = () => false) => {
  if (bricks.length < 800 || preparedScenes.has(bricks)) { onProgress?.(1); return preparedScenes.get(bricks) }
  let lineSources = new Map<string, LDrawLineGroup>()
  const builder = generateLDrawSceneBatches(bricks, options ?? {
    highlightedIds: new Set(), excludedIds: new Set(), supportedByBrickId: new Map(), showEdges: true,
  }, undefined, () => [], sources => { lineSources = sources; return [] })
  const collect = async () => {
    while (!canceled()) {
      const next = builder.next()
      if (next.done === true) return next.value
      await yieldToBrowser()
    }
  }
  const scene = await collect()
  if (!scene) return undefined
  const geometries = new Set([...scene.meshBatches, ...scene.printSources].map(batch => batch.geometry))
  let completed = 0
  let sliceStart = performance.now()
  for (const geometry of geometries) {
    if (canceled()) return undefined
    prepareLDrawPickingGeometry(geometry)
    onProgress?.(.4 * ++completed / geometries.size)
    if (performance.now() - sliceStart >= 8) { await yieldToBrowser(); sliceStart = performance.now() }
  }
  scene.printBatches = await prepareLDrawPrintBatches(scene.printSources, fraction => onProgress?.(.4 + fraction * .4), canceled)
  scene.lineBatches = await prepareLDrawLineBatches(lineSources, fraction => onProgress?.(.8 + fraction * .2), canceled)
  if (canceled()) return undefined
  // Undo history can keep plan arrays alive long after their derived buffers retire.
  if (preparedScenes.size >= 2) preparedScenes.delete(preparedScenes.keys().next().value!)
  preparedScenes.set(bricks, scene)
  onProgress?.(1)
  return scene
}
