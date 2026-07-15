export const manualStepPageSize = 30

export const getManualStepPage = (
  totalSteps: number,
  selectedIndex: number,
  pageSize = manualStepPageSize,
) => {
  const safeTotal = Math.max(0, Math.floor(totalSteps))
  const safePageSize = Math.max(1, Math.floor(pageSize))
  const clampedIndex = Math.max(0, Math.min(safeTotal - 1, Math.floor(selectedIndex)))
  const start = safeTotal === 0 ? 0 : Math.floor(clampedIndex / safePageSize) * safePageSize
  return {
    start,
    end: Math.min(safeTotal, start + safePageSize),
    total: safeTotal,
    hasPrevious: start > 0,
    hasNext: start + safePageSize < safeTotal,
  }
}

export type ManualPageTabItem =
  | { kind: 'step'; index: number }
  | { kind: 'gap'; key: string }

export const getManualPageTabItems = (
  totalSteps: number,
  selectedIndex: number,
  radius = 3,
): ManualPageTabItem[] => {
  const safeTotal = Math.max(0, Math.floor(totalSteps))
  if (safeTotal === 0) return []
  const clampedIndex = Math.max(0, Math.min(safeTotal - 1, Math.floor(selectedIndex)))
  const safeRadius = Math.max(0, Math.floor(radius))
  const indices = new Set([0, safeTotal - 1])
  for (let index = clampedIndex - safeRadius; index <= clampedIndex + safeRadius; index += 1) {
    if (index >= 0 && index < safeTotal) indices.add(index)
  }

  const sorted = [...indices].sort((source, target) => source - target)
  const items: ManualPageTabItem[] = []
  sorted.forEach((index, itemIndex) => {
    const previous = sorted[itemIndex - 1]
    if (previous !== undefined && index - previous > 1) {
      items.push({ kind: 'gap', key: `${previous}-${index}` })
    }
    items.push({ kind: 'step', index })
  })
  return items
}
