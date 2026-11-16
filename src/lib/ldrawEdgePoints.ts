import { EdgesGeometry, type BufferGeometry } from 'three'

const outlines = new WeakMap<BufferGeometry, Map<number, number[]>>()

/** Same Three.js edges and threshold as Drei's Edges, once per shared mould. */
export const getLDrawEdgePoints = (geometry: BufferGeometry, threshold = 15) => {
  let thresholds = outlines.get(geometry)
  if (!thresholds) { thresholds = new Map(); outlines.set(geometry, thresholds) }
  let points = thresholds.get(threshold)
  if (!points) {
    const edges = new EdgesGeometry(geometry, threshold)
    points = Array.from(edges.getAttribute('position').array)
    edges.dispose()
    thresholds.set(threshold, points)
  }
  return points
}

export const seedLDrawEdgePoints = (geometry: BufferGeometry, points: ArrayLike<number>) => {
  let thresholds = outlines.get(geometry)
  if (!thresholds) { thresholds = new Map(); outlines.set(geometry, thresholds) }
  if (!thresholds.has(15)) thresholds.set(15, Array.from(points))
}
