import { BookOpen, Download, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getEditorValidation } from '../lib/editorAnalysisClient'
import { useI18n } from '../lib/i18n'
import { getBlockingBuildPlanIssues, summarizeBuildPlanIssues, validateBuildPlanBasics, type validateBuildPlan } from '../lib/planUtils'
import type { BuildPlan } from '../types/bricks'

type Props = {
  plan: BuildPlan
  onRenamePlan: (title: string) => void
  onOpenManual: () => void
  onExport: () => void
  onExportLDraw: () => void
  onImportPlan: (file?: File) => void
}

export const CurrentWorkPanel = ({ plan, onRenamePlan, onOpenManual, onExport, onExportLDraw, onImportPlan }: Props) => {
  const { locale, t } = useI18n()
  const [backgroundValidation, setBackgroundValidation] = useState<{
    plan: BuildPlan
    issues: ReturnType<typeof validateBuildPlan>
  }>()
  const [geometryLoadFailure, setGeometryLoadFailure] = useState<BuildPlan>()
  const basicPlanIssues = useMemo(() => validateBuildPlanBasics(plan), [plan])

  useEffect(() => {
    let isCanceled = false
    const timeoutId = window.setTimeout(() => {
      void getEditorValidation(plan).then((issues) => {
        if (isCanceled) return
        setGeometryLoadFailure(undefined)
        setBackgroundValidation({ plan, issues })
      }).catch(() => {
        if (!isCanceled) setGeometryLoadFailure(plan)
      })
    }, plan.bricks.length >= 800 ? 300 : 120)

    return () => {
      isCanceled = true
      window.clearTimeout(timeoutId)
    }
  }, [plan])

  const hasGeometryLoadFailure = geometryLoadFailure === plan
  const isStructureChecking = !hasGeometryLoadFailure && backgroundValidation?.plan !== plan
  const planIssues = useMemo(
    () => {
      return backgroundValidation?.plan === plan ? backgroundValidation.issues : basicPlanIssues
    },
    [backgroundValidation, basicPlanIssues, plan],
  )
  const blockingPlanIssues = useMemo(() => getBlockingBuildPlanIssues(planIssues), [planIssues])
  const planIssueSummary = useMemo(() => summarizeBuildPlanIssues(planIssues, locale), [locale, planIssues])
  const structureStatusTone = hasGeometryLoadFailure || blockingPlanIssues.length > 0
    ? 'warn'
    : planIssues.length > 0 || isStructureChecking
      ? 'notice'
      : 'ok'
  const structureStatusText = hasGeometryLoadFailure ? t('error.geometryLoad') : isStructureChecking
    ? planIssues.length > 0
      ? `${planIssueSummary} · ${t('control.validationCheckingLarge')}`
      : t('control.validationCheckingLarge')
    : planIssues.length > 0
      ? planIssueSummary
      : t('common.structureOk')

  return (
    <section className="project-work-card">
      <label className="plan-title-field">
        <span>{t('control.planName')}</span>
        <input
          type="text"
          value={plan.title}
          placeholder={t('control.planNamePlaceholder')}
          onChange={(event) => onRenamePlan(event.target.value)}
        />
      </label>
      <p>{t('common.parts', { count: plan.bricks.length })} · {t('common.steps', { count: plan.steps.length })} · {t(`control.source.${plan.source}`)}</p>
      <p className={`structure-status ${structureStatusTone}`}>
        {structureStatusText}
      </p>
      <div className="project-work-actions">
        <button type="button" onClick={onOpenManual}>
          <BookOpen size={16} />
          {t('control.buildManual')}
        </button>
        <button type="button" onClick={onExport}>
          <Download size={16} />
          {t('common.exportJson')}
        </button>
        <button type="button" onClick={onExportLDraw}>
          <Download size={16} />
          {t('control.exportLDraw')}
        </button>
        <label className="file-button plan-import-button">
          <Upload size={16} />
          <span>{t('control.importPlan')}</span>
          <input
            type="file"
            accept="application/json,text/plain,.json,.ldr,.mpd"
            onChange={(event) => {
              onImportPlan(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>
      </div>
    </section>
  )
}
