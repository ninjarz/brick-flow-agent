import { describe, expect, it } from 'vitest'
import { generateBuildPlan } from './localGenerator'
import { analyzeBuildStability } from './stabilityAnalysis'
import { createStabilityInsights, createStabilityReport, formatStabilityReportMarkdown, formatStabilityReportSvg } from './stabilityReport'

describe('stability reports', () => {
  it('turns structural reasons into actionable localized insights', () => {
    const plan = generateBuildPlan({ prompt: '一座小桥' })
    const analysis = analyzeBuildStability(plan.bricks)
    const insights = createStabilityInsights(analysis, 'zh-CN')
    expect(insights.length).toBeGreaterThan(0)
    expect(insights[0].suggestion.length).toBeGreaterThan(0)
  })

  it('exports a stable report schema and markdown', () => {
    const plan = generateBuildPlan({ prompt: '一个小房子' })
    const analysis = analyzeBuildStability(plan.bricks)
    const report = createStabilityReport(plan, analysis, 'en-US', undefined, '2026-08-27T00:00:00.000Z')
    expect(report.schemaVersion).toBe(1)
    expect(report.plan.brickCount).toBe(plan.bricks.length)
    expect(formatStabilityReportMarkdown(report, 'en-US')).toContain('Structural Analysis Report')
    expect(formatStabilityReportSvg(report, 'en-US')).toContain('<svg')
    const themedSvg = formatStabilityReportSvg(report, 'en-US', {
      theme: 'dark',
      thumbnailDataUrl: 'data:image/png;base64,preview',
    })
    expect(themedSvg).toContain('fill="#0f172a"')
    expect(themedSvg).toContain('<image')
    expect(themedSvg).toContain('2026-08-27T00:00:00.000Z')
  })
})
