import { Beer, BookOpen, Bot, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { formatWorldEvent } from '../lib/worldNarrative'
import type { WorldState } from '../types/world'

type WorldTavernProps = {
  world: WorldState
  onGenerateStory: () => void
  onRunAiTurn: () => void
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
  onClearHistory,
  llmConfigured,
  isAiThinking,
  aiFeedback,
  onClose,
}: WorldTavernProps) => {
  const { locale, t } = useI18n()
  const [selectedEntityId, setSelectedEntityId] = useState(world.entities[0]?.id ?? '')
  const [confirmClear, setConfirmClear] = useState(false)
  useEffect(() => {
    if (world.entities.some((entity) => entity.id === selectedEntityId)) return
    setSelectedEntityId(world.entities[0]?.id ?? '')
  }, [selectedEntityId, world.entities])
  const selectedEntity = world.entities.find((entity) => entity.id === selectedEntityId)
  const selectedMemories = world.narrative.memoriesByEntityId[selectedEntityId] ?? []
  const selectedRelationships = Object.values(world.narrative.relationshipsByEntityId[selectedEntityId] ?? {})
    .sort((a, b) => Math.abs(b.affinity) - Math.abs(a.affinity) || b.encounters - a.encounters)
  const aiEntityCount = world.entities.filter((entity) => entity.controller === 'ai' && entity.health > 0).length
  const eventsById = useMemo(() => new Map(world.events.map((event) => [event.id, event])), [world.events])

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
            <strong>{t('tavern.characters')}</strong>
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
                  <small>{t(`worldEntity.faction.${entity.factionId}`)} · {entity.health}/{entity.maxHealth}</small>
                </div>
              </button>
            ))}
            {world.entities.length === 0 && <p className="muted">{t('tavern.noCharacters')}</p>}
          </aside>

          <div className="tavern-content">
            <section className="tavern-memory-panel">
              <h3>{selectedEntity ? t('tavern.memoriesOf', { name: selectedEntity.name }) : t('tavern.memories')}</h3>
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
                    <div key={relationship.targetEntityId} className={tone}>
                      <span>{target?.name ?? relationship.targetEntityId}</span>
                      <small>{t(`tavern.relationship.${tone}`)} · {relationship.affinity > 0 ? '+' : ''}{relationship.affinity} · {t('tavern.encounters', { count: relationship.encounters })}</small>
                    </div>
                  )
                })}
                {selectedRelationships.length === 0 && <p className="muted">{t('tavern.noRelationships')}</p>}
              </div>
            </section>

            <section className="tavern-chronicle">
              <h3><BookOpen size={16} />{t('tavern.chronicle')}</h3>
              <ol>
                {[...world.events].reverse().slice(0, 24).map((event) => (
                  <li key={event.id}>{formatWorldEvent(event, locale)}</li>
                ))}
              </ol>
              {world.events.length === 0 && <p className="muted">{t('tavern.noEvents')}</p>}
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
                    onClick={onRunAiTurn}
                    disabled={!llmConfigured || aiEntityCount === 0 || isAiThinking}
                    title={!llmConfigured ? t('tavern.aiNeedsConfig') : aiEntityCount === 0 ? t('tavern.aiNeedsEntity') : undefined}
                  >
                    <Bot size={15} />
                    {isAiThinking ? t('tavern.aiThinking') : t('tavern.runAiTurn', { count: aiEntityCount })}
                  </button>
                  <button type="button" onClick={onGenerateStory} disabled={world.entities.length === 0 && world.events.length === 0}>
                    <Sparkles size={15} />
                    {t('tavern.generateRumor')}
                  </button>
                </div>
              </header>
              {aiFeedback && <p className={`tavern-ai-feedback ${aiFeedback.tone}`}>{aiFeedback.text}</p>}
              {[...world.narrative.stories].reverse().map((story) => (
                <article key={story.id}>
                  <strong>{story.title}</strong>
                  <p>{story.body}</p>
                  <small>{story.source === 'ai' ? t('tavern.sourceAi') : t('tavern.sourceLocal')}</small>
                </article>
              ))}
              {world.narrative.stories.length === 0 && <p className="muted">{t('tavern.noStories')}</p>}
            </section>
          </div>
        </div>
      </section>
    </div>
  )
}
