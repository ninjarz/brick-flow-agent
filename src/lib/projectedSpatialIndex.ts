type ProjectionBounds = { minX: number; maxX: number; minY: number; maxY: number }

const cellSize = 2
const maximumCellsPerProjection = 256

/** Conservative point queries, retaining input order for stable hit sorting. */
export const createProjectedSpatialIndex = <T>(items: T[], getBounds: (item: T) => ProjectionBounds) => {
  const buckets = new Map<string, number[]>()
  const broadIndices: number[] = []
  items.forEach((item, index) => {
    const bounds = getBounds(item)
    const minX = Math.floor(bounds.minX / cellSize)
    const maxX = Math.floor(bounds.maxX / cellSize)
    const minY = Math.floor(bounds.minY / cellSize)
    const maxY = Math.floor(bounds.maxY / cellSize)
    const cellCount = (maxX - minX + 1) * (maxY - minY + 1)
    // Very large or invalid bounds remain candidates without expanding the grid.
    if (![minX, maxX, minY, maxY].every(Number.isSafeInteger) ||
      maxX < minX || maxY < minY || cellCount > maximumCellsPerProjection) {
      broadIndices.push(index)
      return
    }
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = `${x},${y}`
        const bucket = buckets.get(key)
        if (bucket) bucket.push(index)
        else buckets.set(key, [index])
      }
    }
  })

  return (x: number, y: number): T[] => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return items
    const local = buckets.get(`${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`) ?? []
    const candidates: T[] = []
    let localIndex = 0
    let broadIndex = 0
    while (localIndex < local.length || broadIndex < broadIndices.length) {
      if (broadIndex >= broadIndices.length ||
        (localIndex < local.length && local[localIndex] < broadIndices[broadIndex])) {
        candidates.push(items[local[localIndex++]])
      } else {
        candidates.push(items[broadIndices[broadIndex++]])
      }
    }
    return candidates
  }
}
