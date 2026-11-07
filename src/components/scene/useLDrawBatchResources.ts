import { useEffect, useMemo, useRef } from 'react'
import type { BufferGeometry, InstancedMesh, Mesh } from 'three'
import { LineSegmentsGeometry } from 'three-stdlib'
import { createLDrawBatchMesh, type LDrawMeshBatch, type LDrawLineBatch, type LDrawSceneBatches } from '../../lib/ldrawSceneBatches'
import { createLDrawPrintBatchMesh, type LDrawPrintBatch } from '../../lib/ldrawPrintBatches'

/** The batching cache owns geometry, rather than each temporary mounted mesh.
 * Keep both settled and placement snapshots uploaded; dispose retired geometry
 * after the commit, and release all buffers when this scene unmounts. */
export const useLDrawBatchResources = (
  current: LDrawSceneBatches,
  settled: LDrawSceneBatches | undefined,
  placement: LDrawSceneBatches | undefined,
) => {
  const lines = useRef(new Map<LDrawLineBatch, LineSegmentsGeometry>())
  const bodies = useRef(new Map<LDrawMeshBatch, ReturnType<typeof createLDrawBatchMesh>>())
  const artworks = useRef(new Map<LDrawPrintBatch, ReturnType<typeof createLDrawPrintBatchMesh>>())
  const lifetime = useRef(0)
  const prints = useRef(new Set<BufferGeometry>())
  const geometries = useMemo(() => {
    for (const batch of current.meshBatches) if (!bodies.current.has(batch)) bodies.current.set(batch, createLDrawBatchMesh(batch))
    for (const batch of current.printBatches) if (!artworks.current.has(batch)) artworks.current.set(batch, createLDrawPrintBatchMesh(batch))
    for (const batch of current.lineBatches) {
      if (!lines.current.has(batch)) lines.current.set(batch, new LineSegmentsGeometry().setPositions(batch.points))
    }
    return lines.current
  }, [current])
  useEffect(() => {
    const retained = [current, settled, placement].filter((batch): batch is LDrawSceneBatches => Boolean(batch))
    const liveBodies = new Set(retained.flatMap(batch => batch.meshBatches))
    const liveArtworks = new Set(retained.flatMap(batch => batch.printBatches))
    for (const [batch, mesh] of bodies.current) if (!liveBodies.has(batch)) { release(mesh); bodies.current.delete(batch) }
    for (const [batch, mesh] of artworks.current) if (!liveArtworks.has(batch)) { release(mesh); artworks.current.delete(batch) }
    const liveLines = new Set(retained.flatMap(batch => batch.lineBatches))
    const livePrints = new Set(retained.flatMap(batch => batch.printBatches.map(print => print.geometry)))
    for (const [batch, geometry] of lines.current) {
      if (!liveLines.has(batch)) { geometry.dispose(); lines.current.delete(batch) }
    }
    for (const geometry of prints.current) {
      if (!livePrints.has(geometry)) { geometry.dispose(); prints.current.delete(geometry) }
    }
    for (const geometry of livePrints) prints.current.add(geometry)
  }, [current, placement, settled])
  useEffect(() => {
    const generation = ++lifetime.current
    const isCurrentLifetime = () => lifetime.current === generation
    const lineCache = lines.current, printCache = prints.current, bodyCache = bodies.current, artworkCache = artworks.current
    // StrictMode replays effects without unmounting their scene objects.
    // Defer disposal so the replay can retain the same uploaded resources.
    return () => { queueMicrotask(() => {
      if (!isCurrentLifetime()) return
      for (const mesh of bodyCache.values()) release(mesh)
      for (const mesh of artworkCache.values()) release(mesh)
      bodyCache.clear(); artworkCache.clear()
      for (const geometry of lineCache.values()) geometry.dispose()
      for (const geometry of printCache) geometry.dispose()
      lineCache.clear(); printCache.clear()
    }) }
  }, [])
  return { lines: geometries, bodies: bodies.current, prints: artworks.current }
}

const release = (mesh: Mesh) => {
  // Shared mould geometry is owned by the visual registry.
  if ('isInstancedMesh' in mesh) (mesh as InstancedMesh).dispose()
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const material of materials) material.dispose()
}
