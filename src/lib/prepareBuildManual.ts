import type { BuildPlan } from '../types/bricks'
import type { BuildPlanIssue } from './planUtils'
import { serializeBuildManual, type ManualLocale } from './manualSerializer'
import { prepareConstructionValidator } from './constructionValidationCache'

export const prepareBuildManual = async (plan: BuildPlan, locale: ManualLocale, preparedIssues?: BuildPlanIssue[]) =>
  serializeBuildManual(plan, locale, preparedIssues, await prepareConstructionValidator(plan))
