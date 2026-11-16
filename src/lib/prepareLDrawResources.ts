import type { BufferGeometry } from 'three'
import { createLDrawBatchMesh, type LDrawMeshBatch, type LDrawSceneBatches } from './ldrawSceneBatches'
import { createLDrawPrintBatchMesh, type LDrawPrintBatch } from './ldrawPrintBatches'
import { LDrawLineGeometry } from './ldrawLineGeometry'
import { yieldToBrowser } from './yieldToBrowser'

export type PreparedLDrawResources = {
  scene?: LDrawSceneBatches
  bodies: Map<LDrawMeshBatch, ReturnType<typeof createLDrawBatchMesh>>
  prints: Map<LDrawPrintBatch, ReturnType<typeof createLDrawPrintBatchMesh>>
  lines: Map<Float32Array, LDrawLineGeometry>
  onReleased?: () => void
}

/** Only unclaimed resources remain here after a scene adopts the prepared objects. */
export const releasePreparedLDrawResources = (resources: PreparedLDrawResources, retainedPrints?: Set<BufferGeometry>) => {
  for (const mesh of resources.bodies.values()) { mesh.dispose(); mesh.material.dispose() }
  for (const mesh of resources.prints.values()) { mesh.material.dispose(); if (!retainedPrints?.has(mesh.geometry)) mesh.geometry.dispose() }
  for (const geometry of resources.lines.values()) geometry.dispose()
  resources.bodies.clear(); resources.prints.clear(); resources.lines.clear()
  resources.scene = undefined
  resources.onReleased?.()
  resources.onReleased = undefined
}

export const prepareLDrawResources = async (scene: LDrawSceneBatches, canceled: () => boolean, onProgress?: (fraction: number) => void) => {
  const resources: PreparedLDrawResources = { scene, bodies: new Map(), prints: new Map(), lines: new Map() }
  const total = scene.meshBatches.length + scene.printBatches.length + scene.lineBatches.length
  if (!total) return undefined
  let completed = 0
  let sliceStart = performance.now()
  function* tasks() {
    for (const batch of scene.meshBatches) yield () => resources.bodies.set(batch, createLDrawBatchMesh(batch))
    for (const batch of scene.printBatches) yield () => resources.prints.set(batch, createLDrawPrintBatchMesh(batch))
    for (const batch of scene.lineBatches) yield () => resources.lines.set(batch.points, new LDrawLineGeometry().setPositions(batch.points))
  }
  try {
    for (const prepare of tasks()) {
      if (canceled()) { releasePreparedLDrawResources(resources); return undefined }
      prepare()
      onProgress?.(++completed / Math.max(1, total))
      if (performance.now() - sliceStart >= 8) { await yieldToBrowser(); sliceStart = performance.now() }
    }
    if (canceled()) { releasePreparedLDrawResources(resources); return undefined }
    return resources
  } catch (error) { releasePreparedLDrawResources(resources); throw error }
}
