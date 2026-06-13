import { useMemo, useState } from 'react'
import { BookOpen, Box, Download, ImageUp, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
import { brickDefinitions } from '../data/basicBricks'
import { PLATE_HEIGHT_WORLD } from '../lib/brickUnits'
import { countBricks, getBlockingBuildPlanIssues, summarizeBuildPlanIssues, validateBuildPlan } from '../lib/planUtils'
import { useI18n } from '../lib/i18n'
import { BrickGlyph } from './BrickGlyph'
import type { BrickPack, BuildPlan } from '../types/bricks'

type ControlPanelProps = {
  engineStatusLabel?: string
  engineStatusTone?: 'neutral' | 'warning' | 'pending' | 'success' | 'error'
  onEngineStatusClick?: () => void
  prompt: string
  setPrompt: (value: string) => void
  isGenerating: boolean
  imagePreview?: string
  imageName?: string
  onImage: (file?: File) => void
  onGenerate: () => void
  onCancelGenerate: () => void
  onOpenPromptPreview: () => void
  plan: BuildPlan
  onRenamePlan: (title: string) => void
  onAddBrick: (brickId: string) => void
  onExport: () => void
  onImportPlan: (file?: File) => void
  onResetWorkspace: () => void
  onOpenManual: () => void
}

const getFootprintLabel = (widthStuds: number, depthStuds: number) =>
  `${Math.min(widthStuds, depthStuds)}x${Math.max(widthStuds, depthStuds)}`
const getHeightLabel = (brick: (typeof brickDefinitions)[number]) =>
  brick.pack === 'lego'
    ? `${Number((brick.footprint.heightStuds / PLATE_HEIGHT_WORLD).toFixed(3))}p`
    : `${Number(brick.footprint.heightStuds.toFixed(3))}h`

const isInventoryLimited = (inventory: number) => Number.isFinite(inventory)
const formatInventory = (inventory: number) => isInventoryLimited(inventory) ? String(inventory) : '∞'
const partPackOptions: BrickPack[] = ['lego', 'minecraft']

export const ControlPanel = ({
  engineStatusLabel,
  engineStatusTone = 'neutral',
  onEngineStatusClick,
  prompt,
  setPrompt,
  isGenerating,
  imagePreview,
  imageName,
  onImage,
  onGenerate,
  onCancelGenerate,
  onOpenPromptPreview,
  plan,
  onRenamePlan,
  onAddBrick,
  onExport,
  onImportPlan,
  onResetWorkspace,
  onOpenManual,
}: ControlPanelProps) => {
  const { locale, t } = useI18n()
  const [partQuery, setPartQuery] = useState('')
  const [partKindFilter, setPartKindFilter] = useState('all')
  const [partPackFilter, setPartPackFilter] = useState<BrickPack>('lego')
  const planIssues = useMemo(() => validateBuildPlan(plan), [plan])
  const blockingPlanIssues = useMemo(() => getBlockingBuildPlanIssues(planIssues), [planIssues])
  const planIssueSummary = useMemo(() => summarizeBuildPlanIssues(planIssues, locale), [locale, planIssues])
  const brickCounts = useMemo(() => countBricks(plan), [plan])
  const packBrickDefinitions = useMemo(
    () => brickDefinitions.filter((brick) => brick.pack === partPackFilter),
    [partPackFilter],
  )
  const partKindOptions = useMemo(
    () => [
      { value: 'all', label: t('common.all') },
      ...Array.from(new Set(packBrickDefinitions.map((brick) => brick.kind))).map((kind) => ({
        value: kind,
        label: t(`control.kind.${kind}`),
      })),
    ],
    [packBrickDefinitions, t],
  )
  const visibleBrickDefinitions = useMemo(() => {
    const query = partQuery.trim().toLowerCase()

    return packBrickDefinitions.filter((brick) => {
      const kindLabel = t(`control.kind.${brick.kind}`)
      const matchesKind = partKindFilter === 'all' || brick.kind === partKindFilter
      const matchesQuery = !query || [
        brick.id,
        brick.partNumber,
        brick.name,
        brick.kind,
        kindLabel,
        getFootprintLabel(brick.footprint.widthStuds, brick.footprint.depthStuds),
      ].some((value) => value.toLowerCase().includes(query))

      return matchesKind && matchesQuery
    })
  }, [packBrickDefinitions, partKindFilter, partQuery, t])

  return (
    <aside className="control-panel">
      <section className="panel-section generator">
        <div className="section-title">
          <Sparkles size={18} />
          <h2>{t('control.generate')}</h2>
          {engineStatusLabel && onEngineStatusClick && (
            <button type="button" className={`status-pill compact ${engineStatusTone}`} onClick={onEngineStatusClick}>
              <span />
              {engineStatusLabel}
            </button>
          )}
          {engineStatusLabel && !onEngineStatusClick && (
            <span className={`status-pill compact ${engineStatusTone}`}>
              <span />
              {engineStatusLabel}
            </span>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t('control.promptPlaceholder')}
        />
        <div className="upload-row">
          <label className="file-button">
            <ImageUp size={17} />
            <span>{imageName || t('control.uploadImage')}</span>
            <input type="file" accept="image/*" onChange={(event) => onImage(event.target.files?.[0])} />
          </label>
          {imagePreview && <img src={imagePreview} alt={t('control.imagePreview')} />}
        </div>
        <div className="generator-actions">
          <button className="primary" type="button" onClick={onGenerate} disabled={isGenerating}>
            <Sparkles size={17} />
            {isGenerating ? t('control.generating') : t('control.generatePlan')}
          </button>
          {!isGenerating && (
            <button className="secondary" type="button" onClick={onOpenPromptPreview}>
              {t('control.previewPrompt')}
            </button>
          )}
          {isGenerating && (
            <button className="secondary" type="button" onClick={onCancelGenerate}>
              {t('control.cancel')}
            </button>
          )}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-title parts-section-title">
          <div>
            <Box size={18} />
            <h2>{t('control.partsPack')}</h2>
          </div>
          <select
            aria-label={t('control.partsPackSelect')}
            value={partPackFilter}
            onChange={(event) => {
              setPartPackFilter(event.target.value as BrickPack)
              setPartKindFilter('all')
            }}
          >
            {partPackOptions.map((pack) => (
              <option key={pack} value={pack}>{t(`control.pack.${pack}`)}</option>
            ))}
          </select>
        </div>
        <div className="part-tools">
          <input
            value={partQuery}
            onChange={(event) => setPartQuery(event.target.value)}
            placeholder={t('control.searchParts')}
          />
          <div className="part-kind-tabs" aria-label={t('control.partTypes')}>
            {partKindOptions.map((kind) => (
              <button
                key={kind.value}
                type="button"
                className={kind.value === partKindFilter ? 'active' : ''}
                onClick={() => setPartKindFilter(kind.value)}
              >
                {kind.label}
              </button>
            ))}
          </div>
        </div>
        <div className="parts-list">
          {visibleBrickDefinitions.map((brick) => {
            const usedCount = brickCounts[brick.id] ?? 0
            const isOutOfStock = isInventoryLimited(brick.inventory) && usedCount >= brick.inventory

            return (
              <button
                key={brick.id}
                type="button"
                title={isOutOfStock ? t('control.partOut', { name: brick.name }) : t('control.addPart', { name: brick.name })}
                disabled={isOutOfStock}
                onClick={() => onAddBrick(brick.id)}
              >
                <BrickGlyph brickId={brick.id} kind={brick.kind} footprint={brick.footprint} className="part-glyph" />
                <span className="part-copy">
                  <strong>{brick.name}</strong>
                  <small>{t('control.partNumber', { number: brick.partNumber })}</small>
                  <small>
                    {getFootprintLabel(brick.footprint.widthStuds, brick.footprint.depthStuds)} · {getHeightLabel(brick)} · {usedCount}/{formatInventory(brick.inventory)}
                  </small>
                </span>
                <Plus size={15} />
              </button>
            )
          })}
          {packBrickDefinitions.length === 0 && <p className="muted">{t('control.noPackParts')}</p>}
          {packBrickDefinitions.length > 0 && visibleBrickDefinitions.length === 0 && <p className="muted">{t('control.noParts')}</p>}
        </div>
      </section>

      <section className="panel-section plan-summary">
        <div className="section-title">
          <Upload size={18} />
          <h2>{t('control.plan')}</h2>
        </div>
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
        <p className={`structure-status ${planIssues.length > 0 ? (blockingPlanIssues.length > 0 ? 'warn' : 'notice') : 'ok'}`}>
          {planIssues.length > 0 ? planIssueSummary : t('common.structureOk')}
        </p>
        <button type="button" onClick={onOpenManual}>
          <BookOpen size={16} />
          {t('control.buildManual')}
        </button>
        <button type="button" onClick={onExport}>
          <Download size={16} />
          {t('common.exportJson')}
        </button>
        <label className="file-button plan-import-button">
          <Upload size={16} />
          <span>{t('control.importJson')}</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              onImportPlan(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>
        <button className="danger" type="button" onClick={onResetWorkspace}>
          <Trash2 size={16} />
          {t('control.resetCanvas')}
        </button>
      </section>
    </aside>
  )
}
