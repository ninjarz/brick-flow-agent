import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { BookOpen, Box, Download, ImageUp, Plus, RotateCcw, Sparkles, Upload, X } from 'lucide-react'
import { brickDefinitions, getDefaultBrickColor } from '../data/basicBricks'
import { worldEntityDefinitions } from '../data/worldEntityDefinitions'
import { PLATE_HEIGHT_WORLD } from '../lib/brickUnits'
import { getBrickCatalogName, getBrickCatalogSearchTerms } from '../lib/brickCatalog'
import { loadCatalogPreferences, saveCatalogPreferences, type CatalogPackPreference } from '../lib/catalogPreferences'
import { getBlockingBuildPlanIssues, summarizeBuildPlanIssues, validateBuildPlan, validateBuildPlanBasics } from '../lib/planUtils'
import { useI18n } from '../lib/i18n'
import { LazyBrickGlyph } from './LazyBrickGlyph'
import type { BuildPlan } from '../types/bricks'

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
  brickCounts: Record<string, number>
  onRenamePlan: (title: string) => void
  onAddBrick: (brickId: string) => void
  onAddWorldEntity: (definitionId: string) => void
  worldEntityCounts: Record<string, number>
  inventoryOverrides: Record<string, number>
  onInventoryChange: (brickId: string, inventory?: number) => void
  onResetInventory: () => void
  onExport: () => void
  onExportLDraw: () => void
  onImportPlan: (file?: File) => void
  onOpenManual: () => void
  catalogPack: CatalogPackPreference
  onCatalogPackChange: (pack: CatalogPackPreference) => void
}

const getFootprintLabel = (widthStuds: number, depthStuds: number) =>
  `${Math.min(widthStuds, depthStuds)}x${Math.max(widthStuds, depthStuds)}`
const getHeightLabel = (brick: (typeof brickDefinitions)[number]) =>
  brick.pack === 'lego'
    ? `${Number((brick.footprint.heightStuds / PLATE_HEIGHT_WORLD).toFixed(3))}p`
    : `${Number(brick.footprint.heightStuds.toFixed(3))}h`

const isInventoryLimited = (inventory: number) => Number.isFinite(inventory)
const formatInventory = (inventory: number) => isInventoryLimited(inventory) ? String(inventory) : '∞'
const partPackOptions: CatalogPackPreference[] = ['lego', 'minecraft', 'npc']
const validationDebounceMs = 120
const initialVisiblePartCount = 12

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
  brickCounts,
  onRenamePlan,
  onAddBrick,
  onAddWorldEntity,
  worldEntityCounts,
  inventoryOverrides,
  onInventoryChange,
  onResetInventory,
  onExport,
  onExportLDraw,
  onImportPlan,
  onOpenManual,
  catalogPack: partPackFilter,
  onCatalogPackChange,
}: ControlPanelProps) => {
  const { locale, t } = useI18n()
  const [initialCatalogPreferences] = useState(loadCatalogPreferences)
  const [partQuery, setPartQuery] = useState(initialCatalogPreferences.query)
  const [partKindFilter, setPartKindFilter] = useState(initialCatalogPreferences.kind)
  const [visiblePartLimit, setVisiblePartLimit] = useState(initialVisiblePartCount)
  const [backgroundValidation, setBackgroundValidation] = useState<{
    plan: BuildPlan
    issues: ReturnType<typeof validateBuildPlan>
  }>()
  const deferredPlan = useDeferredValue(plan)
  const derivedPlan = deferredPlan
  const basicPlanIssues = useMemo(() => validateBuildPlanBasics(derivedPlan), [derivedPlan])

  useEffect(() => {
    let isCanceled = false
    const timeoutId = window.setTimeout(() => {
      const issues = validateBuildPlan(derivedPlan)
      if (!isCanceled) {
        setBackgroundValidation({ plan: derivedPlan, issues })
      }
    }, validationDebounceMs)

    return () => {
      isCanceled = true
      window.clearTimeout(timeoutId)
    }
  }, [derivedPlan])

  const isStructureChecking = backgroundValidation?.plan !== derivedPlan
  const planIssues = useMemo(
    () => {
      return backgroundValidation?.plan === derivedPlan ? backgroundValidation.issues : basicPlanIssues
    },
    [backgroundValidation, basicPlanIssues, derivedPlan],
  )
  const blockingPlanIssues = useMemo(() => getBlockingBuildPlanIssues(planIssues), [planIssues])
  const planIssueSummary = useMemo(() => summarizeBuildPlanIssues(planIssues, locale), [locale, planIssues])
  const structureStatusTone = blockingPlanIssues.length > 0
    ? 'warn'
    : planIssues.length > 0 || isStructureChecking
      ? 'notice'
      : 'ok'
  const structureStatusText = isStructureChecking
    ? planIssues.length > 0
      ? `${planIssueSummary} · ${t('control.validationCheckingLarge')}`
      : t('control.validationCheckingLarge')
    : planIssues.length > 0
      ? planIssueSummary
      : t('common.structureOk')
  const packBrickDefinitions = useMemo(
    () => partPackFilter === 'npc' ? [] : brickDefinitions.filter((brick) => brick.pack === partPackFilter),
    [partPackFilter],
  )
  const visibleWorldEntityDefinitions = useMemo(() => {
    if (partPackFilter !== 'npc') return []
    const query = partQuery.trim().toLowerCase()
    return worldEntityDefinitions.filter((definition) => {
      const matchesKind = partKindFilter === 'all' || definition.role === partKindFilter
      const matchesQuery = !query || [
        definition.id,
        definition.displayName,
        definition.description,
        definition.role,
      ].some((value) => value.toLowerCase().includes(query))
      return matchesKind && matchesQuery
    })
  }, [partKindFilter, partPackFilter, partQuery])
  const partKindOptions = useMemo(
    () => [
      { value: 'all', label: t('common.all') },
      ...(partPackFilter === 'npc'
        ? Array.from(new Set(worldEntityDefinitions.map((definition) => definition.role))).map((role) => ({
            value: role,
            label: t(`control.npcRole.${role}`),
          }))
        : Array.from(new Set(packBrickDefinitions.map((brick) => (
            partPackFilter === 'minecraft' ? brick.catalogCategory ?? brick.kind : brick.kind
          )))).map((kind) => ({
            value: kind,
            label: partPackFilter === 'minecraft'
              ? t(`control.minecraftCategory.${kind}`)
              : t(`control.kind.${kind}`),
          }))),
    ],
    [packBrickDefinitions, partPackFilter, t],
  )

  useEffect(() => {
    if (!partKindOptions.some((option) => option.value === partKindFilter)) setPartKindFilter('all')
  }, [partKindFilter, partKindOptions])

  useEffect(() => {
    saveCatalogPreferences({ pack: partPackFilter, kind: partKindFilter, query: partQuery })
  }, [partKindFilter, partPackFilter, partQuery])

  const visibleBrickDefinitions = useMemo(() => {
    const query = partQuery.trim().toLowerCase()

    return packBrickDefinitions.filter((brick) => {
      const kindLabel = t(`control.kind.${brick.kind}`)
      const catalogKind = partPackFilter === 'minecraft' ? brick.catalogCategory ?? brick.kind : brick.kind
      const categoryLabel = partPackFilter === 'minecraft'
        ? t(`control.minecraftCategory.${catalogKind}`)
        : kindLabel
      const matchesKind = partKindFilter === 'all' || catalogKind === partKindFilter
      const matchesQuery = !query || [
        ...getBrickCatalogSearchTerms(brick, locale),
        brick.kind,
        kindLabel,
        categoryLabel,
        getFootprintLabel(brick.footprint.widthStuds, brick.footprint.depthStuds),
      ].some((value) => value.toLowerCase().includes(query))

      return matchesKind && matchesQuery
    })
  }, [locale, packBrickDefinitions, partKindFilter, partPackFilter, partQuery, t])
  const renderedBrickDefinitions = visibleBrickDefinitions.slice(0, visiblePartLimit)
  const remainingPartCount = Math.max(0, visibleBrickDefinitions.length - renderedBrickDefinitions.length)

  useEffect(() => {
    setVisiblePartLimit(initialVisiblePartCount)
  }, [partKindFilter, partPackFilter, partQuery])

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
          {imagePreview && (
            <div className="reference-image-preview">
              <img src={imagePreview} alt={t('control.imagePreview')} />
              <button type="button" aria-label={t('control.removeImage')} title={t('control.removeImage')} onClick={() => onImage(undefined)}>
                <X size={13} />
              </button>
            </div>
          )}
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
              onCatalogPackChange(event.target.value as CatalogPackPreference)
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
          {partPackFilter !== 'npc' && <div className="inventory-tools">
            <span>{t('control.inventoryHint')}</span>
            {Object.keys(inventoryOverrides).length > 0 && (
              <button type="button" onClick={onResetInventory}>
                <RotateCcw size={13} />
                {t('control.inventoryReset')}
              </button>
            )}
          </div>}
        </div>
        {visibleBrickDefinitions.length > 0 && (
          <div className="parts-list-summary">
            {t('control.visibleParts', {
              visible: renderedBrickDefinitions.length,
              total: visibleBrickDefinitions.length,
            })}
          </div>
        )}
        <div className="parts-list">
          {partPackFilter === 'npc' && visibleWorldEntityDefinitions.map((definition) => (
            <article className="npc-catalog-item" key={definition.id}>
              <button
                className="npc-add-button"
                type="button"
                title={t('control.addNpc', { name: definition.displayName })}
                onClick={() => onAddWorldEntity(definition.id)}
              >
                <span className={`npc-catalog-glyph ${definition.role}`} aria-hidden="true">
                  {definition.id === 'knight' ? '♞' : definition.id === 'archer' ? '➶' : definition.id === 'priest' ? '✚' : '⚙'}
                </span>
                <span className="part-copy">
                  <strong>{definition.displayName}</strong>
                  <small>{definition.description}</small>
                  <small>{t('control.npcScale', {
                    height: definition.visual.heightStuds,
                    count: worldEntityCounts[definition.id] ?? 0,
                  })}</small>
                </span>
                <Plus size={15} />
              </button>
            </article>
          ))}
          {renderedBrickDefinitions.map((brick) => {
            const usedCount = brickCounts[brick.id] ?? 0
            const hasInventoryOverride = Object.prototype.hasOwnProperty.call(inventoryOverrides, brick.id)
            const inventory = inventoryOverrides[brick.id] ?? brick.inventory
            const isOutOfStock = isInventoryLimited(inventory) && usedCount >= inventory
            const displayName = getBrickCatalogName(brick, locale)
            const voxelShape = brick.voxelVisual?.shape
            const voxelSummary = brick.voxelVisual
              ? t('control.voxelSummary', {
                  category: t(`control.minecraftCategory.${brick.catalogCategory ?? 'functional'}`),
                  shape: t(`control.voxelShape.${brick.voxelVisual.shape}`),
                  layer: t(`control.voxelLayer.${brick.voxelVisual.renderLayer}`),
                })
              : undefined

            return (
              <article className="part-list-item" key={brick.id}>
                <button
                  className="part-add-button"
                  type="button"
                  title={isOutOfStock ? t('control.partOut', { name: displayName }) : t('control.addPart', { name: displayName })}
                  disabled={isOutOfStock}
                  onClick={() => onAddBrick(brick.id)}
                >
                  <LazyBrickGlyph brickId={brick.id} kind={brick.kind} footprint={brick.footprint} color={getDefaultBrickColor(brick)} className="part-glyph" />
                  <span className="part-copy">
                    <span className="part-name-line">
                      <strong>{displayName}</strong>
                      {voxelShape && <em>{t(`control.voxelShape.${voxelShape}`)}</em>}
                    </span>
                    <small>{voxelSummary ?? t('control.partNumber', { number: brick.partNumber })}</small>
                    <small>
                      {getFootprintLabel(brick.footprint.widthStuds, brick.footprint.depthStuds)} · {getHeightLabel(brick)} · {usedCount}/{formatInventory(inventory)}
                    </small>
                  </span>
                  <Plus size={15} />
                </button>
                <label className="part-inventory-field" title={t('control.inventoryFor', { name: displayName })}>
                  <span>{t('control.inventoryShort')}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    value={hasInventoryOverride ? inventory : ''}
                    placeholder={formatInventory(brick.inventory)}
                    aria-label={t('control.inventoryFor', { name: brick.name })}
                    onChange={(event) => {
                      const value = event.target.value
                      onInventoryChange(brick.id, value === '' ? undefined : Number(value))
                    }}
                  />
                </label>
              </article>
            )
          })}
          {partPackFilter === 'npc' && visibleWorldEntityDefinitions.length === 0 && <p className="muted">{t('control.noNpcs')}</p>}
          {partPackFilter !== 'npc' && packBrickDefinitions.length === 0 && <p className="muted">{t('control.noPackParts')}</p>}
          {packBrickDefinitions.length > 0 && visibleBrickDefinitions.length === 0 && <p className="muted">{t('control.noParts')}</p>}
          {remainingPartCount > 0 && (
            <button
              className="parts-load-more"
              type="button"
              onClick={() => setVisiblePartLimit((current) => current + initialVisiblePartCount)}
            >
              <Plus size={14} />
              {t('control.showMoreParts', { count: Math.min(initialVisiblePartCount, remainingPartCount) })}
              <small>{t('control.remainingParts', { count: remainingPartCount })}</small>
            </button>
          )}
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
        <p className={`structure-status ${structureStatusTone}`}>
          {structureStatusText}
        </p>
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
      </section>
    </aside>
  )
}
