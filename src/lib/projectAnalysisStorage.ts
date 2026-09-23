import { safeStorage } from './safeStorage'

/** Claim pre-project analysis data for the first opened project containing its plan. */
export const claimLegacyAnalysis = (legacyPrefix: string, scopedPrefix: string, projectId: string, planId: string) => {
  const legacyKey = `${legacyPrefix}${encodeURIComponent(planId)}`
  const scopedKey = `${scopedPrefix}${encodeURIComponent(projectId)}`
  const oldValue = safeStorage.getItem(legacyKey)
  if (oldValue === null) return
  if (safeStorage.getItem(scopedKey) !== null || safeStorage.setItem(scopedKey, oldValue)) {
    safeStorage.removeItem(legacyKey)
  }
}

export const claimLegacyProjectAnalysis = (projectId: string, planId: string) => {
  claimLegacyAnalysis('brick-flow-agent:stability-history:v1:', 'brick-flow-agent:stability-history:v2:project:', projectId, planId)
  claimLegacyAnalysis('brick-flow-agent:stability-suite-result:v1:', 'brick-flow-agent:stability-suite-result:v2:project:', projectId, planId)
}

export const clearProjectAnalysis = (projectId: string) => {
  safeStorage.removeItem(`brick-flow-agent:stability-history:v2:project:${encodeURIComponent(projectId)}`)
  safeStorage.removeItem(`brick-flow-agent:stability-suite-result:v2:project:${encodeURIComponent(projectId)}`)
}
