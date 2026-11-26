import { BookOpen, Box, Boxes, Link, Play, Plus, Trash2, X } from 'lucide-react'
import { useI18n } from '../lib/i18n'
import type { BuildPlan, FinishedAsset } from '../types/bricks'
import type { WorldScenarioAsset } from '../types/worldScenario'
import { CurrentWorkPanel } from './CurrentWorkPanel'

export type AssetLibraryKind = 'current' | 'models' | 'scenarios'

export type LocalizedFinishedAsset = {
  source: FinishedAsset
  displayTitle: string
  displayCategory: string
  displayDescription: string
  displayPrompt: string
  /** A placeholder while the asset's plan is deferred; use getAssetDisplayPlan. */
  displayPlan: BuildPlan
  partCount: number
  stepCount: number
}

type Props = {
  plan: BuildPlan
  assetLibraryKind: AssetLibraryKind
  assetRecoveryFailed: boolean
  assetTitle: string
  assetCategory: string
  assetDescription: string
  assetQuery: string
  assetCategoryFilter: string
  assetCategories: Array<{ value: string; label: string }>
  finishedAssetsCount: number
  visibleFinishedAssets: LocalizedFinishedAsset[]
  isLoadingAsset: boolean
  scenarioQuery: string
  worldScenariosCount: number
  visibleWorldScenarios: WorldScenarioAsset[]
  onClose: () => void
  onSelectKind: (kind: AssetLibraryKind) => void
  onRetryAssetRecovery: () => void
  onRenamePlan: (title: string) => void
  onExportPlan: () => void
  onExportLDraw: () => void
  onOpenManual: () => void
  onImportPlan: (file?: File) => void
  onAssetTitleChange: (value: string) => void
  onAssetCategoryChange: (value: string) => void
  onAssetDescriptionChange: (value: string) => void
  onAddFinishedAsset: () => void
  onAssetQueryChange: (value: string) => void
  onResetFinishedAssets: () => void
  onSelectAssetCategoryFilter: (value: string) => void
  onLoadFinishedAsset: (asset: LocalizedFinishedAsset) => void
  onOpenAssetManual: (asset: LocalizedFinishedAsset) => void
  onDeleteFinishedAsset: (id: string) => void
  onScenarioQueryChange: (value: string) => void
  onApplyWorldScenario: (mode: 'start' | 'add', scenarioId: string) => void
}

export const AssetLibraryModal = ({
  plan,
  assetLibraryKind,
  assetRecoveryFailed,
  assetTitle,
  assetCategory,
  assetDescription,
  assetQuery,
  assetCategoryFilter,
  assetCategories,
  finishedAssetsCount,
  visibleFinishedAssets,
  isLoadingAsset,
  scenarioQuery,
  worldScenariosCount,
  visibleWorldScenarios,
  onClose,
  onSelectKind,
  onRetryAssetRecovery,
  onRenamePlan,
  onExportPlan,
  onExportLDraw,
  onOpenManual,
  onImportPlan,
  onAssetTitleChange,
  onAssetCategoryChange,
  onAssetDescriptionChange,
  onAddFinishedAsset,
  onAssetQueryChange,
  onResetFinishedAssets,
  onSelectAssetCategoryFilter,
  onLoadFinishedAsset,
  onOpenAssetManual,
  onDeleteFinishedAsset,
  onScenarioQueryChange,
  onApplyWorldScenario,
}: Props) => {
  const { locale, t } = useI18n()

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="asset-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-library-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="asset-library-title">{t('asset.title')}</h2>
            {assetLibraryKind !== 'current' && <p>{assetLibraryKind === 'models'
              ? t('asset.count', { visible: visibleFinishedAssets.length, total: finishedAssetsCount })
              : t('asset.scenarioCount', { visible: visibleWorldScenarios.length, total: worldScenariosCount })}</p>}
          </div>
          <button className="icon-button" type="button" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {assetRecoveryFailed && <p role="alert">
          {locale === 'zh-CN' ? '素材库读取失败，已暂停保存并保留原数据。' : 'Asset recovery failed. Saving is paused and stored data is preserved.'}
          <button type="button" onClick={onRetryAssetRecovery}>
            {locale === 'zh-CN' ? '重试读取素材库' : 'Retry asset recovery'}
          </button>
        </p>}
        <nav className="asset-kind-tabs" aria-label={t('asset.libraryKinds')}>
          <button
            type="button"
            className={assetLibraryKind === 'current' ? 'active' : ''}
            aria-pressed={assetLibraryKind === 'current'}
            onClick={() => onSelectKind('current')}
          >
            <Box size={16} />
            {t('asset.kind.current')}
          </button>
          <button
            type="button"
            className={assetLibraryKind === 'models' ? 'active' : ''}
            aria-pressed={assetLibraryKind === 'models'}
            onClick={() => onSelectKind('models')}
          >
            <Boxes size={16} />
            {t('asset.kind.models')}
          </button>
          <button
            type="button"
            className={assetLibraryKind === 'scenarios' ? 'active' : ''}
            aria-pressed={assetLibraryKind === 'scenarios'}
            onClick={() => onSelectKind('scenarios')}
          >
            <BookOpen size={16} />
            {t('asset.kind.scenarios')}
          </button>
        </nav>

        {assetLibraryKind === 'current' && (
          <div className="project-work-grid">
            <CurrentWorkPanel
              plan={plan}
              onRenamePlan={onRenamePlan}
              onExport={onExportPlan}
              onExportLDraw={onExportLDraw}
              onOpenManual={onOpenManual}
              onImportPlan={onImportPlan}
            />
            <section className="asset-create">
              <h3>{t('asset.saveAsAsset')}</h3>
              <div className="asset-create-fields">
                <label className="plan-title-field">
                  <span>{t('asset.nameLabel')}</span>
                  <input value={assetTitle} onChange={(event) => onAssetTitleChange(event.target.value)} placeholder={t('asset.titlePlaceholder', { title: plan.title })} />
                </label>
                <label className="plan-title-field">
                  <span>{t('asset.categoryPlaceholder')}</span>
                  <input value={assetCategory} onChange={(event) => onAssetCategoryChange(event.target.value)} />
                </label>
              </div>
              <label className="plan-title-field">
                <span>{t('asset.descriptionLabel')}</span>
                <input value={assetDescription} onChange={(event) => onAssetDescriptionChange(event.target.value)} />
              </label>
              <button className="primary compact-primary" type="button" onClick={onAddFinishedAsset}>
                <Plus size={16} />
                {t('asset.saveCurrent')}
              </button>
            </section>
          </div>
        )}

        {assetLibraryKind === 'models' ? (
          <>
            <section className="asset-tools">
              <div className="asset-model-tools">
                <input
                  value={assetQuery}
                  onChange={(event) => onAssetQueryChange(event.target.value)}
                  placeholder={t('asset.searchPlaceholder')}
                />
                <button className="secondary" type="button" onClick={onResetFinishedAssets}>
                  {t('asset.restoreDefault')}
                </button>
              </div>
              <div className="asset-category-tabs" aria-label={t('asset.categories')}>
                {assetCategories.map((category) => (
                  <button
                    key={category.value}
                    type="button"
                    className={category.value === assetCategoryFilter ? 'active' : ''}
                    onClick={() => onSelectAssetCategoryFilter(category.value)}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            </section>

            <div className="asset-list">
              {visibleFinishedAssets.map((asset) => (
                <article key={asset.source.id} className="asset-card">
                  <div>
                    <span>{asset.displayCategory}</span>
                    {asset.source.instructionStatus && (
                      <span className="asset-status replica">
                        {t('asset.replica')}
                      </span>
                    )}
                    <h3>{asset.displayTitle}</h3>
                    <p>{asset.displayDescription}</p>
                    <small>{t('common.parts', { count: asset.partCount })} · {t('common.steps', { count: asset.stepCount })} · {asset.displayPrompt}</small>
                  </div>
                  <div className="asset-actions">
                    <button type="button" disabled={isLoadingAsset} onClick={() => onLoadFinishedAsset(asset)}>
                      {t('common.load')}
                    </button>
                    <button type="button" onClick={() => onOpenAssetManual(asset)}>
                      {t('asset.manual')}
                    </button>
                    {asset.source.instructionUrl && (
                      <a className="asset-link-button" href={asset.source.instructionUrl} target="_blank" rel="noreferrer">
                        <Link size={15} />
                        {t('asset.instructions')}
                      </a>
                    )}
                    <button className="icon-button danger" type="button" aria-label={t('asset.delete')} title={t('asset.delete')} onClick={() => onDeleteFinishedAsset(asset.source.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))}
              {visibleFinishedAssets.length === 0 && <p className="muted">{t('asset.noMatches')}</p>}
            </div>
          </>
        ) : assetLibraryKind === 'scenarios' && (
          <>
            <section className="asset-tools">
              <input
                value={scenarioQuery}
                onChange={(event) => onScenarioQueryChange(event.target.value)}
                placeholder={t('asset.scenarioSearchPlaceholder')}
              />
            </section>

            <div className="asset-list scenario-list">
              {visibleWorldScenarios.map((scenario) => (
                <article key={scenario.id} className="asset-card scenario-card">
                  <div>
                    <span>{scenario.category}</span>
                    <span className="asset-status scenario">{t('asset.scenarioBadge')}</span>
                    <h3>{scenario.title}</h3>
                    <p>{scenario.description}</p>
                    <small>
                      {t('common.parts', { count: scenario.plan.bricks.length })} · {t('asset.scenarioEntities', { count: scenario.world.entities.length })} · {t('asset.scenarioChapters', { count: scenario.world.narrative.stories.length })}
                    </small>
                  </div>
                  <div className="asset-actions scenario-actions">
                    <button type="button" onClick={() => onApplyWorldScenario('start', scenario.id)}>
                      <Play size={15} />
                      {t('asset.startScenario')}
                    </button>
                    <button type="button" onClick={() => onApplyWorldScenario('add', scenario.id)}>
                      <Plus size={15} />
                      {t('asset.addScenario')}
                    </button>
                  </div>
                </article>
              ))}
              {visibleWorldScenarios.length === 0 && <p className="muted">{t('asset.noScenarioMatches')}</p>}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
