import { Bot, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { useI18n } from '../lib/i18n'
import type { WorldEntity } from '../types/world'

type WorldEntityEditorPanelProps = {
  entity?: WorldEntity
  onUpdate: (entity: WorldEntity) => void
  onDelete: (id: string) => void
  onClose: () => void
}

export const WorldEntityEditorPanel = ({ entity, onUpdate, onDelete, onClose }: WorldEntityEditorPanelProps) => {
  const { t } = useI18n()
  const [draftName, setDraftName] = useState(entity?.name ?? '')

  useEffect(() => setDraftName(entity?.name ?? ''), [entity?.id, entity?.name])
  if (!entity) return null
  const definition = worldEntityDefinitionById.get(entity.definitionId)
  const commitName = () => {
    const nextName = draftName.trim() || entity.name
    setDraftName(nextName)
    if (nextName !== entity.name) onUpdate({ ...entity, name: nextName })
  }

  return (
    <section className="brick-editor-window world-entity-editor" aria-label={t('worldEntity.editor')}>
      <div className="floating-window-title">
        <div className="section-title">
          <Bot size={18} />
          <h2>{t('worldEntity.editor')}</h2>
        </div>
        <button className="icon-button" type="button" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <div className="selected-piece-card">
        <div>
          <span>{definition?.displayName ?? entity.definitionId}</span>
          <strong>{entity.name}</strong>
        </div>
        <p>{entity.description}</p>
      </div>
      <div className="field-grid">
        <label>
          {t('worldEntity.name')}
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </label>
        <label>
          {t('worldEntity.faction')}
          <select value={entity.factionId} onChange={(event) => onUpdate({ ...entity, factionId: event.target.value })}>
            <option value="neutral">{t('worldEntity.faction.neutral')}</option>
            <option value="blue">{t('worldEntity.faction.blue')}</option>
            <option value="red">{t('worldEntity.faction.red')}</option>
          </select>
        </label>
        <label>
          {t('worldEntity.controller')}
          <select
            value={entity.controller}
            onChange={(event) => onUpdate({ ...entity, controller: event.target.value as WorldEntity['controller'] })}
          >
            <option value="rule">{t('worldEntity.controller.rule')}</option>
            <option value="player">{t('worldEntity.controller.player')}</option>
            <option value="ai">{t('worldEntity.controller.ai')}</option>
          </select>
        </label>
      </div>
      <div className="world-entity-stats">
        <span>{t('worldEntity.health', { current: entity.health, max: entity.maxHealth })}</span>
        <span>{t(`worldEntity.controller.${entity.controller}`)}</span>
      </div>
      <button className="danger" type="button" onClick={() => onDelete(entity.id)}>
        <Trash2 size={16} />
        {t('worldEntity.delete')}
      </button>
    </section>
  )
}
