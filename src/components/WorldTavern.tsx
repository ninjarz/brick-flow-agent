import { Activity, Beer, BookOpen, CheckCircle2, Circle, Copy, LockKeyhole, Pause, Pencil, Play, Plus, RotateCcw, Save, Trash2, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { formatWorldEvent } from '../lib/worldNarrative'
import { createWorldScenarioFlow, duplicateWorldScenarioFlow, resetWorldScenarioFlow } from '../lib/worldScenarioAuthoring'
import { validateWorldScenario } from '../lib/worldScenarioValidation'
import type { WorldScenarioRuntime, WorldState } from '../types/world'
import { WorldScenarioEditor } from './WorldScenarioEditor'
import type { BrickStructure } from '../types/bricks'

type WorldTavernProps = {
  world: WorldState
  onClearHistory: () => void
  onUpdateScenario: (scenario: WorldScenarioRuntime) => void
  onAddScenario: (scenario: WorldScenarioRuntime) => void
  onDeleteScenario: (scenarioId: string) => void
  structures: BrickStructure[]
  onSetTargetVisibility: (target: WorldState['hiddenTargets'][number], visible: boolean) => void
  onClose: () => void
}

type ScenarioEditSession = {
  baseline: WorldScenarioRuntime
  draft: WorldScenarioRuntime
  resumeAfterEditing: boolean
}

export const WorldTavern = ({
  world,
  onClearHistory,
  onUpdateScenario,
  onAddScenario,
  onDeleteScenario,
  structures,
  onSetTargetVisibility,
  onClose,
}: WorldTavernProps) => {
  const { locale, t } = useI18n()
  const [selectedEntityId, setSelectedEntityId] = useState(world.entities[0]?.id ?? '')
  const [confirmClear, setConfirmClear] = useState(false)
  const [chronicleScope, setChronicleScope] = useState<'world' | 'character'>('world')
  const [scenarioEditSession, setScenarioEditSession] = useState<ScenarioEditSession | null>(null)
  const [confirmDeleteScenarioId, setConfirmDeleteScenarioId] = useState('')
  const [confirmCloseEditor, setConfirmCloseEditor] = useState(false)
  const editingScenarioId = scenarioEditSession?.draft.id ?? ''
  const scenarioDraftChanged = Boolean(scenarioEditSession)
    && JSON.stringify(scenarioEditSession?.draft) !== JSON.stringify(scenarioEditSession?.baseline)
  const scenarioDraftIssues = useMemo(() => scenarioEditSession
    ? validateWorldScenario(scenarioEditSession.draft, {
        entityIds: world.entities.map((entity) => entity.id),
        structureIds: structures.map((structure) => structure.id),
      })
    : [], [scenarioEditSession, structures, world.entities])
  const scenarioDraftErrorCount = scenarioDraftIssues.filter((issue) => issue.severity === 'error').length
  const processedEventIds = () => world.events.map((event) => event.id).slice(-500)
  const beginScenarioEditing = (scenario: WorldScenarioRuntime) => {
    const resumeAfterEditing = scenario.enabled !== false
    const draft = resumeAfterEditing ? { ...scenario, enabled: false } : scenario
    if (resumeAfterEditing) onUpdateScenario(draft)
    setScenarioEditSession({ baseline: draft, draft, resumeAfterEditing })
    setConfirmDeleteScenarioId('')
    setConfirmCloseEditor(false)
  }
  const closeScenarioEditing = (save: boolean) => {
    if (!scenarioEditSession) return
    const currentScenario = world.scenarios.find((scenario) => scenario.id === scenarioEditSession.draft.id)
    if (save) {
      onUpdateScenario({
        ...scenarioEditSession.draft,
        enabled: scenarioEditSession.resumeAfterEditing || scenarioEditSession.draft.enabled,
        ...(scenarioEditSession.resumeAfterEditing ? { processedEventIds: processedEventIds() } : {}),
      })
    } else if (scenarioEditSession.resumeAfterEditing && currentScenario) {
      onUpdateScenario({
        ...currentScenario,
        enabled: true,
        processedEventIds: processedEventIds(),
      })
    }
    setScenarioEditSession(null)
    setConfirmCloseEditor(false)
  }
  const requestCloseTavern = () => {
    if (!scenarioEditSession) {
      onClose()
      return
    }
    if (scenarioDraftChanged && !confirmCloseEditor) {
      setConfirmCloseEditor(true)
      return
    }
    closeScenarioEditing(false)
    onClose()
  }
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
    <div className="modal-backdrop" role="presentation" onMouseDown={requestCloseTavern}>
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
            <button
              className={`icon-button tavern-close-button${confirmCloseEditor ? ' confirm' : ''}`}
              type="button"
              aria-label={confirmCloseEditor
                ? (locale === 'zh-CN' ? '再次点击放弃修改并关闭' : 'Click again to discard and close')
                : t('common.close')}
              title={confirmCloseEditor
                ? (locale === 'zh-CN' ? '再次点击放弃修改并关闭' : 'Click again to discard and close')
                : t('common.close')}
              onClick={requestCloseTavern}
            >
              <X size={18} />
              {confirmCloseEditor && <span>{locale === 'zh-CN' ? '放弃并关闭' : 'Discard & close'}</span>}
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
            <section className="tavern-flow-toolbar">
              <div>
                <strong><BookOpen size={15} />{locale === 'zh-CN' ? `剧情流程 ${world.scenarios.length} 条` : `${world.scenarios.length} story flows`}</strong>
                <small>{locale === 'zh-CN'
                  ? '每条流程地位平等、独立判定并可同时推进；节点之间可以自由连接和分支。'
                  : 'Every flow is equal, evaluated independently, and may advance in parallel.'}</small>
              </div>
              <button
                type="button"
                disabled={Boolean(scenarioEditSession)}
                title={scenarioEditSession
                  ? (locale === 'zh-CN' ? '请先保存或取消当前编辑' : 'Save or cancel the current edit first')
                  : undefined}
                onClick={() => {
                  const scenario = createWorldScenarioFlow(
                    world.scenarios,
                    world.entities.map((entity) => entity.id),
                    world.events.map((event) => event.id),
                    locale,
                  )
                  onAddScenario(scenario)
                  setScenarioEditSession({
                    baseline: scenario,
                    draft: scenario,
                    resumeAfterEditing: false,
                  })
                  setConfirmCloseEditor(false)
                }}
              >
                <Plus size={14} />{locale === 'zh-CN' ? '新建流程' : 'New flow'}
              </button>
            </section>
            {world.scenarios.map((scenario) => {
              const completedCount = scenario.stages.filter((stage) => stage.status === 'completed').length
              const hasActiveNode = scenario.stages.some((stage) => stage.status === 'active')
              const flowStatus = scenario.enabled === false
                ? (editingScenarioId === scenario.id
                    ? (locale === 'zh-CN' ? '创作中' : 'Authoring')
                    : completedCount === 0 ? (locale === 'zh-CN' ? '草稿' : 'Draft') : (locale === 'zh-CN' ? '已暂停' : 'Paused'))
                : hasActiveNode
                  ? (locale === 'zh-CN' ? '探索中' : 'Exploring')
                  : (locale === 'zh-CN' ? '已结束' : 'Completed')
              return (
                <section className={`tavern-quest${scenario.enabled === false ? ' paused' : ''}`} key={scenario.id}>
                  <header>
                    <div>
                      <h3><BookOpen size={16} />{scenario.title}</h3>
                      <p>{scenario.description}</p>
                    </div>
                    <div className="tavern-quest-actions">
                      <span className={`tavern-flow-status${scenario.enabled === false ? ' paused' : hasActiveNode ? ' active' : ' completed'}`}>{flowStatus}</span>
                      <strong>{t('tavern.questProgress', { completed: completedCount, total: scenario.stages.length })}</strong>
                      <button
                        type="button"
                        disabled={Boolean(scenario.activeDialogue) || !hasActiveNode || Boolean(scenarioEditSession)}
                        title={scenario.activeDialogue
                          ? (locale === 'zh-CN' ? '演出结束后才能暂停' : 'Pause after the performance')
                          : undefined}
                        onClick={() => onUpdateScenario({
                          ...scenario,
                          enabled: scenario.enabled === false,
                          ...(scenario.enabled === false
                            ? { processedEventIds: world.events.map((event) => event.id).slice(-500) }
                            : {}),
                        })}
                      >
                        {scenario.enabled === false ? <Play size={13} /> : <Pause size={13} />}
                        {scenario.enabled === false
                          ? (locale === 'zh-CN' ? '启用' : 'Enable')
                          : (locale === 'zh-CN' ? '暂停' : 'Pause')}
                      </button>
                      {!hasActiveNode && (
                        <button
                          type="button"
                          disabled={Boolean(scenarioEditSession)}
                          onClick={() => onUpdateScenario(resetWorldScenarioFlow(
                            scenario,
                            world.events.map((event) => event.id),
                          ))}
                        >
                          <RotateCcw size={13} />{locale === 'zh-CN' ? '重新开始' : 'Restart'}
                        </button>
                      )}
                      <button
                        type="button"
                        className={editingScenarioId === scenario.id ? 'active' : ''}
                        disabled={Boolean(scenario.activeDialogue) || (Boolean(scenarioEditSession) && editingScenarioId !== scenario.id)}
                        title={scenario.activeDialogue
                          ? (locale === 'zh-CN' ? '对话演出结束后可编辑' : 'Editable after dialogue finishes')
                          : scenarioEditSession && editingScenarioId !== scenario.id
                            ? (locale === 'zh-CN' ? '请先保存或取消当前编辑' : 'Save or cancel the current edit first')
                            : undefined}
                        onClick={() => {
                          if (editingScenarioId === scenario.id) return
                          beginScenarioEditing(scenario)
                        }}
                      >
                        <Pencil size={13} />{editingScenarioId === scenario.id
                          ? (locale === 'zh-CN' ? '编辑中' : 'Editing')
                          : (locale === 'zh-CN' ? '创作' : 'Author')}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(scenarioEditSession)}
                        title={locale === 'zh-CN' ? '复制为独立流程' : 'Duplicate as an independent flow'}
                        onClick={() => {
                          const copied = duplicateWorldScenarioFlow(
                            scenario,
                            world.scenarios,
                            world.events.map((event) => event.id),
                            locale,
                          )
                          onAddScenario(copied)
                          setScenarioEditSession({
                            baseline: copied,
                            draft: copied,
                            resumeAfterEditing: false,
                          })
                          setConfirmCloseEditor(false)
                        }}
                      >
                        <Copy size={13} />{locale === 'zh-CN' ? '复制' : 'Duplicate'}
                      </button>
                      <button
                        type="button"
                        className={confirmDeleteScenarioId === scenario.id ? 'danger confirm' : 'danger'}
                        disabled={Boolean(scenario.activeDialogue) || Boolean(scenarioEditSession)}
                        title={scenario.activeDialogue ? (locale === 'zh-CN' ? '演出结束后才能删除' : 'Delete after the performance') : undefined}
                        onClick={() => {
                          if (confirmDeleteScenarioId !== scenario.id) {
                            setConfirmDeleteScenarioId(scenario.id)
                            return
                          }
                          onDeleteScenario(scenario.id)
                          setConfirmDeleteScenarioId('')
                        }}
                      >
                        <Trash2 size={13} />{confirmDeleteScenarioId === scenario.id
                          ? (locale === 'zh-CN' ? '确认删除' : 'Confirm')
                          : (locale === 'zh-CN' ? '删除' : 'Delete')}
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
                  {scenario.outcomeId && <div className="tavern-scenario-outcome">{locale === 'zh-CN' ? '流程结果' : 'Flow result'} · {scenario.stages.flatMap((stage) => stage.branches ?? []).find((branch) => branch.id === scenario.outcomeId)?.title ?? scenario.outcomeId}</div>}
                  {editingScenarioId === scenario.id && !scenario.activeDialogue && (
                    <>
                      <div className="scenario-edit-session-bar">
                        <div>
                          <strong>{locale === 'zh-CN' ? '安全创作模式' : 'Safe authoring mode'}</strong>
                          <small>{scenarioDraftChanged
                            ? (locale === 'zh-CN' ? '有尚未保存的修改，世界中的流程仍保持原样。' : 'You have unsaved changes; the world flow is unchanged.')
                            : (locale === 'zh-CN' ? '修改会先保存在草稿中，确认后才应用。' : 'Changes stay in a draft until you apply them.')}</small>
                        </div>
                        <span className={scenarioDraftChanged ? 'dirty' : ''}>{scenarioDraftChanged
                          ? (locale === 'zh-CN' ? '未保存' : 'Unsaved')
                          : (locale === 'zh-CN' ? '无修改' : 'No changes')}</span>
                        <button type="button" disabled={!scenarioDraftChanged} onClick={() => setScenarioEditSession((current) => current ? { ...current, draft: current.baseline } : current)}>
                          <RotateCcw size={13} />{locale === 'zh-CN' ? '撤销全部' : 'Reset'}
                        </button>
                        <button type="button" onClick={() => closeScenarioEditing(false)}>
                          <X size={13} />{locale === 'zh-CN' ? '取消' : 'Cancel'}
                        </button>
                        <button
                          type="button"
                          className="primary"
                          disabled={!scenarioDraftChanged || scenarioDraftErrorCount > 0}
                          title={scenarioDraftErrorCount > 0
                            ? (locale === 'zh-CN' ? `请先修复 ${scenarioDraftErrorCount} 个错误` : `Fix ${scenarioDraftErrorCount} error(s) first`)
                            : undefined}
                          onClick={() => closeScenarioEditing(true)}
                        >
                          <Save size={13} />{scenarioEditSession?.resumeAfterEditing
                            ? (locale === 'zh-CN' ? '保存并继续运行' : 'Save and resume')
                            : (locale === 'zh-CN' ? '保存草稿' : 'Save draft')}
                        </button>
                      </div>
                      {scenarioEditSession && (
                        <WorldScenarioEditor
                          scenario={scenarioEditSession.draft}
                          entities={world.entities}
                          structures={structures}
                          hiddenTargets={world.hiddenTargets}
                          locale={locale}
                          onChange={(draft) => {
                            setScenarioEditSession((current) => current ? { ...current, draft } : current)
                            setConfirmCloseEditor(false)
                          }}
                          onSetTargetVisibility={onSetTargetVisibility}
                        />
                      )}
                    </>
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
