import { useEffect, useMemo, useRef } from 'react'
import type { BufferGeometry } from 'three'
import { LineSegmentsGeometry } from 'three-stdlib'
import type { LDrawLineBatch, LDrawSceneBatches } from '../../lib/ldrawSceneBatches'

/** The batching cache owns geometry, rather than each temporary mounted mesh.
 * Keep both settled and placement snapshots uploaded; dispose retired geometry
 * after the commit, and release all buffers when this scene unmounts. */
export const useLDrawBatchResources = (
  current: LDrawSceneBatches,
  settled: LDrawSceneBatches | undefined,
  placement: LDrawSceneBatches | undefined,
) => {
  const lines = useRef(new Map<LDrawLineBatch, LineSegmentsGeometry>())
  const prints = useRef(new Set<BufferGeometry>())
  const geometries = useMemo(() => {
    for (const batch of current.lineBatches) {
      if (!lines.current.has(batch)) lines.current.set(batch, new LineSegmentsGeometry().setPositions(batch.points))
    }
    return lines.current
  }, [current])
  useEffect(() => {
    const retained = [current, settled, placement].filter((batch): batch is LDrawSceneBatches => Boolean(batch))
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
    const lineCache = lines.current, printCache = prints.current
    return () => {
      for (const geometry of lineCache.values()) geometry.dispose()
      for (const geometry of printCache) geometry.dispose()
    }
  }, [])
  return geometries
}
