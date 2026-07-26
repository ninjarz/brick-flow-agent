import { Activity, Beer, BookOpen, Bot, CheckCircle2, Circle, Clipboard, Dice5, Eye, GlassWater, LockKeyhole, MessageCircle, Pencil, Send, Sparkles, Square, Trash2, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { formatWorldEvent } from '../lib/worldNarrative'
import type { WorldDirectorTurn, WorldScenarioRuntime, WorldState } from '../types/world'
import { WorldScenarioEditor } from './WorldScenarioEditor'
import type { BrickStructure } from '../types/bricks'
import type { TavernActivityKind, TavernActivityResult } from '../lib/worldTavernActivities'
import type { TavernDirectorEntry } from '../lib/worldTavernDirector'

type ActiveTavernDirectorTurn = Omit<WorldDirectorTurn, 'status'> & {
  status: WorldDirectorTurn['status'] | 'streaming'
}

type WorldTavernProps = {
  world: WorldState
  onGenerateStory: (focusEntityId?: string) => void
  onRunAiTurn: () => void
  onGetAiContext: () => string
  onClearHistory: () => void
  onUpdateScenario: (scenario: WorldScenarioRuntime) => void
  structures: BrickStructure[]
  onSetTargetVisibility: (target: WorldState['hiddenTargets'][number], visible: boolean) => void
  onPlayActivity: (activity: TavernActivityKind, focusEntityId?: string) => TavernActivityResult | undefined
  onPlayAiActivity: (activity: TavernActivityKind, focusEntityId?: string) => Promise<TavernActivityResult | undefined>
  onWatchActivity: (result: TavernActivityResult) => void
  llmConfigured: boolean
  isAiThinking: boolean
  isAiActivityThinking: boolean
  isDirectorThinking: boolean
  onDirectWorld: (
    text: string,
    recentEntries: TavernDirectorEntry[],
    onEntry: (entry: TavernDirectorEntry) => void,
  ) => Promise<void>
  onStopDirector: () => void
  onCommitDirectorTurn: (turn: WorldDirectorTurn) => void
  aiFeedback?: { tone: 'success' | 'error'; text: string }
  onClose: () => void
}

export const WorldTavern = ({
  world,
  onGenerateStory,
  onRunAiTurn,
  onGetAiContext,
  onClearHistory,
  onUpdateScenario,
  structures,
  onSetTargetVisibility,
  onPlayActivity,
  onPlayAiActivity,
  onWatchActivity,
  llmConfigured,
  isAiThinking,
  isAiActivityThinking,
  isDirectorThinking,
  onDirectWorld,
  onStopDirector,
  onCommitDirectorTurn,
  aiFeedback,
  onClose,
}: WorldTavernProps) => {
  const { locale, t } = useI18n()
  const [selectedEntityId, setSelectedEntityId] = useState(world.entities[0]?.id ?? '')
  const [confirmClear, setConfirmClear] = useState(false)
  const [aiContext, setAiContext] = useState('')
  const [contextCopyStatus, setContextCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [chronicleScope, setChronicleScope] = useState<'world' | 'character'>('world')
  const [storyScope, setStoryScope] = useState<'world' | 'character'>('world')
  const [editingScenarioId, setEditingScenarioId] = useState('')
  const [activityResult, setActivityResult] = useState<TavernActivityResult>()
  const [activityHost, setActivityHost] = useState<'local' | 'ai'>('local')
  const [directorInput, setDirectorInput] = useState('')
  const [activeDirectorTurn, setActiveDirectorTurn] = useState<ActiveTavernDirectorTurn>()
  const directorFeedRef = useRef<HTMLDivElement>(null)
  const directorInputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (world.entities.some((entity) => entity.id === selectedEntityId)) return
    setSelectedEntityId(world.entities[0]?.id ?? '')
  }, [selectedEntityId, world.entities])
  const selectedEntity = world.entities.find((entity) => entity.id === selectedEntityId)
  const selectedMemories = world.narrative.memoriesByEntityId[selectedEntityId] ?? []
  const selectedRelationships = Object.values(world.narrative.relationshipsByEntityId[selectedEntityId] ?? {})
    .sort((a, b) => Math.abs(b.affinity) - Math.abs(a.affinity) || b.encounters - a.encounters)
  const aiEntityCount = world.entities.filter((entity) => entity.controller === 'ai' && entity.health > 0).length
  const hiddenEntityIds = useMemo(() => new Set(world.hiddenTargets.filter((target) => target.kind === 'entity').map((target) => target.id)), [world.hiddenTargets])
  const livingCount = world.entities.filter((entity) => entity.health > 0).length
  const tavernCharacterCount = world.entities.filter((entity) => entity.health > 0 && !hiddenEntityIds.has(entity.id)).length
  const defeatedCount = world.entities.length - livingCount
  const activeOrderCount = world.entities.filter((entity) => entity.activeCommand || entity.commandQueue.length > 0).length
  const eventsById = useMemo(() => new Map(world.events.map((event) => [event.id, event])), [world.events])
  const visibleEvents = chronicleScope === 'character' && selectedEntityId
    ? world.events.filter((event) => event.actorId === selectedEntityId || event.targetId === selectedEntityId)
    : world.events
  const getStoryCharacterIds = (story: WorldState['narrative']['stories'][number]) => story.characterIds ?? Array.from(new Set(
    story.eventIds.flatMap((eventId) => {
      const event = eventsById.get(eventId)
      return event ? [event.actorId, event.targetId].filter((id): id is string => Boolean(id)) : []
    }),
  ))
  const visibleStories = storyScope === 'character' && selectedEntityId
    ? world.narrative.stories.filter((story) => getStoryCharacterIds(story).includes(selectedEntityId))
    : world.narrative.stories
  const formatWorldTime = (seconds: number) => {
    const totalSeconds = Math.max(0, Math.floor(seconds))
    const minutes = Math.floor(totalSeconds / 60)
    const remainder = totalSeconds % 60
    return `${minutes}:${remainder.toString().padStart(2, '0')}`
  }
  const playActivity = async (activity: TavernActivityKind) => {
    setActivityResult(undefined)
    const result = activityHost === 'ai'
      ? await onPlayAiActivity(activity, selectedEntityId)
      : onPlayActivity(activity, selectedEntityId)
    setActivityResult(result)
  }
  const submitDirectorInput = async () => {
    const text = directorInput.trim()
    if (!text || isDirectorThinking || !llmConfigured) return
    const id = `director-turn-${Date.now().toString(36)}`
    const recentEntries = world.narrative.directorTurns.flatMap((turn) => turn.entries).slice(-12)
    const createdAtSeconds = world.elapsedSeconds
    const collectedEntries: TavernDirectorEntry[] = []
    const newTurn: ActiveTavernDirectorTurn = { id, playerText: text, entries: [], createdAtSeconds, status: 'streaming' }
    setDirectorInput('')
    setActiveDirectorTurn(newTurn)
    let status: WorldDirectorTurn['status'] = 'completed'
    let errorMessage: string | undefined
    try {
      await onDirectWorld(text, recentEntries, (entry) => {
        collectedEntries.push(entry)
        setActiveDirectorTurn((current) => current?.id === id
          ? { ...current, entries: [...collectedEntries] }
          : current)
      })
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : (locale === 'zh-CN' ? '导演请求失败' : 'Director request failed')
      status = /取消|canceled/i.test(errorMessage) ? 'stopped' : 'failed'
    } finally {
      const completedTurn: WorldDirectorTurn = {
        id,
        playerText: text,
        entries: collectedEntries,
        createdAtSeconds,
        status,
        ...(errorMessage ? { error: errorMessage } : {}),
      }
      onCommitDirectorTurn(completedTurn)
      setActiveDirectorTurn(undefined)
    }
  }
  const displayedDirectorTurns: ActiveTavernDirectorTurn[] = [
    ...world.narrative.directorTurns,
    ...(activeDirectorTurn ? [activeDirectorTurn] : []),
  ].slice(-4)
  const directorEntryCount = displayedDirectorTurns.reduce((total, turn) => total + turn.entries.length, 0)
  useEffect(() => {
    const feed = directorFeedRef.current
    if (feed) feed.scrollTop = feed.scrollHeight
  }, [directorEntryCount, displayedDirectorTurns.length])

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
              disabled={world.events.length === 0 && world.narrative.stories.length === 0}
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
              <div><strong>{world.narrative.stories.length}</strong><small>{t('tavern.chapters')}</small></div>
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
            <section className="tavern-quick-play">
              <header>
                <div>
                  <h3><Sparkles size={16} />{locale === 'zh-CN' ? '酒馆一刻' : 'Tavern Moment'}</h3>
                  <small>{locale === 'zh-CN' ? '选中一个角色，点一下就有故事。' : 'Choose a character, then make a story in one click.'}</small>
                </div>
                <div className="tavern-quick-meta">
                  <div className="tavern-host-toggle" role="group" aria-label={locale === 'zh-CN' ? '酒馆主持方式' : 'Tavern host mode'}>
                    <button type="button" className={activityHost === 'local' ? 'active' : ''} disabled={isAiActivityThinking} onClick={() => { setActivityHost('local'); setActivityResult(undefined) }}>
                      {locale === 'zh-CN' ? '本地' : 'Local'}
                    </button>
                    <button type="button" className={activityHost === 'ai' ? 'active' : ''} disabled={!llmConfigured || isAiActivityThinking} title={!llmConfigured ? (locale === 'zh-CN' ? '配置 LLM 后可用' : 'Configure the LLM first') : undefined} onClick={() => { setActivityHost('ai'); setActivityResult(undefined) }}>
                      <Bot size={11} />{locale === 'zh-CN' ? 'AI 主持' : 'AI Host'}
                    </button>
                  </div>
                  {selectedEntity && <span>{locale === 'zh-CN' ? `主角：${selectedEntity.name}` : `Lead: ${selectedEntity.name}`}</span>}
                </div>
              </header>
              {isAiActivityThinking ? (
                <div className="tavern-quick-loading" role="status"><Bot size={17} />{locale === 'zh-CN' ? 'AI 正在翻阅记忆、组织两句像样的话……' : 'AI is checking memories and composing a short scene…'}</div>
              ) : !activityResult ? (
                <div className="tavern-quick-actions">
                  <button type="button" disabled={tavernCharacterCount === 0} onClick={() => void playActivity('toast')}>
                    <GlassWater size={18} /><span><strong>{locale === 'zh-CN' ? '碰一杯' : 'Raise a Mug'}</strong><small>{locale === 'zh-CN' ? '让两名角色轻松聊聊' : 'Let two characters unwind'}</small></span>
                  </button>
                  <button type="button" disabled={tavernCharacterCount === 0} onClick={() => void playActivity('dice')}>
                    <Dice5 size={18} /><span><strong>{locale === 'zh-CN' ? '掷骰子' : 'Roll Dice'}</strong><small>{locale === 'zh-CN' ? '一局定今晚的运气' : "Test tonight's luck"}</small></span>
                  </button>
                  <button type="button" disabled={tavernCharacterCount === 0} onClick={() => void playActivity('rumor')}>
                    <MessageCircle size={18} /><span><strong>{locale === 'zh-CN' ? '听传闻' : 'Hear a Rumor'}</strong><small>{locale === 'zh-CN' ? '从当前任务长出线索' : 'Grow a hook from the quest'}</small></span>
                  </button>
                </div>
              ) : (
                <div className="tavern-quick-result" role="status">
                  <div>
                    <strong>{activityResult.title}<small>{activityResult.source === 'ai' ? (locale === 'zh-CN' ? 'AI 主持' : 'AI host') : (locale === 'zh-CN' ? '本地规则' : 'Local rules')}</small></strong>
                    <p>{activityResult.body}{activityResult.notice && <em> · {activityResult.notice}</em>}</p>
                  </div>
                  <span className="tavern-quick-result-actions">
                    <button type="button" onClick={() => setActivityResult(undefined)}>{locale === 'zh-CN' ? '再来一次' : 'Again'}</button>
                    <button type="button" onClick={() => { onWatchActivity(activityResult); onClose() }}>{locale === 'zh-CN' ? '去看看' : 'Watch it'}</button>
                  </span>
                </div>
              )}
            </section>
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

            <section className="tavern-stories">
              <header>
                <div>
                  <h3>{t('tavern.stories')}</h3>
                  <small>{t('tavern.localStoryHint')}</small>
                </div>
                <div className="tavern-story-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setAiContext((current) => current ? '' : onGetAiContext())
                      setContextCopyStatus('idle')
                    }}
                  >
                    <Eye size={15} />
                    {aiContext ? t('tavern.hideAiContext') : t('tavern.previewAiContext')}
                  </button>
                  <button
                    type="button"
                    onClick={onRunAiTurn}
                    disabled={!llmConfigured || aiEntityCount === 0 || isAiThinking}
                    title={!llmConfigured ? t('tavern.aiNeedsConfig') : aiEntityCount === 0 ? t('tavern.aiNeedsEntity') : undefined}
                  >
                    <Bot size={15} />
                    {isAiThinking ? t('tavern.aiThinking') : t('tavern.runAiTurn', { count: aiEntityCount })}
                  </button>
                  <button
                    type="button"
                    onClick={() => onGenerateStory(storyScope === 'character' ? selectedEntityId : undefined)}
                    disabled={world.entities.length === 0 && world.events.length === 0}
                  >
                    <Sparkles size={15} />
                    {storyScope === 'character' && selectedEntity
                      ? t('tavern.generateCharacterRumor', { name: selectedEntity.name })
                      : t('tavern.generateRumor')}
                  </button>
                </div>
              </header>
              {aiContext && (
                <section className="tavern-ai-context">
                  <header>
                    <div>
                      <strong>{t('tavern.aiContextTitle')}</strong>
                      <small>{t('tavern.aiContextHint')}</small>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(aiContext)
                          setContextCopyStatus('copied')
                        } catch {
                          setContextCopyStatus('failed')
                        }
                      }}
                    >
                      <Clipboard size={14} />
                      {t(`tavern.contextCopy.${contextCopyStatus}`)}
                    </button>
                  </header>
                  <pre>{aiContext}</pre>
                </section>
              )}
              {aiFeedback && <p className={`tavern-ai-feedback ${aiFeedback.tone}`}>{aiFeedback.text}</p>}
              <div className="tavern-story-filter">
                <span>{t('tavern.storyScope')}</span>
                <div className="tavern-scope-toggle">
                  <button type="button" className={storyScope === 'world' ? 'active' : ''} onClick={() => setStoryScope('world')}>{t('tavern.scope.world')}</button>
                  <button type="button" className={storyScope === 'character' ? 'active' : ''} onClick={() => setStoryScope('character')} disabled={!selectedEntity}>{t('tavern.scope.character')}</button>
                </div>
              </div>
              {[...visibleStories].reverse().map((story) => {
                const characterNames = getStoryCharacterIds(story)
                  .map((id) => world.entities.find((entity) => entity.id === id)?.name)
                  .filter((name): name is string => Boolean(name))
                return (
                <article key={story.id}>
                  <strong>{story.title}</strong>
                  <p>{story.body}</p>
                  <small>
                    {t('tavern.storyMeta', {
                      chapter: story.chapterNumber ?? world.narrative.stories.indexOf(story) + 1,
                      time: formatWorldTime(story.createdAtSeconds),
                      source: story.source === 'ai' ? t('tavern.sourceAi') : t('tavern.sourceLocal'),
                    })}
                    {characterNames.length > 0 ? ` · ${characterNames.join('、')}` : ''}
                  </small>
                </article>
                )
              })}
              {visibleStories.length === 0 && <p className="muted">{storyScope === 'character' ? t('tavern.noCharacterStories') : t('tavern.noStories')}</p>}
            </section>
          </div>
        </div>
        {llmConfigured && (
          <section className="tavern-director" aria-label={locale === 'zh-CN' ? 'AI 剧情导演' : 'AI story director'}>
            {displayedDirectorTurns.length > 0 && (
              <div ref={directorFeedRef} className="tavern-director-feed" aria-live="polite">
                {displayedDirectorTurns.map((turn) => (
                  <div className="tavern-director-turn" key={turn.id}>
                    <p className="player"><strong>{locale === 'zh-CN' ? '你' : 'You'}</strong>{turn.playerText}</p>
                    {turn.entries.map((entry) => {
                      if (entry.type === 'narration') return <p key={entry.id} className="narration">{entry.text}</p>
                      if (entry.type === 'dialogue') {
                        const speaker = world.entities.find((entity) => entity.id === entry.speakerId)
                        return <p key={entry.id} className="dialogue"><strong>{speaker?.name ?? entry.speakerId}</strong>{entry.text}</p>
                      }
                      if (entry.type === 'command') {
                        const actor = world.entities.find((entity) => entity.id === entry.entityId)
                        const commandTarget = 'target' in entry.command ? entry.command.target : undefined
                        const target = commandTarget
                          ? world.entities.find((entity) => entity.id === commandTarget.id)?.name ?? commandTarget.id
                          : ''
                        return <p key={entry.id} className={`operation ${entry.status ?? ''}`}><strong>{entry.status === 'rejected' ? '×' : '✓'} {actor?.name ?? entry.entityId}</strong>{entry.command.type}{target ? ` → ${target}` : ''}{entry.detail ? ` · ${entry.detail}` : ''}</p>
                      }
                      if (entry.type === 'relationship') {
                        const from = world.entities.find((entity) => entity.id === entry.fromId)?.name ?? entry.fromId
                        const to = world.entities.find((entity) => entity.id === entry.toId)?.name ?? entry.toId
                        return <p key={entry.id} className={`operation ${entry.status ?? ''}`}><strong>{from} → {to}</strong>{entry.before ?? 0} → {entry.after ?? 0} · {entry.reason}</p>
                      }
                      if (entry.type === 'choice') return <button key={entry.id} type="button" className="choice" disabled={isDirectorThinking} onClick={() => {
                        setDirectorInput(entry.suggestedInput)
                        window.requestAnimationFrame(() => directorInputRef.current?.focus())
                      }}>{entry.label}</button>
                      return <p key={entry.id} className="summary">{entry.summary}</p>
                    })}
                    {turn.status === 'streaming' && <p className="streaming"><Bot size={12} />{locale === 'zh-CN' ? '剧情正在展开……' : 'The story is unfolding…'}</p>}
                    {turn.error && <p className="error">{turn.error}</p>}
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={(event) => { event.preventDefault(); void submitDirectorInput() }}>
              <textarea
                ref={directorInputRef}
                value={directorInput}
                onChange={(event) => setDirectorInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                  event.preventDefault()
                  void submitDirectorInput()
                }}
                rows={2}
                maxLength={800}
                disabled={isDirectorThinking}
                placeholder={locale === 'zh-CN'
                  ? '例如：让罗兰先和黑岩使者谈谈，尽量避免战斗。'
                  : 'For example: Have Roland question the envoy and avoid a fight.'}
              />
              {isDirectorThinking ? (
                <button type="button" className="stop" onClick={onStopDirector}><Square size={15} />{locale === 'zh-CN' ? '停止' : 'Stop'}</button>
              ) : (
                <button type="submit" disabled={!directorInput.trim()}><Send size={15} />{locale === 'zh-CN' ? '导演' : 'Direct'}</button>
              )}
            </form>
            <small>{locale === 'zh-CN' ? 'AI 负责理解与对白；移动、战斗和数值变化仍由世界规则校验。' : 'AI handles intent and dialogue; world rules still validate movement, combat, and values.'}</small>
          </section>
        )}
      </section>
    </div>
  )
}
