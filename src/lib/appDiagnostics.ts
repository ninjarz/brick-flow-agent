import type { BuildPlan } from '../types/bricks'

export const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
export const repositoryUrl = 'https://github.com/ninjarz/brick-flow-agent'

export type AppDiagnostics = {
  appVersion: string
  browser: string
  platform: string
  locale: string
  brickCount: number
  packCounts: Record<string, number>
}

export const createAppDiagnostics = (
  plan: BuildPlan,
  locale: string,
  userAgent = typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
  platform = typeof navigator === 'undefined' ? 'unknown' : navigator.platform,
): AppDiagnostics => ({
  appVersion,
  browser: userAgent,
  platform,
  locale,
  brickCount: plan.bricks.length,
  packCounts: plan.bricks.reduce<Record<string, number>>((counts, brick) => {
    const pack = brick.brickId.startsWith('minecraft-') ? 'minecraft' : 'lego'
    counts[pack] = (counts[pack] ?? 0) + 1
    return counts
  }, {}),
})

export const formatDiagnosticsMarkdown = (diagnostics: AppDiagnostics) => [
  '<!-- Please keep this diagnostic block; remove any line you do not want to share. -->',
  '### Environment',
  '',
  `- Brick Flow: ${diagnostics.appVersion}`,
  `- Browser: ${diagnostics.browser}`,
  `- Platform: ${diagnostics.platform}`,
  `- Locale: ${diagnostics.locale}`,
  `- Parts: ${diagnostics.brickCount}`,
  `- Packs: ${Object.entries(diagnostics.packCounts).map(([pack, count]) => `${pack} ${count}`).join(', ') || 'none'}`,
].join('\n')

export const createFeedbackUrl = (plan: BuildPlan, locale: string) => {
  const diagnostics = createAppDiagnostics(plan, locale)
  const body = [
    '### What happened or what would you like to improve?',
    '',
    '',
    '### Steps or context',
    '',
    '',
    formatDiagnosticsMarkdown(diagnostics),
  ].join('\n')
  const query = new URLSearchParams({
    title: '[Feedback] ',
    body,
  })
  return `${repositoryUrl}/issues/new?${query.toString()}`
}
