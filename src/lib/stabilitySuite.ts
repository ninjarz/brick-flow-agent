import type { DisasterFailureMode, DisasterPhysicsProfile, DisasterScenario, DisasterSimulationOptions, DisasterSimulationResult } from './disasterSimulation'

export type StabilitySuitePreset = 'quick' | 'standard' | 'stress'

export type StabilitySuiteCase = {
  id: string
  scenario: DisasterScenario
  intensity: number
  directionDegrees: number
  physicsProfile: DisasterPhysicsProfile
}

export type StabilitySuiteCaseResult = StabilitySuiteCase & {
  score: number
  grade: DisasterSimulationResult['grade']
  survivedBrickCount: number
  failedBrickCount: number
  primaryFailureMode?: DisasterFailureMode
}

export type StabilitySuiteResult = {
  schemaVersion: 1
  generatedAt: string
  plan: { id: string; title: string; brickCount: number; fingerprint: string }
  preset: StabilitySuitePreset
  physicsProfile: DisasterPhysicsProfile
  resilienceScore: number
  passedCaseCount: number
  weakestCaseId: string
  cases: StabilitySuiteCaseResult[]
}

const configKey = 'brick-flow-agent:stability-suite-config:v1'
const resultPrefix = 'brick-flow-agent:stability-suite-result:v1:'
const resultKey = (planId: string) => `${resultPrefix}${encodeURIComponent(planId)}`

const directions = [0, 90, 180, 270]

const createCase = (
  scenario: DisasterScenario,
  intensity: number,
  directionDegrees: number,
  physicsProfile: DisasterPhysicsProfile,
): StabilitySuiteCase => ({
  id: `${scenario}-${intensity}-${directionDegrees}-${physicsProfile}`,
  scenario,
  intensity,
  directionDegrees,
  physicsProfile,
})

export const getStabilitySuiteCases = (
  preset: StabilitySuitePreset,
  physicsProfile: DisasterPhysicsProfile,
): StabilitySuiteCase[] => {
  if (preset === 'quick') {
    return [
      createCase('wind', 70, 0, physicsProfile),
      createCase('wind', 70, 90, physicsProfile),
      createCase('rain', 70, 0, physicsProfile),
      createCase('earthquake', 70, 0, physicsProfile),
      createCase('earthquake', 70, 90, physicsProfile),
    ]
  }
  if (preset === 'stress') {
    return [
      ...directions.map((direction) => createCase('wind', 90, direction, physicsProfile)),
      createCase('rain', 90, 0, physicsProfile),
      ...directions.map((direction) => createCase('earthquake', 90, direction, physicsProfile)),
    ]
  }
  return [
    ...directions.map((direction) => createCase('wind', 60, direction, physicsProfile)),
    createCase('rain', 60, 0, physicsProfile),
    createCase('rain', 85, 0, physicsProfile),
    createCase('earthquake', 60, 0, physicsProfile),
    createCase('earthquake', 60, 90, physicsProfile),
    createCase('earthquake', 85, 0, physicsProfile),
    createCase('earthquake', 85, 90, physicsProfile),
  ]
}

const primaryFailureMode = (result: DisasterSimulationResult) => {
  const counts = new Map<DisasterFailureMode, number>()
  for (const mode of result.failureModeByBrickId.values()) counts.set(mode, (counts.get(mode) ?? 0) + 1)
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
}

export const summarizeStabilitySuiteCase = (
  testCase: StabilitySuiteCase,
  result: DisasterSimulationResult,
): StabilitySuiteCaseResult => ({
  ...testCase,
  score: result.score,
  grade: result.grade,
  survivedBrickCount: result.survivedBrickCount,
  failedBrickCount: result.failedBrickCount,
  primaryFailureMode: primaryFailureMode(result),
})

export const createStabilitySuiteResult = (
  plan: StabilitySuiteResult['plan'],
  preset: StabilitySuitePreset,
  physicsProfile: DisasterPhysicsProfile,
  cases: StabilitySuiteCaseResult[],
  generatedAt = new Date().toISOString(),
): StabilitySuiteResult => {
  const weakest = [...cases].sort((left, right) => left.score - right.score || right.failedBrickCount - left.failedBrickCount)[0]
  return {
    schemaVersion: 1,
    generatedAt,
    plan,
    preset,
    physicsProfile,
    resilienceScore: cases.length ? Math.round(cases.reduce((sum, item) => sum + item.score, 0) / cases.length) : 0,
    passedCaseCount: cases.filter((item) => item.score >= 70).length,
    weakestCaseId: weakest?.id ?? '',
    cases,
  }
}

const isSuiteResult = (value: unknown): value is StabilitySuiteResult => {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<StabilitySuiteResult>
  return item.schemaVersion === 1 && typeof item.generatedAt === 'string' &&
    typeof item.resilienceScore === 'number' && typeof item.weakestCaseId === 'string' &&
    Array.isArray(item.cases) && Boolean(item.plan && typeof item.plan.id === 'string' && typeof item.plan.fingerprint === 'string')
}

export const loadStabilitySuiteConfig = (): { preset: StabilitySuitePreset; physicsProfile: DisasterPhysicsProfile } => {
  if (typeof window === 'undefined') return { preset: 'quick', physicsProfile: 'challenge' }
  try {
    const value = JSON.parse(window.localStorage.getItem(configKey) ?? '{}') as Record<string, unknown>
    return {
      preset: value.preset === 'standard' || value.preset === 'stress' ? value.preset : 'quick',
      physicsProfile: value.physicsProfile === 'realistic' ? 'realistic' : 'challenge',
    }
  } catch {
    return { preset: 'quick', physicsProfile: 'challenge' }
  }
}

export const saveStabilitySuiteConfig = (config: { preset: StabilitySuitePreset; physicsProfile: DisasterPhysicsProfile }) => {
  try { window.localStorage.setItem(configKey, JSON.stringify(config)) } catch { /* Optional preference. */ }
}

export const loadStabilitySuiteResult = (planId: string): StabilitySuiteResult | undefined => {
  if (typeof window === 'undefined') return undefined
  try {
    const value = JSON.parse(window.localStorage.getItem(resultKey(planId)) ?? 'null') as unknown
    return isSuiteResult(value) ? value : undefined
  } catch {
    return undefined
  }
}

export const saveStabilitySuiteResult = (result: StabilitySuiteResult) => {
  try { window.localStorage.setItem(resultKey(result.plan.id), JSON.stringify(result)) } catch { /* Optional result cache. */ }
  return result
}

export const clearStabilitySuiteResult = (planId: string) => {
  try { window.localStorage.removeItem(resultKey(planId)) } catch { /* Optional result cache. */ }
}

export const suiteCaseToOptions = (testCase: StabilitySuiteCase): DisasterSimulationOptions => ({
  scenario: testCase.scenario,
  intensity: testCase.intensity,
  directionDegrees: testCase.directionDegrees,
  physicsProfile: testCase.physicsProfile,
})

export const formatStabilitySuiteMarkdown = (result: StabilitySuiteResult, locale: 'zh-CN' | 'en-US') => {
  const zh = locale === 'zh-CN'
  return [
    `# ${result.plan.title} — ${zh ? '结构测试套件报告' : 'Structural Test Suite Report'}`,
    '',
    `- ${zh ? '综合韧性' : 'Resilience score'}: ${result.resilienceScore}/100`,
    `- ${zh ? '通过工况' : 'Passing cases'}: ${result.passedCaseCount}/${result.cases.length}`,
    `- ${zh ? '预设' : 'Preset'}: ${result.preset}`,
    `- ${zh ? '物理档案' : 'Physics profile'}: ${result.physicsProfile}`,
    `- ${zh ? '生成时间' : 'Generated'}: ${result.generatedAt}`,
    '',
    `| ${zh ? '工况' : 'Case'} | ${zh ? '强度' : 'Intensity'} | ${zh ? '方向' : 'Direction'} | ${zh ? '得分' : 'Score'} | ${zh ? '存活' : 'Survived'} | ${zh ? '主要失效' : 'Primary failure'} |`,
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...result.cases.map((item) => `| ${item.scenario}${item.id === result.weakestCaseId ? ` (${zh ? '最弱' : 'weakest'})` : ''} | ${item.intensity}% | ${item.directionDegrees}° | ${item.score} (${item.grade}) | ${item.survivedBrickCount}/${result.plan.brickCount} | ${item.primaryFailureMode ?? '—'} |`),
    '',
    `_${zh ? '确定性近似模型，不替代工程认证。' : 'Deterministic approximation; not an engineering certification.'}_`,
  ].join('\n')
}

const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export const formatStabilitySuiteSvg = (result: StabilitySuiteResult, locale: 'zh-CN' | 'en-US') => {
  const zh = locale === 'zh-CN'
  const height = 300 + result.cases.length * 48
  const rows = result.cases.map((item, index) => {
    const y = 260 + index * 48
    const color = item.score >= 80 ? '#16a34a' : item.score >= 55 ? '#d97706' : '#dc2626'
    return `<g transform="translate(56 ${y})"><text font-size="15" font-weight="650" fill="#172033">${escapeXml(item.scenario)} · ${item.intensity}% · ${item.directionDegrees}°${item.id === result.weakestCaseId ? ` · ${zh ? '最弱' : 'weakest'}` : ''}</text><text x="650" font-size="16" fill="#64748b">${item.survivedBrickCount}/${result.plan.brickCount}</text><text x="790" font-size="18" font-weight="750" fill="${color}">${item.grade} · ${item.score}</text></g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}"><rect width="960" height="${height}" rx="24" fill="#f7f8fc"/><text x="56" y="62" font-family="system-ui,sans-serif" font-size="17" font-weight="700" fill="#2563eb">BRICK FLOW</text><text x="56" y="106" font-family="system-ui,sans-serif" font-size="29" font-weight="750" fill="#172033">${escapeXml(result.plan.title)}</text><text x="56" y="142" font-family="system-ui,sans-serif" font-size="16" fill="#64748b">${zh ? '结构测试套件' : 'Structural test suite'} · ${result.preset} · ${result.physicsProfile}</text><text x="56" y="202" font-family="system-ui,sans-serif" font-size="32" font-weight="800" fill="#2563eb">${result.resilienceScore}/100</text><text x="250" y="202" font-family="system-ui,sans-serif" font-size="16" fill="#64748b">${zh ? '通过' : 'Passed'} ${result.passedCaseCount}/${result.cases.length}</text><g font-family="system-ui,sans-serif">${rows}</g></svg>`
}
