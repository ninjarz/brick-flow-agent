import { Activity, Beer, BookOpen, Bot, CheckCircle2, Circle, Clipboard, Eye, LockKeyhole, Sparkles, Trash2, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { formatWorldEvent } from '../lib/worldNarrative'
import type { WorldState } from '../types/world'

type WorldTavernProps = {
  world: WorldState
  onGenerateStory: (focusEntityId?: string) => void
  onRunAiTurn: () => void
  onGetAiContext: () => string
  onClearHistory: () => void
  llmConfigured: boolean
  isAiThinking: boolean
  aiFeedback?: { tone: 'success' | 'error'; text: string }
  onClose: () => void
}

export const WorldTavern = ({
  world,
  onGenerateStory,
  onRunAiTurn,
  onGetAiContext,
  onClearHistory,
  llmConfigured,
  isAiThinking,
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
  useEffect(() => {
    if (world.entities.some((entity) => entity.id === selectedEntityId)) return
    setSelectedEntityId(world.entities[0]?.id ?? '')
  }, [selectedEntityId, world.entities])
  const selectedEntity = world.entities.find((entity) => entity.id === selectedEntityId)
  const selectedMemories = world.narrative.memoriesByEntityId[selectedEntityId] ?? []
  const selectedRelationships = Object.values(world.narrative.relationshipsByEntityId[selectedEntityId] ?? {})
    .sort((a, b) => Math.abs(b.affinity) - Math.abs(a.affinity) || b.encounters - a.encounters)
  const aiEntityCount = world.entities.filter((entity) => entity.controller === 'ai' && entity.health > 0).length
  const livingCount = world.entities.filter((entity) => entity.health > 0).length
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
                  <small>{t(`worldEntity.faction.${entity.factionId}`)} · {entity.health}/{entity.maxHealth} · {t(`worldEntity.behavior.${entity.behaviorState}`)}</small>
                </div>
              </button>
            ))}
            {world.entities.length === 0 && <p className="muted">{t('tavern.noCharacters')}</p>}
          </aside>

          <div className="tavern-content">
            {world.scenarios.map((scenario) => {
              const completedCount = scenario.stages.filter((stage) => stage.status === 'completed').length
              return (
                <section className="tavern-quest" key={scenario.id}>
                  <header>
                    <div>
                      <h3><BookOpen size={16} />{scenario.title}</h3>
                      <p>{scenario.description}</p>
                    </div>
                    <strong>{t('tavern.questProgress', { completed: completedCount, total: scenario.stages.length })}</strong>
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
                        </div>
                        {stage.status === 'active' && <small>{t('tavern.currentObjective')}</small>}
                      </li>
                    ))}
                  </ol>
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
      </section>
    </div>
  )
}
