import { Bot, CircleStop, Send, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { useI18n } from '../lib/i18n'
import { changeWorldEntityController } from '../lib/worldEntity'
import type { WorldEntity, WorldEntityCommand, WorldTargetRef } from '../types/world'

export type WorldCommandTargetOption = WorldTargetRef & { label: string }

type WorldEntityEditorPanelProps = {
  entity?: WorldEntity
  commandTargets: WorldCommandTargetOption[]
  onUpdate: (entity: WorldEntity) => void
  onIssueCommand: (entityId: string, command: WorldEntityCommand) => boolean
  onDelete: (id: string) => void
  onClose: () => void
}

export const WorldEntityEditorPanel = ({ entity, commandTargets, onUpdate, onIssueCommand, onDelete, onClose }: WorldEntityEditorPanelProps) => {
  const { t } = useI18n()
  const [draftName, setDraftName] = useState(entity?.name ?? '')
  const [commandType, setCommandType] = useState<'move' | 'attack' | 'guard' | 'follow' | 'interact'>('move')
  const [targetKey, setTargetKey] = useState('')
  const [commandFeedback, setCommandFeedback] = useState<'sent' | 'failed'>()

  useEffect(() => setDraftName(entity?.name ?? ''), [entity?.id, entity?.name])
  useEffect(() => {
    setTargetKey('')
    setCommandFeedback(undefined)
  }, [entity?.id])
  if (!entity) return null
  const definition = worldEntityDefinitionById.get(entity.definitionId)
  const commitName = () => {
    const nextName = draftName.trim() || entity.name
    setDraftName(nextName)
    if (nextName !== entity.name) onUpdate({ ...entity, name: nextName })
  }
  const availableTargets = commandTargets.filter((target) => (
    !(target.kind === 'entity' && target.id === entity.id) &&
    (commandType !== 'follow' || target.kind === 'entity')
  ))
  const selectedTarget = availableTargets.find((target) => `${target.kind}:${target.id}` === targetKey)
  const issueTargetCommand = () => {
    if (!selectedTarget) return
    const command = { type: commandType, target: { kind: selectedTarget.kind, id: selectedTarget.id } } as WorldEntityCommand
    setCommandFeedback(onIssueCommand(entity.id, command) ? 'sent' : 'failed')
  }
  const issueStopCommand = () => setCommandFeedback(onIssueCommand(entity.id, { type: 'stop' }) ? 'sent' : 'failed')

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
        <small>{t('worldEntity.id', { id: entity.id })}</small>
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
            onChange={(event) => onUpdate(changeWorldEntityController(entity, event.target.value as WorldEntity['controller']))}
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
      <section className="world-command-panel" aria-label={t('worldEntity.orders')}>
        <div className="section-title">
          <Send size={15} />
          <h3>{t('worldEntity.orders')}</h3>
        </div>
        {entity.controller === 'player' ? (
          <>
            <div className="world-command-fields">
              <select
                aria-label={t('worldEntity.orderType')}
                value={commandType}
                onChange={(event) => {
                  setCommandType(event.target.value as typeof commandType)
                  setTargetKey('')
                  setCommandFeedback(undefined)
                }}
              >
                {(['move', 'attack', 'guard', 'follow', 'interact'] as const).map((type) => (
                  <option key={type} value={type}>{t(`worldEntity.order.${type}`)}</option>
                ))}
              </select>
              <select aria-label={t('worldEntity.orderTarget')} value={targetKey} onChange={(event) => setTargetKey(event.target.value)}>
                <option value="">{t('worldEntity.selectTarget')}</option>
                {availableTargets.map((target) => (
                  <option key={`${target.kind}:${target.id}`} value={`${target.kind}:${target.id}`}>{target.label}</option>
                ))}
              </select>
            </div>
            <div className="world-command-actions">
              <button type="button" onClick={issueTargetCommand} disabled={!selectedTarget}>
                <Send size={14} />{t('worldEntity.issueOrder')}
              </button>
              <button type="button" onClick={issueStopCommand}>
                <CircleStop size={14} />{t('worldEntity.order.stop')}
              </button>
            </div>
            {commandFeedback && (
              <p className={commandFeedback === 'sent' ? 'success' : 'error'}>
                {t(commandFeedback === 'sent' ? 'worldEntity.orderSent' : 'worldEntity.orderFailed')}
              </p>
            )}
          </>
        ) : <p className="muted">{t('worldEntity.playerControlHint')}</p>}
      </section>
      <button className="danger" type="button" onClick={() => onDelete(entity.id)}>
        <Trash2 size={16} />
        {t('worldEntity.delete')}
      </button>
    </section>
  )
}
