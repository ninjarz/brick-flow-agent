/** Input is newest first. Only retained checkpoints consume the shared budget. */
export const selectCheckpointEvictions = <T extends { projectId: string }>(
  checkpoints: T[],
  limits = { perProject: 5, bytes: 50 * 1024 * 1024 },
  sizeOf: (checkpoint: T) => number = item => JSON.stringify(item).length * 2,
): T[] => {
  let total = 0
  const counts = new Map<string, number>()
  return checkpoints.filter(item => {
    const count = counts.get(item.projectId) ?? 0
    if (count >= limits.perProject) return true
    const size = sizeOf(item)
    if (total + size > limits.bytes) return true
    counts.set(item.projectId, count + 1)
    total += size
    return false
  })
}
