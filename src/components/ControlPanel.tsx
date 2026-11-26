import { WorldEntityGlyph } from './WorldEntityGlyph'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, ChevronLeft, ChevronRight, ImageUp, Plus, RotateCcw, Sparkles, X } from 'lucide-react'
import { brickDefinitions, getDefaultBrickColor } from '../data/basicBricks'
import { worldEntityDefinitions } from '../data/worldEntityDefinitions'
import { PLATE_HEIGHT_WORLD } from '../lib/brickUnits'
import { getBrickCatalogName, getBrickCatalogSearchTerms } from '../lib/brickCatalog'
import { loadCatalogPreferences, saveCatalogPreferences, type CatalogPackPreference } from '../lib/catalogPreferences'
import { useI18n } from '../lib/i18n'
import { LazyBrickGlyph } from './LazyBrickGlyph'

type ControlPanelProps = {
  debugMode?: boolean
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
  brickCounts: Record<string, number>
  onAddBrick: (brickId: string) => void
  onAddWorldEntity: (definitionId: string) => void
  worldEntityCounts: Record<string, number>
  inventoryOverrides: Record<string, number>
  onInventoryChange: (brickId: string, inventory?: number) => void
  onResetInventory: () => void
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
const minimumPartsPerPage = 3

export const ControlPanel = ({
  debugMode = false,
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
  brickCounts,
  onAddBrick,
  onAddWorldEntity,
  worldEntityCounts,
  inventoryOverrides,
  onInventoryChange,
  onResetInventory,
  catalogPack: partPackFilter,
  onCatalogPackChange,
}: ControlPanelProps) => {
  const { locale, t } = useI18n()
  const [initialCatalogPreferences] = useState(loadCatalogPreferences)
  const [partQuery, setPartQuery] = useState(initialCatalogPreferences.query)
  const [partKindFilter, setPartKindFilter] = useState(initialCatalogPreferences.kind)
  const [partsPerPage, setPartsPerPage] = useState(minimumPartsPerPage)
  const [partPageAnchors, setPartPageAnchors] = useState<Record<string, number>>({})
  const [pageInput, setPageInput] = useState<string>()
  const sidebarRef = useRef<HTMLElement>(null)
  const generatorRef = useRef<HTMLElement>(null)
  const catalogRef = useRef<HTMLElement>(null)
  const catalogHeaderRef = useRef<HTMLDivElement>(null)
  const partsListRef = useRef<HTMLDivElement>(null)
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
  const pageCount = Math.max(1, Math.ceil(visibleBrickDefinitions.length / partsPerPage))
  const pageKey = JSON.stringify([partPackFilter, partKindFilter, partQuery.trim().toLowerCase()])
  const currentPage = Math.min(Math.floor((partPageAnchors[pageKey] ?? 0) / partsPerPage) + 1, pageCount)
  const firstPartIndex = (currentPage - 1) * partsPerPage
  const renderedBrickDefinitions = visibleBrickDefinitions.slice(firstPartIndex, firstPartIndex + partsPerPage)
  const goToPage = (page: number) => {
    const nextPage = Number.isFinite(page) ? Math.max(1, Math.min(pageCount, Math.trunc(page))) : currentPage
    setPartPageAnchors(anchors => ({ ...anchors, [pageKey]: (nextPage - 1) * partsPerPage }))
    setPageInput(undefined)
  }

  useEffect(() => {
    setPageInput(undefined)
  }, [pageKey, partsPerPage])

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current
    const generator = generatorRef.current
    const catalog = catalogRef.current
    const header = catalogHeaderRef.current
    const list = partsListRef.current
    if (!sidebar || !generator || !catalog || !header || !list || !visibleBrickDefinitions.length) return
    const measure = () => {
      const row = list.querySelector('.part-list-item')
      if (!row) return
      const rowHeight = row.getBoundingClientRect().height
      if (!rowHeight) return
      const sidebarStyle = getComputedStyle(sidebar)
      const catalogStyle = getComputedStyle(catalog)
      const gap = parseFloat(getComputedStyle(list).rowGap) || 0
      const pagerSpace = parseFloat(catalogStyle.getPropertyValue('--parts-pagination-height')) +
        parseFloat(catalogStyle.getPropertyValue('--parts-pagination-gap'))
      const sidebarHeight = window.matchMedia('(max-width: 980px)').matches ? window.innerHeight : sidebar.clientHeight
      const headerEnd = header.getBoundingClientRect().bottom - sidebar.getBoundingClientRect().top + sidebar.scrollTop
      const available = sidebarHeight - headerEnd - parseFloat(sidebarStyle.paddingBottom) -
        parseFloat(catalogStyle.paddingBottom) - parseFloat(catalogStyle.borderBottomWidth)
      const fit = (height: number) => Math.max(minimumPartsPerPage, Math.floor((height + gap) / (rowHeight + gap)))
      const withoutPager = fit(available)
      setPartsPerPage(visibleBrickDefinitions.length > withoutPager ? fit(available - pagerSpace) : withoutPager)
    }
    measure()
    const observer = new ResizeObserver(measure)
    for (const element of [sidebar, generator, header, list]) observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [visibleBrickDefinitions.length])

  return (
    <aside className="control-panel" ref={sidebarRef}>
      <section className="panel-section generator" ref={generatorRef}>
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
          {debugMode && !isGenerating && (
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

      <section className="panel-section parts-catalog" ref={catalogRef}>
        <div ref={catalogHeaderRef} className="parts-catalog-header">
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
            {t('control.partsPageRange', {
              first: firstPartIndex + 1,
              last: firstPartIndex + renderedBrickDefinitions.length,
              total: visibleBrickDefinitions.length,
            })}
          </div>
        )}
        </div>
        {pageCount > 1 && (
          <nav className="parts-pagination" aria-label={t('control.partsPagination')}>
            <button type="button" aria-label={t('control.previousPartsPage')} title={t('control.previousPartsPage')}
              disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)}>
              <ChevronLeft size={16} />
            </button>
            <form onSubmit={event => {
              event.preventDefault()
              goToPage(pageInput?.trim() ? Number(pageInput) : currentPage)
            }}>
              <input type="number" aria-label={t('control.partsPageNumber')} inputMode="numeric"
                value={pageInput ?? String(currentPage)} onChange={event => setPageInput(event.target.value)} />
              <span>/ {pageCount}</span>
              <button type="submit">{t('control.goToPartsPage')}</button>
            </form>
            <button type="button" aria-label={t('control.nextPartsPage')} title={t('control.nextPartsPage')}
              disabled={currentPage === pageCount} onClick={() => goToPage(currentPage + 1)}>
              <ChevronRight size={16} />
            </button>
          </nav>
        )}
        <div className="parts-list" ref={partsListRef}>
          {partPackFilter === 'npc' && visibleWorldEntityDefinitions.map((definition) => (
            <article className="npc-catalog-item" key={definition.id}>
              <button
                className="npc-add-button"
                type="button"
                title={t('control.addNpc', { name: definition.displayName })}
                onClick={() => onAddWorldEntity(definition.id)}
              >
                <WorldEntityGlyph definitionId={definition.id} />
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
        </div>
      </section>

    </aside>
  )
}
