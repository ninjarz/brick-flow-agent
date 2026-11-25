import type { BuildPlan } from '../types/bricks'
import { getBlockingBuildPlanIssues, repairBuildPlan, validateBuildPlan, type BuildPlanIssue } from './planUtils'

export const finalizeGeneratedPlan = (candidate: BuildPlan, issues: BuildPlanIssue[] = validateBuildPlan(candidate)) => {
  if (getBlockingBuildPlanIssues(issues).length === 0) return { plan: candidate, issues, repairedLocally: false }
  const repaired = repairBuildPlan(candidate)
  const valid = repaired.bricks.length > 0 && getBlockingBuildPlanIssues(validateBuildPlan(repaired)).length === 0
  return { plan: valid ? repaired : undefined, issues, repairedLocally: true }
}
