import type { BuildPlan } from '../types/bricks'
import type { StabilityReport } from './stabilityReport'

const storagePrefix = 'brick-flow-agent:stability-history:v1:'
export const maxStabilityHistoryEntries = 10

export type StabilitySnapshot = {
  id: string
  planId: string
  name: string
  createdAt: string
  planFingerprint: string
  report: StabilityReport
}

export type StabilityComparisonMetric = {
  key: 'score' | 'tippingMargin' | 'groundedPercent' | 'supportCoveragePercent' | 'connectionRedundancyPercent' | 'criticalBrickCount' | 'simulationScore' | 'survivedBrickCount'
  before?: number
  after?: number
  delta?: number
  outcome: 'improved' | 'declined' | 'unchanged' | 'unavailable'
}

const storageKey = (planId: string) => `${storagePrefix}${encodeURIComponent(planId)}`
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isSnapshot = (value: unknown): value is StabilitySnapshot => {
  if (!isRecord(value) || !isRecord(value.report) || !isRecord(value.report.plan)) return false
  return typeof value.id === 'string' && typeof value.planId === 'string' &&
    typeof value.name === 'string' && typeof value.createdAt === 'string' &&
    typeof value.planFingerprint === 'string' && value.report.schemaVersion === 1
}

export const createPlanFingerprint = (plan: BuildPlan) => {
  const serialized = JSON.stringify(plan.bricks.map((brick) => ({
    id: brick.id,
    brickId: brick.brickId,
    color: brick.color,
    pose: brick.pose,
    voxelState: brick.voxelState,
  })).sort((left, right) => left.id.localeCompare(right.id)))
  let hash = 2_166_136_261
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `${plan.bricks.length}:${(hash >>> 0).toString(36)}`
}

export const loadStabilityHistory = (planId: string): StabilitySnapshot[] => {
  if (typeof window === 'undefined') return []
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(planId)) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.filter(isSnapshot).slice(0, maxStabilityHistoryEntries)
  } catch {
    return []
  }
}

const persist = (planId: string, snapshots: StabilitySnapshot[]) => {
  if (typeof window === 'undefined') return snapshots
  const limited = snapshots.slice(0, maxStabilityHistoryEntries)
  try {
    if (limited.length === 0) window.localStorage.removeItem(storageKey(planId))
    else window.localStorage.setItem(storageKey(planId), JSON.stringify(limited))
  } catch {
    // Analysis history is optional when browser storage is unavailable.
  }
  return limited
}

export const saveStabilitySnapshot = (snapshot: StabilitySnapshot) => {
  const current = loadStabilityHistory(snapshot.planId)
  const duplicate = current.find((item) => item.planFingerprint === snapshot.planFingerprint &&
    item.report.simulation?.scenario === snapshot.report.simulation?.scenario &&
    item.report.simulation?.intensity === snapshot.report.simulation?.intensity &&
    item.report.simulation?.directionDegrees === snapshot.report.simulation?.directionDegrees &&
    item.report.simulation?.physicsProfile === snapshot.report.simulation?.physicsProfile)
  if (duplicate) return { snapshot: duplicate, history: current, created: false }
  return {
    snapshot,
    history: persist(snapshot.planId, [snapshot, ...current]),
    created: true,
  }
}

export const renameStabilitySnapshot = (planId: string, snapshotId: string, name: string) =>
  persist(planId, loadStabilityHistory(planId).map((snapshot) => (
    snapshot.id === snapshotId ? { ...snapshot, name: name.trim().slice(0, 80) || snapshot.name } : snapshot
  )))

export const deleteStabilitySnapshot = (planId: string, snapshotId: string) =>
  persist(planId, loadStabilityHistory(planId).filter((snapshot) => snapshot.id !== snapshotId))

export const clearStabilityHistory = (planId: string) => persist(planId, [])

const metric = (
  key: StabilityComparisonMetric['key'],
  before: number | undefined,
  after: number | undefined,
  higherIsBetter = true,
): StabilityComparisonMetric => {
  if (before === undefined || after === undefined) return { key, before, after, outcome: 'unavailable' }
  const delta = after - before
  const tolerance = key === 'tippingMargin' ? 0.005 : 0.5
  const outcome = Math.abs(delta) <= tolerance
    ? 'unchanged'
    : (higherIsBetter ? delta > 0 : delta < 0) ? 'improved' : 'declined'
  return { key, before, after, delta, outcome }
}

export const compareStabilityReports = (before: StabilityReport, after: StabilityReport): StabilityComparisonMetric[] => [
  metric('score', before.summary.score, after.summary.score),
  metric('tippingMargin', before.summary.tippingMargin, after.summary.tippingMargin),
  metric('groundedPercent', before.summary.groundedPercent, after.summary.groundedPercent),
  metric('supportCoveragePercent', before.summary.supportCoveragePercent, after.summary.supportCoveragePercent),
  metric('connectionRedundancyPercent', before.summary.connectionRedundancyPercent, after.summary.connectionRedundancyPercent),
  metric('criticalBrickCount', before.summary.criticalBrickCount, after.summary.criticalBrickCount, false),
  metric('simulationScore', before.simulation?.score, after.simulation?.score),
  metric('survivedBrickCount', before.simulation?.survivedBrickCount, after.simulation?.survivedBrickCount),
]

export const formatStabilityComparisonMarkdown = (
  before: StabilitySnapshot,
  after: StabilityReport,
  locale: 'zh-CN' | 'en-US',
) => {
  const zh = locale === 'zh-CN'
  const rows = compareStabilityReports(before.report, after)
    .filter((item) => item.outcome !== 'unavailable')
    .map((item) => `| ${item.key} | ${item.before?.toFixed(item.key === 'tippingMargin' ? 2 : 0)} | ${item.after?.toFixed(item.key === 'tippingMargin' ? 2 : 0)} | ${item.delta && item.delta > 0 ? '+' : ''}${item.delta?.toFixed(item.key === 'tippingMargin' ? 2 : 0)} | ${item.outcome} |`)
  return [
    `# ${after.plan.title} — ${zh ? '结构对比报告' : 'Structural Comparison Report'}`,
    '',
    `${zh ? '基线' : 'Baseline'}: **${before.name}** (${before.createdAt})`,
    '',
    `| ${zh ? '指标' : 'Metric'} | ${zh ? '之前' : 'Before'} | ${zh ? '现在' : 'After'} | ${zh ? '变化' : 'Delta'} | ${zh ? '结果' : 'Outcome'} |`,
    '| --- | ---: | ---: | ---: | --- |',
    ...rows,
  ].join('\n')
}

const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export const formatStabilityComparisonSvg = (
  before: StabilitySnapshot,
  after: StabilityReport,
  locale: 'zh-CN' | 'en-US',
) => {
  const zh = locale === 'zh-CN'
  const rows = compareStabilityReports(before.report, after).filter((item) => item.outcome !== 'unavailable')
  const height = 250 + rows.length * 52
  const body = rows.map((item, index) => {
    const y = 225 + index * 52
    const color = item.outcome === 'improved' ? '#16a34a' : item.outcome === 'declined' ? '#dc2626' : '#64748b'
    const decimals = item.key === 'tippingMargin' ? 2 : 0
    const delta = item.delta === undefined ? '—' : `${item.delta > 0 ? '+' : ''}${item.delta.toFixed(decimals)}`
    return `<g transform="translate(60 ${y})"><text font-size="15" font-weight="650" fill="#172033">${escapeXml(item.key)}</text><text x="430" font-size="16" fill="#64748b">${item.before?.toFixed(decimals)} → ${item.after?.toFixed(decimals)}</text><text x="720" font-size="17" font-weight="750" fill="${color}">${delta}</text></g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="920" height="${height}" viewBox="0 0 920 ${height}"><rect width="920" height="${height}" rx="24" fill="#f7f8fc"/><text x="60" y="66" font-family="system-ui,sans-serif" font-size="17" font-weight="700" fill="#2563eb">BRICK FLOW</text><text x="60" y="112" font-family="system-ui,sans-serif" font-size="29" font-weight="750" fill="#172033">${escapeXml(after.plan.title)}</text><text x="60" y="148" font-family="system-ui,sans-serif" font-size="16" fill="#64748b">${zh ? '结构对比' : 'Structural comparison'} · ${escapeXml(before.name)}</text><g font-family="system-ui,sans-serif">${body}</g></svg>`
}
