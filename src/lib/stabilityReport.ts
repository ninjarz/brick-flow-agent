import type { DisasterFailureMode, DisasterSimulationResult } from './disasterSimulation'
import type { Locale } from './i18n'
import type { StabilityAnalysis, BrickStability } from './stabilityAnalysis'
import type { BuildPlan } from '../types/bricks'
import { brickById } from '../data/basicBricks'

export type StabilityInsight = {
  brickId?: string
  partLabel?: string
  severity: 'critical' | 'warning' | 'info'
  reason: string
  suggestion: string
}

export type StabilityReport = {
  schemaVersion: 1
  generatedAt: string
  plan: { id: string; title: string; brickCount: number }
  summary: {
    score: number
    tippingMargin: number
    groundedPercent: number
    supportCoveragePercent: number
    connectionRedundancyPercent: number
    criticalBrickCount: number
  }
  simulation?: {
    scenario: string
    intensity: number
    directionDegrees: number
    physicsProfile: string
    grade: string
    score: number
    survivedBrickCount: number
    failedBrickCount: number
    primaryFailureMode?: DisasterFailureMode
  }
  insights: StabilityInsight[]
}

const copy = {
  'zh-CN': {
    detached: ['零件没有通往地面的连续连接。', '将它连接到主体，或在下方增加连续支撑。'],
    cantilever: ['零件底部有效支撑面积不足。', '扩大下方承托面积，或缩短悬挑距离。'],
    'single-connection': ['零件只依赖一个连接点。', '增加第二个独立连接点来形成冗余。'],
    'high-load': ['该零件承担了较多上部质量。', '加宽承重路径，或在附近增加立柱和交错连接。'],
    'high-center': ['高处零件放大了整体倾覆风险。', '降低高处质量，或扩大结构底座。'],
    tipping: ['整体重心接近或越过支撑边界。', '沿倾倒方向扩大底座，或把较重零件移向中心。'],
    healthy: ['没有发现明显的静态结构弱点。', '可继续使用灾害模拟验证动态载荷。'],
  },
  'en-US': {
    detached: ['This part has no continuous connection to the ground.', 'Connect it to the main structure or add continuous support below it.'],
    cantilever: ['The effective support area below this part is limited.', 'Increase bearing area below it or shorten the cantilever.'],
    'single-connection': ['This part relies on a single connection.', 'Add a second independent connection to create redundancy.'],
    'high-load': ['This part carries substantial mass above it.', 'Widen the load path or add a nearby column and interlocking connections.'],
    'high-center': ['High-level mass increases global tipping risk.', 'Lower the upper mass or widen the base.'],
    tipping: ['The center of mass is close to or beyond the support boundary.', 'Widen the base toward the tipping direction or move heavy parts inward.'],
    healthy: ['No obvious static structural weakness was found.', 'Run a hazard simulation to check dynamic loading.'],
  },
} as const

const insightForReason = (
  brickId: string,
  item: BrickStability,
  reason: BrickStability['reasons'][number],
  locale: Locale,
): StabilityInsight => ({
  brickId,
  severity: item.riskLevel === 'detached' || item.riskLevel === 'critical' ? 'critical' : 'warning',
  reason: copy[locale][reason][0],
  suggestion: copy[locale][reason][1],
})

export const createBrickStabilityInsights = (
  item: BrickStability,
  locale: Locale,
): StabilityInsight[] => item.reasons.map((reason) => insightForReason(item.brickId, item, reason, locale))

export const createStabilityInsights = (
  analysis: StabilityAnalysis,
  locale: Locale,
  limit = 6,
): StabilityInsight[] => {
  const insights: StabilityInsight[] = []
  if (analysis.tippingMargin < 0.12) {
    insights.push({
      severity: analysis.tippingMargin < 0 ? 'critical' : 'warning',
      reason: copy[locale].tipping[0],
      suggestion: copy[locale].tipping[1],
    })
  }
  const risky = [...analysis.riskByBrickId.values()]
    .filter((item) => item.reasons.length > 0)
    .sort((left, right) => right.risk - left.risk)
  for (const item of risky) {
    for (const reason of item.reasons) {
      insights.push(insightForReason(item.brickId, item, reason, locale))
      if (insights.length >= limit) return insights
    }
  }
  if (insights.length === 0) {
    insights.push({ severity: 'info', reason: copy[locale].healthy[0], suggestion: copy[locale].healthy[1] })
  }
  return insights
}

const getPrimaryFailureMode = (result: DisasterSimulationResult) => {
  const counts = new Map<DisasterFailureMode, number>()
  for (const mode of result.failureModeByBrickId.values()) counts.set(mode, (counts.get(mode) ?? 0) + 1)
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0]
}

export const createStabilityReport = (
  plan: BuildPlan,
  analysis: StabilityAnalysis,
  locale: Locale,
  simulation?: DisasterSimulationResult,
  generatedAt = new Date().toISOString(),
): StabilityReport => ({
  schemaVersion: 1,
  generatedAt,
  plan: { id: plan.id, title: plan.title, brickCount: plan.bricks.length },
  summary: {
    score: analysis.stabilityScore,
    tippingMargin: analysis.tippingMargin,
    groundedPercent: Math.round(analysis.groundedMassRatio * 100),
    supportCoveragePercent: Math.round(analysis.averageSupportCoverage * 100),
    connectionRedundancyPercent: Math.round(analysis.connectionRedundancy * 100),
    criticalBrickCount: analysis.criticalBrickIds.length,
  },
  simulation: simulation ? {
    scenario: simulation.options.scenario,
    intensity: simulation.options.intensity,
    directionDegrees: simulation.options.directionDegrees,
    physicsProfile: simulation.options.physicsProfile,
    grade: simulation.grade,
    score: simulation.score,
    survivedBrickCount: simulation.survivedBrickCount,
    failedBrickCount: simulation.failedBrickCount,
    primaryFailureMode: getPrimaryFailureMode(simulation),
  } : undefined,
  insights: createStabilityInsights(analysis, locale).map((insight) => {
    const placed = insight.brickId ? plan.bricks.find((brick) => brick.id === insight.brickId) : undefined
    const definition = placed ? brickById.get(placed.brickId) : undefined
    return {
      ...insight,
      partLabel: definition ? `${definition.name} #${definition.partNumber}` : insight.brickId,
    }
  }),
})

export const formatStabilityReportMarkdown = (report: StabilityReport, locale: Locale) => {
  const zh = locale === 'zh-CN'
  return [
    `# ${report.plan.title} — ${zh ? '结构分析报告' : 'Structural Analysis Report'}`,
    '',
    `- ${zh ? '零件数' : 'Parts'}: ${report.plan.brickCount}`,
    `- ${zh ? '静态稳定性' : 'Static stability'}: ${report.summary.score}/100`,
    `- ${zh ? '倾覆裕度' : 'Tipping margin'}: ${report.summary.tippingMargin.toFixed(2)}`,
    `- ${zh ? '接地质量' : 'Grounded mass'}: ${report.summary.groundedPercent}%`,
    `- ${zh ? '平均支撑覆盖' : 'Average support coverage'}: ${report.summary.supportCoveragePercent}%`,
    `- ${zh ? '连接冗余' : 'Connection redundancy'}: ${report.summary.connectionRedundancyPercent}%`,
    ...(report.simulation ? [
      `- ${zh ? '灾害模拟' : 'Hazard simulation'}: ${report.simulation.scenario} ${report.simulation.intensity}% · ${report.simulation.grade} (${report.simulation.score}/100)`,
      `- ${zh ? '最终存活' : 'Final survival'}: ${report.simulation.survivedBrickCount}/${report.plan.brickCount}`,
    ] : []),
    '',
    `## ${zh ? '主要发现与建议' : 'Findings and recommendations'}`,
    '',
    ...report.insights.flatMap((insight, index) => {
      const part = insight.partLabel ?? insight.brickId ?? (zh ? '整体结构' : 'Whole structure')
      return [`${index + 1}. **${part}** — ${insight.reason}`, `   - ${insight.suggestion}`]
    }),
    '',
    `_${zh ? '本报告由 Brick Flow 的确定性近似模型生成，不替代工程认证。' : 'Generated by Brick Flow’s deterministic approximation; not an engineering certification.'}_`,
  ].join('\n')
}

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

export const formatStabilityReportSvg = (report: StabilityReport, locale: Locale) => {
  const zh = locale === 'zh-CN'
  const findings = report.insights.slice(0, 3)
  const height = 420 + findings.length * 76
  const scoreColor = report.summary.score >= 80 ? '#16a34a' : report.summary.score >= 55 ? '#d97706' : '#dc2626'
  const findingRows = findings.map((insight, index) => {
    const y = 390 + index * 76
    return `<g transform="translate(64 ${y})"><circle cx="7" cy="-5" r="7" fill="${insight.severity === 'critical' ? '#dc2626' : insight.severity === 'warning' ? '#d97706' : '#2563eb'}"/><text x="28" y="0" font-size="18" font-weight="600" fill="#172033">${escapeXml(insight.reason)}</text><text x="28" y="30" font-size="15" fill="#526078">${escapeXml(insight.suggestion)}</text></g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}">
  <rect width="1000" height="${height}" rx="28" fill="#f7f8fc"/>
  <rect x="40" y="40" width="920" height="${height - 80}" rx="22" fill="#ffffff" stroke="#dfe3ec"/>
  <text x="64" y="88" font-family="system-ui,sans-serif" font-size="18" font-weight="700" fill="#2563eb">BRICK FLOW</text>
  <text x="64" y="132" font-family="system-ui,sans-serif" font-size="30" font-weight="700" fill="#172033">${escapeXml(report.plan.title)}</text>
  <text x="64" y="163" font-family="system-ui,sans-serif" font-size="16" fill="#657089">${zh ? '结构分析报告' : 'Structural analysis report'} · ${report.plan.brickCount} ${zh ? '个零件' : 'parts'}</text>
  <circle cx="150" cy="252" r="64" fill="${scoreColor}" opacity="0.12"/>
  <text x="150" y="248" text-anchor="middle" font-family="system-ui,sans-serif" font-size="42" font-weight="800" fill="${scoreColor}">${report.summary.score}</text>
  <text x="150" y="278" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" fill="#657089">${zh ? '静态稳定性' : 'STATIC STABILITY'}</text>
  <g font-family="system-ui,sans-serif" fill="#172033"><text x="290" y="225" font-size="16">${zh ? '接地质量' : 'Grounded mass'}</text><text x="560" y="225" font-size="22" font-weight="700">${report.summary.groundedPercent}%</text><text x="290" y="268" font-size="16">${zh ? '支撑覆盖' : 'Support coverage'}</text><text x="560" y="268" font-size="22" font-weight="700">${report.summary.supportCoveragePercent}%</text><text x="290" y="311" font-size="16">${zh ? '连接冗余' : 'Connection redundancy'}</text><text x="560" y="311" font-size="22" font-weight="700">${report.summary.connectionRedundancyPercent}%</text><text x="710" y="225" font-size="16">${zh ? '风险零件' : 'Critical parts'}</text><text x="880" y="225" font-size="22" font-weight="700">${report.summary.criticalBrickCount}</text><text x="710" y="268" font-size="16">${zh ? '倾覆裕度' : 'Tipping margin'}</text><text x="880" y="268" font-size="22" font-weight="700">${report.summary.tippingMargin.toFixed(2)}</text>${report.simulation ? `<text x="710" y="311" font-size="16">${zh ? '模拟得分' : 'Simulation'}</text><text x="880" y="311" font-size="22" font-weight="700">${report.simulation.grade} · ${report.simulation.score}</text>` : ''}</g>
  <text x="64" y="354" font-family="system-ui,sans-serif" font-size="19" font-weight="700" fill="#172033">${zh ? '主要发现与建议' : 'Findings and recommendations'}</text>
  <g font-family="system-ui,sans-serif">${findingRows}</g>
  <text x="64" y="${height - 58}" font-family="system-ui,sans-serif" font-size="13" fill="#8a94a8">${zh ? '确定性近似模型，不替代工程认证' : 'Deterministic approximation · not an engineering certification'}</text>
</svg>`
}
