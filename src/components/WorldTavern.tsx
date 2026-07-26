import { Activity, Beer, BookOpen, CheckCircle2, Circle, LockKeyhole, Pencil, Trash2, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { formatWorldEvent } from '../lib/worldNarrative'
import type { WorldScenarioRuntime, WorldState } from '../types/world'
import { WorldScenarioEditor } from './WorldScenarioEditor'
import type { BrickStructure } from '../types/bricks'

type WorldTavernProps = {
  world: WorldState
  onClearHistory: () => void
  onUpdateScenario: (scenario: WorldScenarioRuntime) => void
  structures: BrickStructure[]
  onSetTargetVisibility: (target: WorldState['hiddenTargets'][number], visible: boolean) => void
  onClose: () => void
}

export const WorldTavern = ({
  world,
  onClearHistory,
  onUpdateScenario,
  structures,
  onSetTargetVisibility,
  onClose,
}: WorldTavernProps) => {
  const { locale, t } = useI18n()
  const [selectedEntityId, setSelectedEntityId] = useState(world.entities[0]?.id ?? '')
  const [confirmClear, setConfirmClear] = useState(false)
  const [chronicleScope, setChronicleScope] = useState<'world' | 'character'>('world')
  const [editingScenarioId, setEditingScenarioId] = useState('')
  useEffect(() => {
    if (world.entities.some((entity) => entity.id === selectedEntityId)) return
    setSelectedEntityId(world.entities[0]?.id ?? '')
  }, [selectedEntityId, world.entities])
  const selectedEntity = world.entities.find((entity) => entity.id === selectedEntityId)
  const selectedMemories = world.narrative.memoriesByEntityId[selectedEntityId] ?? []
  const selectedRelationships = Object.values(world.narrative.relationshipsByEntityId[selectedEntityId] ?? {})
    .sort((a, b) => Math.abs(b.affinity) - Math.abs(a.affinity) || b.encounters - a.encounters)
  const hiddenEntityIds = useMemo(() => new Set(world.hiddenTargets.filter((target) => target.kind === 'entity').map((target) => target.id)), [world.hiddenTargets])
  const livingCount = world.entities.filter((entity) => entity.health > 0).length
  const defeatedCount = world.entities.length - livingCount
  const activeOrderCount = world.entities.filter((entity) => entity.activeCommand || entity.commandQueue.length > 0).length
  const eventsById = useMemo(() => new Map(world.events.map((event) => [event.id, event])), [world.events])
  const visibleEvents = chronicleScope === 'character' && selectedEntityId
    ? world.events.filter((event) => event.actorId === selectedEntityId || event.targetId === selectedEntityId)
    : world.events
  const formatWorldTime = (seconds: number) => {
    const totalSeconds = Math.max(0, Math.floor(seconds))
    const minutes = Math.floor(totalSeconds / 60)
    const remainder = totalSeconds % 60
    return `${minutes}:${remainder.toString().padStart(2, '0')}`
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="tavern-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tavern-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="tavern-title"><Beer size={21} />{t('tavern.title')}</h2>
            <p>{t('tavern.description')}</p>
          </div>
          <div className="tavern-header-actions">
            <button
              type="button"
              disabled={world.events.length === 0 && world.narrative.stories.length === 0 && world.narrative.directorTurns.length === 0}
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true)
                  return
                }
                onClearHistory()
                setConfirmClear(false)
              }}
            >
              <Trash2 size={14} />
              {confirmClear ? t('tavern.clearConfirmAction') : t('tavern.clearHistory')}
            </button>
            <button className="icon-button" type="button" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="tavern-layout">
          <aside className="tavern-characters">
            <strong><Users size={14} />{t('tavern.characters')}</strong>
            <div className="tavern-world-pulse" aria-label={t('tavern.worldPulse')}>
              <div><strong>{livingCount}</strong><small>{t('tavern.living')}</small></div>
              <div><strong>{defeatedCount}</strong><small>{t('tavern.defeated')}</small></div>
              <div><strong>{activeOrderCount}</strong><small>{t('tavern.activeOrders')}</small></div>
              <div><strong>{world.narrative.stories.length + world.narrative.directorTurns.length}</strong><small>{locale === 'zh-CN' ? '剧情片段' : 'Passages'}</small></div>
            </div>
            {world.entities.map((entity) => (
              <button
                key={entity.id}
                type="button"
                className={entity.id === selectedEntityId ? 'active' : ''}
                onClick={() => setSelectedEntityId(entity.id)}
              >
                <span>{entity.name.slice(0, 1)}</span>
                <div>
                  <strong>{entity.name}</strong>
                  <small>{hiddenEntityIds.has(entity.id) ? `${locale === 'zh-CN' ? '剧情隐藏' : 'Story hidden'} · ` : ''}{t(`worldEntity.faction.${entity.factionId}`)} · {entity.health}/{entity.maxHealth} · {t(`worldEntity.behavior.${entity.behaviorState}`)}</small>
                </div>
              </button>
            ))}
            {world.entities.length === 0 && <p className="muted">{t('tavern.noCharacters')}</p>}
          </aside>

          <div className={`tavern-content${editingScenarioId ? ' is-authoring' : ''}`}>
            {world.scenarios.map((scenario) => {
              const completedCount = scenario.stages.filter((stage) => stage.status === 'completed').length
              return (
                <section className="tavern-quest" key={scenario.id}>
                  <header>
                    <div>
                      <h3><BookOpen size={16} />{scenario.title}</h3>
                      <p>{scenario.description}</p>
                    </div>
                    <div className="tavern-quest-actions">
                      <strong>{t('tavern.questProgress', { completed: completedCount, total: scenario.stages.length })}</strong>
                      <button
                        type="button"
                        disabled={Boolean(scenario.activeDialogue)}
                        title={scenario.activeDialogue ? (locale === 'zh-CN' ? '对话演出结束后可编辑' : 'Editable after dialogue finishes') : undefined}
                        onClick={() => setEditingScenarioId((current) => current === scenario.id ? '' : scenario.id)}
                      >
                        <Pencil size={13} />{locale === 'zh-CN' ? '创作' : 'Author'}
                      </button>
                    </div>
                  </header>
                  <ol>
                    {scenario.stages.map((stage) => (
                      <li key={stage.id} className={stage.status}>
                        {stage.status === 'completed'
                          ? <CheckCircle2 size={17} />
                          : stage.status === 'active' ? <Circle size={17} /> : <LockKeyhole size={16} />}
                        <div>
                          <strong>{stage.title}</strong>
                          <span>{stage.description}</span>
                          {Boolean(stage.branches?.length) && <span>{locale === 'zh-CN' ? `${stage.branches!.length} 个分支结果` : `${stage.branches!.length} branch outcomes`}</span>}
                        </div>
                        {stage.status === 'active' && <small>{t('tavern.currentObjective')}</small>}
                      </li>
                    ))}
                  </ol>
                  {scenario.activeDialogue && (
                    <div className="tavern-dialogue-progress">
                      {locale === 'zh-CN' ? '剧情演出中' : 'Dialogue playing'} · {scenario.activeDialogue.lineIndex + 1}/{(() => {
                        const stage = scenario.stages.find((candidate) => candidate.id === scenario.activeDialogue?.stageId)
                        return scenario.activeDialogue?.branchId
                          ? stage?.branches?.find((branch) => branch.id === scenario.activeDialogue?.branchId)?.dialogue?.length ?? 1
                          : stage?.dialogue?.length ?? 1
                      })()}
                    </div>
                  )}
                  {scenario.outcomeId && <div className="tavern-scenario-outcome">{locale === 'zh-CN' ? '剧情结果' : 'Outcome'} · {scenario.stages.flatMap((stage) => stage.branches ?? []).find((branch) => branch.id === scenario.outcomeId)?.title ?? scenario.outcomeId}</div>}
                  {editingScenarioId === scenario.id && !scenario.activeDialogue && (
                    <WorldScenarioEditor
                      scenario={scenario}
                      entities={world.entities.filter((entity) => (scenario.castEntityIds ?? []).includes(entity.id))}
                      structures={structures}
                      hiddenTargets={world.hiddenTargets}
                      locale={locale}
                      onChange={onUpdateScenario}
                      onSetTargetVisibility={onSetTargetVisibility}
                    />
                  )}
                </section>
              )
            })}
            <section className="tavern-memory-panel">
              <h3>{selectedEntity ? t('tavern.memoriesOf', { name: selectedEntity.name }) : t('tavern.memories')}</h3>
              {selectedEntity && (
                <div className="tavern-character-summary">
                  <Activity size={14} />
                  <span>{t(`worldEntity.behavior.${selectedEntity.behaviorState}`)}</span>
                  <span>{selectedEntity.activeCommand
                    ? t('worldEntity.currentOrder', { order: t(`worldEntity.order.${selectedEntity.activeCommand.type}`) })
                    : t('tavern.noActiveOrder')}</span>
                </div>
              )}
              <ol>
                {[...selectedMemories].reverse().slice(0, 16).map((memory) => {
                  const event = eventsById.get(memory.eventId)
                  return (
                    <li key={memory.id} className={`importance-${memory.importance}`}>
                      {event ? formatWorldEvent(event, locale) : t('tavern.fadedMemory')}
                    </li>
                  )
                })}
              </ol>
              {selectedMemories.length === 0 && <p className="muted">{t('tavern.noMemories')}</p>}
              <div className="tavern-relationships">
                <h4>{t('tavern.relationships')}</h4>
                {selectedRelationships.map((relationship) => {
                  const target = world.entities.find((entity) => entity.id === relationship.targetEntityId)
                  const tone = relationship.affinity >= 20 ? 'friendly' : relationship.affinity <= -20 ? 'hostile' : 'neutral'
                  return (
                    <button
                      type="button"
                      key={relationship.targetEntityId}
                      className={tone}
                      onClick={() => target && setSelectedEntityId(target.id)}
                      disabled={!target}
                    >
                      <span>{target?.name ?? relationship.targetEntityId}</span>
                      <span className="tavern-affinity-track" aria-hidden="true">
                        <i style={{ width: `${Math.abs(relationship.affinity)}%` }} />
                      </span>
                      <small>{t(`tavern.relationship.${tone}`)} · {relationship.affinity > 0 ? '+' : ''}{relationship.affinity} · {t('tavern.encounters', { count: relationship.encounters })}</small>
                    </button>
                  )
                })}
                {selectedRelationships.length === 0 && <p className="muted">{t('tavern.noRelationships')}</p>}
              </div>
            </section>

            <section className="tavern-chronicle">
              <header className="tavern-section-header">
                <h3><BookOpen size={16} />{t('tavern.chronicle')}</h3>
                <div className="tavern-scope-toggle">
                  <button type="button" className={chronicleScope === 'world' ? 'active' : ''} onClick={() => setChronicleScope('world')}>{t('tavern.scope.world')}</button>
                  <button type="button" className={chronicleScope === 'character' ? 'active' : ''} onClick={() => setChronicleScope('character')} disabled={!selectedEntity}>{t('tavern.scope.character')}</button>
                </div>
              </header>
              <ol>
                {[...visibleEvents].reverse().slice(0, 24).map((event) => (
                  <li key={event.id}><time>{formatWorldTime(event.timeSeconds)}</time>{formatWorldEvent(event, locale)}</li>
                ))}
              </ol>
              {visibleEvents.length === 0 && <p className="muted">{t('tavern.noEvents')}</p>}
            </section>

          </div>
        </div>
      </section>
    </div>
  )
}
