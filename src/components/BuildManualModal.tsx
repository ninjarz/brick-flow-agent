import { BookOpen, Download, Pause, Play, RotateCcw, X } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { brickById, colorHex } from '../data/basicBricks'
import { useI18n } from '../lib/i18n'
import { manualStepPageSize, type getManualStepPage } from '../lib/manualPagination'
import type { BuildManual } from '../lib/manualSerializer'
import type { PlacedBrick } from '../types/bricks'
import { BrickCountList } from './BrickCountList'
import { LazyBrickGlyph } from './LazyBrickGlyph'
import { SceneErrorBoundary } from './SceneErrorBoundary'

const BrickScene = lazy(() => import('./BrickScene').then((module) => ({ default: module.BrickScene })))

type ManualStep = BuildManual['steps'][number]
type ManualStepValidation = {
  checked?: boolean
  ok: boolean
  issueCount?: number
  summary: string
}

type Props = {
  buildManual: BuildManual
  manualPlanId?: string
  manualStepIndex: number
  selectedManualStep?: ManualStep
  selectedManualValidation?: ManualStepValidation
  manualStepPage: ReturnType<typeof getManualStepPage>
  visibleManualSteps: ManualStep[]
  manualDisplayBricks: PlacedBrick[]
  manualHighlightedIds: string[]
  manualCameraFocusIds: string[]
  isManualPlaying: boolean
  isManualExploded: boolean
  manualPlaybackIntervalMs: number
  manualIssueCount: number
  manualBlockingIssueCount: number
  manualIssueSummary: string
  manualCopyStatus: 'idle' | 'copied' | 'failed'
  exportingManualHtml: boolean
  onClose: () => void
  onSetManualStepIndex: (value: number | ((current: number) => number)) => void
  onSetIsManualPlaying: (value: boolean | ((playing: boolean) => boolean)) => void
  onSetIsManualExploded: (value: boolean) => void
  onSetManualPlaybackIntervalMs: (value: number) => void
  onCopyMarkdown: () => void
  onExportMarkdown: () => void
  onExportHtml: () => void
  onExportJson: () => void
  getManualMarkdown: () => string
  ignoreSceneInteraction: () => void
}

export const BuildManualModal = ({
  buildManual,
  manualPlanId,
  manualStepIndex,
  selectedManualStep,
  selectedManualValidation,
  manualStepPage,
  visibleManualSteps,
  manualDisplayBricks,
  manualHighlightedIds,
  manualCameraFocusIds,
  isManualPlaying,
  isManualExploded,
  manualPlaybackIntervalMs,
  manualIssueCount,
  manualBlockingIssueCount,
  manualIssueSummary,
  manualCopyStatus,
  exportingManualHtml,
  onClose,
  onSetManualStepIndex,
  onSetIsManualPlaying,
  onSetIsManualExploded,
  onSetManualPlaybackIntervalMs,
  onCopyMarkdown,
  onExportMarkdown,
  onExportHtml,
  onExportJson,
  getManualMarkdown,
  ignoreSceneInteraction,
}: Props) => {
  const { locale, t } = useI18n()

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="manual-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="build-manual-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="build-manual-title">{t('manual.title')}</h2>
            <p>{buildManual.title} · {t('common.parts', { count: buildManual.totalPieces })} · {t('common.pages', { count: buildManual.totalSteps })}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        {selectedManualStep && (
          <section className="manual-preview">
            <div>
              <h3>{t('manual.pageTitle', { page: selectedManualStep.stepNumber, title: selectedManualStep.title })}</h3>
              <p>{selectedManualStep.description}</p>
              <p className={`structure-status ${selectedManualValidation?.checked === false ? 'pending' : selectedManualValidation?.ok ? ((selectedManualValidation?.issueCount ?? 0) > 0 ? 'notice' : 'ok') : 'warn'}`}>
                {selectedManualValidation?.summary}
              </p>
            </div>
            <div className="manual-timeline">
              <details className="manual-playback">
                <summary>{locale === 'zh-CN' ? '播放与显示' : 'Playback & display'}</summary>
                <div className="manual-timeline-actions">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isManualPlaying && manualStepIndex >= buildManual.steps.length - 1) onSetManualStepIndex(0)
                      onSetIsManualPlaying((playing) => !playing)
                    }}
                  >
                    {isManualPlaying ? <Pause size={15} /> : <Play size={15} />}
                    {t(isManualPlaying ? 'manual.pauseTimeline' : 'manual.playTimeline')}
                  </button>
                  <button type="button" onClick={() => { onSetIsManualPlaying(false); onSetManualStepIndex(0) }}>
                    <RotateCcw size={15} />
                    {t('manual.restartTimeline')}
                  </button>
                  <label>
                    <input type="checkbox" checked={isManualExploded} onChange={(event) => onSetIsManualExploded(event.target.checked)} />
                    {t('manual.explodedView')}
                  </label>
                  <select value={manualPlaybackIntervalMs} onChange={(event) => onSetManualPlaybackIntervalMs(Number(event.target.value))} aria-label={t('manual.playbackSpeed')}>
                    <option value={2000}>0.5×</option>
                    <option value={1200}>1×</option>
                    <option value={650}>2×</option>
                  </select>
                </div>
              </details>
              <input
                type="range"
                min={0}
                max={Math.max(0, buildManual.steps.length - 1)}
                value={manualStepIndex}
                onChange={(event) => { onSetIsManualPlaying(false); onSetManualStepIndex(Number(event.target.value)) }}
                aria-label={t('manual.timeline')}
              />
              <span>{t('manual.timelineProgress', { current: manualStepIndex + 1, total: buildManual.steps.length })}</span>
            </div>
            <div className="manual-assembly-guides">
              {(selectedManualStep.installationLabels ?? [...new Set(selectedManualStep.addPieces.map((piece) => piece.assembly.label))]).map((label) => <span key={label}>{label}</span>)}
            </div>
            <aside className="manual-current-parts">
              <h3>{locale === 'zh-CN' ? '本步零件' : 'Parts for this step'}</h3>
              {selectedManualStep.stepInventory.length ? selectedManualStep.stepInventory.map(item => {
                const definition = brickById.get(item.brickId)
                return (
                  <div className="manual-part-item" key={item.key}>
                    {definition ? <LazyBrickGlyph brickId={definition.id} kind={definition.kind} footprint={definition.footprint} color={item.color} className="manual-part-thumb" />
                      : <span className="manual-part-color" style={{ backgroundColor: colorHex[item.color] ?? '#cbd5e1' }} />}
                    <div><strong>{item.name}</strong><small>{brickById.get(item.brickId)?.partNumber ?? item.brickId}</small></div>
                    <b>×{item.quantity}</b>
                  </div>
                )
              }) : <p>{locale === 'zh-CN' ? '安装已完成的分总成' : 'Install the completed assembly'}</p>}
            </aside>
            <div className="manual-preview-viewer">
              <SceneErrorBoundary locale={locale} resetKey={`manual:${manualPlanId ?? 'manual'}:${selectedManualStep.stepNumber}`}>
                <Suspense fallback={<div className="scene-loading">{t('scene.loading')}</div>}>
                  <BrickScene
                    bricks={manualDisplayBricks}
                    showSupportWarnings={Boolean(selectedManualStep.construction) && !isManualExploded}
                    selectedId=""
                    highlightedIds={manualHighlightedIds}
                    hiddenPrintBrickIds={selectedManualStep.construction?.hiddenPrintBrickIds}
                    cameraFocusBrickIds={manualCameraFocusIds}
                    cameraFrameKey={`manual:${manualPlanId ?? 'manual'}`}
                    cameraFollowStepKey={`${selectedManualStep.stepNumber}:${isManualExploded ? 'exploded' : 'assembled'}`}
                    initialCameraAzimuthDegrees={selectedManualStep.cameraAzimuthDegrees}
                    onSelect={ignoreSceneInteraction}
                    onNudgeSelected={ignoreSceneInteraction}
                    onRotateSelected={ignoreSceneInteraction}
                    onDeleteSelected={ignoreSceneInteraction}
                  />
                </Suspense>
              </SceneErrorBoundary>
            </div>
            <div className="manual-page-controls">
              <button
                type="button"
                onClick={() => { onSetIsManualPlaying(false); onSetManualStepIndex((current) => Math.max(0, current - 1)) }}
                disabled={manualStepIndex === 0}
              >
                {t('manual.prev')}
              </button>
              <button
                type="button"
                onClick={() => { onSetIsManualPlaying(false); onSetManualStepIndex((current) => Math.min(buildManual.steps.length - 1, current + 1)) }}
                disabled={manualStepIndex >= buildManual.steps.length - 1}
              >
                {t('manual.next')}
              </button>
            </div>
            <label className="manual-step-jump">
              {locale === 'zh-CN' ? '跳至' : 'Go to'}
              <input
                type="number"
                min={1}
                max={buildManual.steps.length}
                value={manualStepIndex + 1}
                aria-label={locale === 'zh-CN' ? '跳转步骤' : 'Go to step'}
                onChange={event => {
                  if (event.target.value) {
                    onSetIsManualPlaying(false)
                    onSetManualStepIndex(Math.max(0, Math.min(buildManual.steps.length - 1, Number(event.target.value) - 1)))
                  }
                }}
              />
              / {buildManual.steps.length}
            </label>
          </section>
        )}

        <div className="manual-secondary-tools">
          <details className="manual-drawer">
            <summary>{locale === 'zh-CN' ? '总零件清单' : 'All parts'}</summary>
            <section className="manual-inventory">
              <h3>{t('manual.inventory')}</h3>
              <p className={`structure-status ${manualIssueCount > 0 ? (manualBlockingIssueCount > 0 ? 'warn' : 'notice') : 'ok'}`}>
                {manualIssueCount > 0 ? manualIssueSummary : t('common.structureOk')}
              </p>
              <BrickCountList items={buildManual.inventory} />
            </section>
          </details>
          <details className="manual-drawer">
            <summary>{locale === 'zh-CN' ? '步骤目录' : 'Step directory'}</summary>
            <div className="manual-step-list-header">
              <strong>{t('manual.stepRange', {
                start: manualStepPage.total > 0 ? manualStepPage.start + 1 : 0,
                end: manualStepPage.end,
                total: manualStepPage.total,
              })}</strong>
              <div>
                <button
                  type="button"
                  disabled={!manualStepPage.hasPrevious}
                  onClick={() => {
                    onSetIsManualPlaying(false)
                    onSetManualStepIndex(Math.max(0, manualStepPage.start - manualStepPageSize))
                  }}
                >
                  {t('manual.prevGroup')}
                </button>
                <button
                  type="button"
                  disabled={!manualStepPage.hasNext}
                  onClick={() => {
                    onSetIsManualPlaying(false)
                    onSetManualStepIndex(manualStepPage.end)
                  }}
                >
                  {t('manual.nextGroup')}
                </button>
              </div>
            </div>
            <div className="manual-step-list">
              {visibleManualSteps.map((step, visibleIndex) => {
                const index = manualStepPage.start + visibleIndex
                return (
                  <article
                    key={`${step.stepNumber}-${step.title}`}
                    className={`manual-step-card ${index === manualStepIndex ? 'active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => { onSetIsManualPlaying(false); onSetManualStepIndex(index) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSetIsManualPlaying(false)
                        onSetManualStepIndex(index)
                      }
                    }}
                  >
                    <header>
                      <span>{step.stepNumber}</span>
                      <div>
                        <h3>{step.title}</h3>
                        <p>{step.description}</p>
                      </div>
                    </header>
                    <div className="manual-piece-list">
                      {step.addPieces.map((piece) => (
                        <div key={piece.instanceId}>
                          <strong>{piece.name}</strong>
                          <small>
                            {piece.color} · x{piece.pose.xStud} y{piece.pose.yStud} z{piece.pose.zStud} · {piece.orientationLabel ?? `${piece.rotationDegrees}°`} · {piece.assembly.label}
                          </small>
                        </div>
                      ))}
                    </div>
                    <p className="manual-step-meta">
                      {t('manual.stepMeta', { added: step.addPieces.length, total: step.completedPieceCount })}
                    </p>
                    <p className={`structure-status ${step.validation.checked === false ? 'pending' : step.validation.ok ? (step.validation.issueCount > 0 ? 'notice' : 'ok') : 'warn'}`}>
                      {step.validation.summary}
                    </p>
                  </article>
                )
              })}
            </div>
          </details>
          <details className="manual-drawer">
            <summary>{locale === 'zh-CN' ? '导出与复制' : 'Export & copy'}</summary>
            <div className="manual-actions">
              <button className="secondary" type="button" onClick={onCopyMarkdown}>
                <BookOpen size={16} />
                {manualCopyStatus === 'copied' ? t('common.copied') : manualCopyStatus === 'failed' ? t('common.copyFailed') : t('manual.copyMarkdown')}
              </button>
              <button className="secondary" type="button" onClick={onExportMarkdown}>
                <Download size={16} />
                {t('common.exportMarkdown')}
              </button>
              <button className="secondary" type="button" disabled={exportingManualHtml} onClick={onExportHtml}>
                <Download size={16} />
                {t('common.exportHtml')}
              </button>
              <button className="primary compact-primary" type="button" onClick={onExportJson}>
                <Download size={16} />
                {t('manual.exportJson')}
              </button>
            </div>
          </details>
        </div>
        {manualCopyStatus === 'failed' && (
          <textarea className="manual-copy-output" readOnly value={getManualMarkdown()} aria-label={t('manual.markdownText')} />
        )}
      </section>
    </div>
  )
}
