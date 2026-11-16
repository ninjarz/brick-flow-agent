import { releasePreparedLDrawResources, type PreparedLDrawResources } from '../../lib/prepareLDrawResources'
import { useEffect, useMemo, useRef } from 'react'
import type { BufferGeometry, InstancedMesh, Mesh } from 'three'
import { LDrawLineGeometry } from '../../lib/ldrawLineGeometry'
import type { LineSegmentsGeometry } from 'three-stdlib'
import { createLDrawBatchMesh, updateLDrawBatchMesh, type LDrawMeshBatch, type LDrawSceneBatches } from '../../lib/ldrawSceneBatches'
import { createLDrawPrintBatchMesh, updateLDrawPrintBatchTransform, type LDrawPrintBatch } from '../../lib/ldrawPrintBatches'

/** The batching cache owns geometry, rather than each temporary mounted mesh.
 * Keep both settled and placement snapshots uploaded; dispose retired geometry
 * after the commit, and release all buffers when this scene unmounts. */
export const useLDrawBatchResources = (
  current: LDrawSceneBatches,
  settled: LDrawSceneBatches | undefined,
  placement: LDrawSceneBatches | undefined,
  prepared?: PreparedLDrawResources,
) => {
  const lines = useRef(new Map<Float32Array, LineSegmentsGeometry>())
  const bodies = useRef(new Map<LDrawMeshBatch, ReturnType<typeof createLDrawBatchMesh>>())
  const artworks = useRef(new Map<LDrawPrintBatch, ReturnType<typeof createLDrawPrintBatchMesh>>())
  const freeBodies = useRef(new Map<string, ReturnType<typeof createLDrawBatchMesh>>())
  const lifetime = useRef(0)
  const prints = useRef(new Set<BufferGeometry>())
  const geometries = useMemo(() => {
    if (prepared) {
      const readyBodies = new Map([...prepared.bodies].map(([batch, mesh]) => [batch.key, { batch, mesh }]))
      const readyPrints = new Map([...prepared.prints].map(([batch, mesh]) => [batch.geometry, { batch, mesh }]))
      for (const batch of current.meshBatches) {
        const entry = readyBodies.get(batch.key)
        if (entry && entry.mesh.instanceMatrix.count >= batch.instances.length && !bodies.current.has(batch)) {
          if (entry.batch !== batch) updateLDrawBatchMesh(entry.mesh, batch)
          bodies.current.set(batch, entry.mesh)
          prepared.bodies.delete(entry.batch)
        }
      }
      for (const batch of current.printBatches) {
        const entry = readyPrints.get(batch.geometry)
        if (entry && !artworks.current.has(batch)) {
          updateLDrawPrintBatchTransform(entry.mesh, batch)
          artworks.current.set(batch, entry.mesh)
          prepared.prints.delete(entry.batch)
        }
      }
      for (const batch of current.lineBatches) {
        const geometry = prepared.lines.get(batch.points)
        if (geometry && !lines.current.has(batch.points)) { lines.current.set(batch.points, geometry); prepared.lines.delete(batch.points) }
      }
    }
    for (const batch of current.meshBatches) if (!bodies.current.has(batch)) {
      const mesh = freeBodies.current.get(batch.key)
      if (mesh && mesh.geometry === batch.geometry && mesh.instanceMatrix.count >= batch.instances.length) {
        freeBodies.current.delete(batch.key)
        updateLDrawBatchMesh(mesh, batch)
        bodies.current.set(batch, mesh)
      } else bodies.current.set(batch, createLDrawBatchMesh(batch))
    }
    for (const batch of current.printBatches) if (!artworks.current.has(batch)) artworks.current.set(batch, createLDrawPrintBatchMesh(batch))
    for (const batch of current.lineBatches) {
      if (!lines.current.has(batch.points)) lines.current.set(batch.points, new LDrawLineGeometry().setPositions(batch.points))
    }
    return lines.current
  }, [current, prepared])
  useEffect(() => {
    const retained = [current, settled, placement].filter((batch): batch is LDrawSceneBatches => Boolean(batch))
    const liveBodies = new Set(retained.flatMap(batch => batch.meshBatches))
    const liveArtworks = new Set(retained.flatMap(batch => batch.printBatches))
    // Recycle only retired meshes from a completed commit. A render that is
    // suspended or abandoned must never mutate a mesh still on screen.
    for (const mesh of freeBodies.current.values()) release(mesh)
    freeBodies.current.clear()
    for (const [batch, mesh] of bodies.current) if (!liveBodies.has(batch)) {
      if (liveBodies.size === 0) { release(mesh); bodies.current.delete(batch); continue }
      const previous = freeBodies.current.get(batch.key)
      if (previous) release(previous)
      freeBodies.current.set(batch.key, mesh)
      bodies.current.delete(batch)
    }
    for (const [batch, mesh] of artworks.current) if (!liveArtworks.has(batch)) { release(mesh); artworks.current.delete(batch) }
    const liveLines = new Set(retained.flatMap(batch => batch.lineBatches.map(line => line.points)))
    const livePrints = new Set(retained.flatMap(batch => batch.printBatches.map(print => print.geometry)))
    if (prepared) releasePreparedLDrawResources(prepared, livePrints)
    for (const [batch, geometry] of lines.current) {
      if (!liveLines.has(batch)) { geometry.dispose(); lines.current.delete(batch) }
    }
    for (const geometry of prints.current) {
      if (!livePrints.has(geometry)) { geometry.dispose(); prints.current.delete(geometry) }
    }
    for (const geometry of livePrints) prints.current.add(geometry)
  }, [current, placement, settled, prepared])
  useEffect(() => {
    const generation = ++lifetime.current
    const isCurrentLifetime = () => lifetime.current === generation
    const lineCache = lines.current, printCache = prints.current, bodyCache = bodies.current, artworkCache = artworks.current, freeBodyCache = freeBodies.current
    // StrictMode replays effects without unmounting their scene objects.
    // Defer disposal so the replay can retain the same uploaded resources.
    return () => { queueMicrotask(() => {
      if (!isCurrentLifetime()) return
      for (const mesh of bodyCache.values()) release(mesh)
      for (const mesh of artworkCache.values()) release(mesh)
      for (const mesh of freeBodyCache.values()) release(mesh)
      freeBodyCache.clear(); bodyCache.clear(); artworkCache.clear()
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
