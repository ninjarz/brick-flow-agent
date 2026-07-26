import { BookOpen, Bot, ChevronDown, MessageCircle, Send, Sparkles, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import type { TavernDirectorEntry } from '../lib/worldTavernDirector'
import type { WorldDirectorTurn, WorldState } from '../types/world'

type ActiveDirectorTurn = Omit<WorldDirectorTurn, 'status'> & {
  status: WorldDirectorTurn['status'] | 'streaming'
}

type WorldStoryDockProps = {
  world: WorldState
  llmConfigured: boolean
  isAiThinking: boolean
  isDirectorThinking: boolean
  aiFeedback?: { tone: 'success' | 'error'; text: string }
  onGenerateStory: () => void
  onRunAiTurn: () => void
  onDirectWorld: (
    text: string,
    recentEntries: TavernDirectorEntry[],
    onEntry: (entry: TavernDirectorEntry) => void,
  ) => Promise<void>
  onStopDirector: () => void
  onCommitDirectorTurn: (turn: WorldDirectorTurn) => void
  onClose: () => void
}

export const WorldStoryDock = ({
  world,
  llmConfigured,
  isAiThinking,
  isDirectorThinking,
  aiFeedback,
  onGenerateStory,
  onRunAiTurn,
  onDirectWorld,
  onStopDirector,
  onCommitDirectorTurn,
  onClose,
}: WorldStoryDockProps) => {
  const { locale, t } = useI18n()
  const [tab, setTab] = useState<'director' | 'stories'>('director')
  const [collapsed, setCollapsed] = useState(false)
  const [input, setInput] = useState('')
  const [activeTurn, setActiveTurn] = useState<ActiveDirectorTurn>()
  const feedRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const displayedTurns: ActiveDirectorTurn[] = [
    ...world.narrative.directorTurns,
    ...(activeTurn ? [activeTurn] : []),
  ].slice(-5)
  const entryCount = displayedTurns.reduce((total, turn) => total + turn.entries.length, 0)

  useEffect(() => {
    const feed = feedRef.current
    if (feed) feed.scrollTop = feed.scrollHeight
  }, [entryCount, displayedTurns.length])

  const submit = async () => {
    const playerText = input.trim()
    if (!playerText || isDirectorThinking || !llmConfigured) return
    const id = `director-turn-${Date.now().toString(36)}`
    const createdAtSeconds = world.elapsedSeconds
    const entries: TavernDirectorEntry[] = []
    setInput('')
    setActiveTurn({ id, playerText, entries: [], createdAtSeconds, status: 'streaming' })
    let status: WorldDirectorTurn['status'] = 'completed'
    let errorMessage: string | undefined
    try {
      await onDirectWorld(
        playerText,
        world.narrative.directorTurns.flatMap((turn) => turn.entries).slice(-12),
        (entry) => {
          entries.push(entry)
          setActiveTurn((current) => current?.id === id ? { ...current, entries: [...entries] } : current)
        },
      )
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : (locale === 'zh-CN' ? '导演请求失败' : 'Director request failed')
      status = /取消|canceled/i.test(errorMessage) ? 'stopped' : 'failed'
    } finally {
      onCommitDirectorTurn({
        id,
        playerText,
        entries,
        createdAtSeconds,
        status,
        ...(errorMessage ? { error: errorMessage } : {}),
      })
      setActiveTurn(undefined)
    }
  }

  return (
    <section className={`world-story-dock${collapsed ? ' collapsed' : ''}`} aria-label={locale === 'zh-CN' ? '世界剧情' : 'World story'}>
      <header>
        <div role="tablist" aria-label={locale === 'zh-CN' ? '剧情视图' : 'Story view'}>
          <button type="button" role="tab" aria-selected={tab === 'director'} className={tab === 'director' ? 'active' : ''} onClick={() => { setTab('director'); setCollapsed(false) }}>
            <MessageCircle size={13} />{locale === 'zh-CN' ? '剧情对话' : 'Director'}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'stories'} className={tab === 'stories' ? 'active' : ''} onClick={() => { setTab('stories'); setCollapsed(false) }}>
            <BookOpen size={13} />{locale === 'zh-CN' ? `酒馆故事 ${world.narrative.stories.length}` : `Stories ${world.narrative.stories.length}`}
          </button>
        </div>
        <span>
          <button className="icon-button" type="button" aria-label={collapsed ? (locale === 'zh-CN' ? '展开' : 'Expand') : (locale === 'zh-CN' ? '折叠' : 'Collapse')} onClick={() => setCollapsed((current) => !current)}>
            <ChevronDown size={14} />
          </button>
          <button className="icon-button" type="button" aria-label={t('common.close')} onClick={onClose}><X size={14} /></button>
        </span>
      </header>
      {!collapsed && tab === 'director' && (
        <div className="world-story-director">
          <div ref={feedRef} className="world-story-feed" aria-live="polite">
            {displayedTurns.map((turn) => (
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
                    const targetRef = 'target' in entry.command ? entry.command.target : undefined
                    const target = targetRef ? world.entities.find((entity) => entity.id === targetRef.id)?.name ?? targetRef.id : ''
                    return <p key={entry.id} className={`operation ${entry.status ?? ''}`}><strong>{entry.status === 'rejected' ? '×' : '✓'} {actor?.name ?? entry.entityId}</strong>{entry.command.type}{target ? ` → ${target}` : ''}{entry.detail ? ` · ${entry.detail}` : ''}</p>
                  }
                  if (entry.type === 'relationship') {
                    const from = world.entities.find((entity) => entity.id === entry.fromId)?.name ?? entry.fromId
                    const to = world.entities.find((entity) => entity.id === entry.toId)?.name ?? entry.toId
                    return <p key={entry.id} className={`operation ${entry.status ?? ''}`}><strong>{from} → {to}</strong>{entry.before ?? 0} → {entry.after ?? 0} · {entry.reason}</p>
                  }
                  if (entry.type === 'choice') return <button key={entry.id} type="button" className="choice" disabled={isDirectorThinking} onClick={() => {
                    setInput(entry.suggestedInput)
                    window.requestAnimationFrame(() => inputRef.current?.focus())
                  }}>{entry.label}</button>
                  return <p key={entry.id} className="summary">{entry.summary}</p>
                })}
                {turn.status === 'streaming' && <p className="streaming"><Bot size={12} />{locale === 'zh-CN' ? '剧情正在展开……' : 'The story is unfolding…'}</p>}
                {turn.error && <p className="error">{turn.error}</p>}
              </div>
            ))}
            {displayedTurns.length === 0 && <p className="world-story-empty">{locale === 'zh-CN' ? '输入一句话，让角色行动或改变故事走向。' : 'Enter a direction to move the story forward.'}</p>}
          </div>
          {llmConfigured ? (
            <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
              <textarea
                ref={inputRef}
                rows={2}
                maxLength={800}
                value={input}
                disabled={isDirectorThinking}
                placeholder={locale === 'zh-CN' ? '例如：让罗兰先谈判，不要立刻开战。' : 'For example: Have Roland negotiate before fighting.'}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                  event.preventDefault()
                  void submit()
                }}
              />
              {isDirectorThinking
                ? <button type="button" className="stop" onClick={onStopDirector}><Square size={14} />{locale === 'zh-CN' ? '停止' : 'Stop'}</button>
                : <button type="submit" disabled={!input.trim()}><Send size={14} />{locale === 'zh-CN' ? '发送' : 'Send'}</button>}
            </form>
          ) : (
            <p className="world-story-config-hint">{locale === 'zh-CN' ? '配置 LLM 后即可用自然语言控制剧情。' : 'Configure an LLM to direct the story.'}</p>
          )}
        </div>
      )}
      {!collapsed && tab === 'stories' && (
        <div className="world-story-list">
          <div className="world-story-actions">
            <button type="button" onClick={onGenerateStory} disabled={world.entities.length === 0 && world.events.length === 0}><Sparkles size={13} />{locale === 'zh-CN' ? '生成传闻' : 'Generate rumor'}</button>
            <button type="button" onClick={onRunAiTurn} disabled={!llmConfigured || isAiThinking}><Bot size={13} />{isAiThinking ? (locale === 'zh-CN' ? 'AI 思考中' : 'AI thinking') : (locale === 'zh-CN' ? 'AI 推演' : 'AI turn')}</button>
          </div>
          {aiFeedback && <p className={`tavern-ai-feedback ${aiFeedback.tone}`}>{aiFeedback.text}</p>}
          {[...world.narrative.stories].reverse().slice(0, 8).map((story) => (
            <article key={story.id}>
              <strong>{story.title}</strong>
              <p>{story.body}</p>
              <small>{story.source === 'ai' ? 'AI' : (locale === 'zh-CN' ? '本地规则' : 'Local')} · {Math.floor(story.createdAtSeconds / 60)}:{Math.floor(story.createdAtSeconds % 60).toString().padStart(2, '0')}</small>
            </article>
          ))}
          {world.narrative.stories.length === 0 && <p className="world-story-empty">{locale === 'zh-CN' ? '还没有酒馆故事。' : 'No tavern stories yet.'}</p>}
        </div>
      )}
    </section>
  )
}
