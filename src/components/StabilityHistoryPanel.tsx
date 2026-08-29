import { Download, Pencil, Trash2 } from 'lucide-react'
import { compareStabilityReports, formatStabilityComparisonMarkdown, formatStabilityComparisonSvg, type StabilitySnapshot } from '../lib/stabilityHistory'
import type { StabilityReport } from '../lib/stabilityReport'
import { useI18n } from '../lib/i18n'

type Props = {
  history: StabilitySnapshot[]
  currentReport: StabilityReport
  baselineId: string
  onBaselineChange: (id: string) => void
  onRename: (snapshot: StabilitySnapshot) => void
  onDelete: (snapshot: StabilitySnapshot) => void
}

const labels: Record<string, { zh: string; en: string }> = {
  score: { zh: '稳定性', en: 'Stability' },
  tippingMargin: { zh: '倾覆裕度', en: 'Tipping margin' },
  groundedPercent: { zh: '接地质量', en: 'Grounded mass' },
  supportCoveragePercent: { zh: '支撑覆盖', en: 'Support coverage' },
  connectionRedundancyPercent: { zh: '连接冗余', en: 'Connection redundancy' },
  criticalBrickCount: { zh: '风险零件', en: 'Critical parts' },
  simulationScore: { zh: '模拟得分', en: 'Simulation score' },
  survivedBrickCount: { zh: '存活零件', en: 'Surviving parts' },
}

const download = (name: string, content: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export const StabilityHistoryPanel = ({ history, currentReport, baselineId, onBaselineChange, onRename, onDelete }: Props) => {
  const { locale } = useI18n()
  const zh = locale === 'zh-CN'
  const baseline = history.find((snapshot) => snapshot.id === baselineId)
  const comparison = baseline ? compareStabilityReports(baseline.report, currentReport) : []
  return (
    <section className="stability-history-panel">
      <header>
        <div>
          <h3>{zh ? '分析历史与对比' : 'Analysis history and comparison'}</h3>
          <p>{zh ? `当前项目最多保留 ${history.length}/10 条记录。` : `${history.length}/10 records retained for this project.`}</p>
        </div>
        {baseline && (
          <div className="stability-comparison-downloads">
            <button type="button" onClick={() => download(`${currentReport.plan.title}-comparison.md`, formatStabilityComparisonMarkdown(baseline, currentReport, locale), 'text/markdown')}><Download size={14} />MD</button>
            <button type="button" onClick={() => download(`${currentReport.plan.title}-comparison.json`, JSON.stringify({ schemaVersion: 1, baseline, current: currentReport, metrics: comparison }, null, 2), 'application/json')}><Download size={14} />JSON</button>
            <button type="button" onClick={() => download(`${currentReport.plan.title}-comparison.svg`, formatStabilityComparisonSvg(baseline, currentReport, locale), 'image/svg+xml')}><Download size={14} />SVG</button>
          </div>
        )}
      </header>
      {baseline && (
        <div className="stability-comparison-grid">
          {comparison.filter((item) => item.outcome !== 'unavailable').map((item) => {
            const decimals = item.key === 'tippingMargin' ? 2 : 0
            return (
              <article key={item.key} className={item.outcome}>
                <span>{labels[item.key]?.[zh ? 'zh' : 'en'] ?? item.key}</span>
                <strong>{item.before?.toFixed(decimals)} → {item.after?.toFixed(decimals)}</strong>
                <small>{item.delta && item.delta > 0 ? '+' : ''}{item.delta?.toFixed(decimals)} · {item.outcome}</small>
              </article>
            )
          })}
        </div>
      )}
      <div className="stability-history-list">
        {history.map((snapshot, index) => (
          <article key={snapshot.id} className={snapshot.id === baselineId ? 'active' : ''}>
            <button type="button" className="history-baseline" onClick={() => onBaselineChange(snapshot.id)}>
              <span>{snapshot.name}</span>
              <small>{new Date(snapshot.createdAt).toLocaleString(locale)} · {snapshot.report.summary.score}/100{index === 0 ? ` · ${zh ? '最新' : 'Latest'}` : ''}</small>
            </button>
            <button type="button" aria-label={zh ? '重命名记录' : 'Rename record'} onClick={() => onRename(snapshot)}><Pencil size={13} /></button>
            <button type="button" aria-label={zh ? '删除记录' : 'Delete record'} onClick={() => onDelete(snapshot)}><Trash2 size={13} /></button>
          </article>
        ))}
      </div>
    </section>
  )
}
