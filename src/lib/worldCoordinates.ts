export const maxWorldCoordinate = 100_000
export const isWorldCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= maxWorldCoordinate
export const clampWorldCoordinate = (value: number) =>
  Number.isFinite(value) ? Math.max(-maxWorldCoordinate, Math.min(maxWorldCoordinate, value)) : 0

/** Iterate bounded offsets so unsafe absolute indices can never stop progressing. */
export function* gridCellIndices(min: number, max: number, cellSize: number) {
  if (![min, max, cellSize].every(Number.isFinite) || cellSize <= 0 || Math.max(Math.abs(min), Math.abs(max)) > maxWorldCoordinate + 128) throw new RangeError('WORLD_COORDINATE_OUT_OF_RANGE')
  const start = Math.floor(min / cellSize)
  const count = Math.floor(max / cellSize) - start + 1
  if (!Number.isSafeInteger(start) || count < 0 || count > 128) throw new RangeError('WORLD_SPATIAL_RANGE_TOO_LARGE')
  for (let offset = 0; offset < count; offset += 1) yield start + offset
}
