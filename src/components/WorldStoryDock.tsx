import { BookOpen, Bot, ChevronDown, Dice5, GlassWater, MessageCircle, Send, Sparkles, Square, X } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { resizeBottomDockHeight } from '../lib/bottomDockResize'
import { useI18n } from '../lib/i18n'
import {
  buildWorldNarrativeFeed,
  type ActiveWorldDirectorTurn,
  type WorldNarrativeFeedBlock,
} from '../lib/worldNarrativeFeed'
import type { TavernDirectorEntry } from '../lib/worldTavernDirector'
import type { TavernActivityKind, TavernActivityResult } from '../lib/worldTavernActivities'
import type { BrickStructure } from '../types/bricks'
import type { WorldDirectorTurn, WorldState } from '../types/world'

type WorldStoryDockProps = {
  world: WorldState
  structures: BrickStructure[]
  llmConfigured: boolean
  isAiThinking: boolean
  isDirectorThinking: boolean
  isAiActivityThinking: boolean
  aiFeedback?: { tone: 'success' | 'error'; text: string }
  onGenerateStory: () => void
  onRunAiTurn: () => void
  onPlayActivity: (activity: TavernActivityKind, focusEntityId?: string) => TavernActivityResult | undefined
  onPlayAiActivity: (activity: TavernActivityKind, focusEntityId?: string) => Promise<TavernActivityResult | undefined>
  onDirectWorld: (
    text: string,
    recentEntries: TavernDirectorEntry[],
    onEntry: (entry: TavernDirectorEntry) => void,
  ) => Promise<void>
  onStopDirector: () => void
  onCommitDirectorTurn: (turn: WorldDirectorTurn) => void
  onClose: () => void
}

const storyActivityOptions: Array<{
  kind: TavernActivityKind
  icon: typeof GlassWater
  zh: string
  en: string
}> = [
  { kind: 'toast', icon: GlassWater, zh: '碰一杯', en: 'Raise a mug' },
  { kind: 'dice', icon: Dice5, zh: '掷骰子', en: 'Roll dice' },
  { kind: 'rumor', icon: MessageCircle, zh: '听传闻', en: 'Hear a rumor' },
]

const minimumStoryPanelHeight = 220
const initialStoryPanelHeight = () => Math.min(520, Math.max(minimumStoryPanelHeight, window.innerHeight - 24))

type NarrativeReference = {
  name: string
  details: string
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const AnnotatedText = ({
  text,
  references,
}: {
  text: string
  references: NarrativeReference[]
}) => {
  if (references.length === 0) return text
  const referenceByName = new Map(references.map((reference) => [reference.name, reference]))
  const pattern = new RegExp(`(${references.map((reference) => escapeRegExp(reference.name)).join('|')})`, 'g')
  return text.split(pattern).map((part, index): ReactNode => {
    const reference = referenceByName.get(part)
    return reference
      ? <span className="narrative-reference" title={reference.details} tabIndex={0} key={`${part}-${index}`}>{part}</span>
      : part
  })
}

const FeedBlock = ({
  block,
  world,
  structures,
  references,
  locale,
  disabled,
  onChoose,
}: {
  block: WorldNarrativeFeedBlock
  world: WorldState
  structures: BrickStructure[]
  references: NarrativeReference[]
  locale: 'zh-CN' | 'en-US'
  disabled: boolean
  onChoose: (input: string) => void
}) => {
  if (block.type === 'narration') return <p className="narration"><AnnotatedText text={block.text} references={references} /></p>
  if (block.type === 'dialogue') {
    const speaker = world.entities.find((entity) => entity.id === block.speakerId)
    const speakerName = speaker?.name ?? block.speakerId
    return <p className="dialogue"><strong><AnnotatedText text={speakerName} references={references} /></strong><span>“<AnnotatedText text={block.text} references={references} />”</span></p>
  }
  if (block.type === 'command') {
    const actor = world.entities.find((entity) => entity.id === block.entityId)
    const targetRef = 'target' in block.command ? block.command.target : undefined
    const target = targetRef
      ? world.entities.find((entity) => entity.id === targetRef.id)?.name
        ?? structures.find((structure) => structure.id === targetRef.id)?.name
        ?? targetRef.id
      : ''
    const commandLabel = block.command.type === 'interact'
      ? (locale === 'zh-CN' ? '交谈' : 'talk')
      : block.command.type
    return <p className={`stage-direction ${block.status ?? ''}`}>〔<AnnotatedText text={actor?.name ?? block.entityId} references={references} /> · {commandLabel}{target ? <> → <AnnotatedText text={target} references={references} /></> : ''}{block.detail ? ` · ${block.detail}` : ''}〕</p>
  }
  if (block.type === 'relationship') {
    const from = world.entities.find((entity) => entity.id === block.fromId)?.name ?? block.fromId
    const to = world.entities.find((entity) => entity.id === block.toId)?.name ?? block.toId
    return <p className={`stage-direction ${block.status ?? ''}`}>〔<AnnotatedText text={from} references={references} />与<AnnotatedText text={to} references={references} />的关系：{block.before ?? 0} → {block.after ?? 0} · <AnnotatedText text={block.reason} references={references} />〕</p>
  }
  if (block.type === 'choice') {
    return <button type="button" className="choice" disabled={disabled} onClick={() => onChoose(block.suggestedInput)}>{block.label}</button>
  }
  return <p className="summary">{block.summary}</p>
}

export const WorldStoryDock = ({
  world,
  structures,
  llmConfigured,
  isAiThinking,
  isDirectorThinking,
  isAiActivityThinking,
  aiFeedback,
  onGenerateStory,
  onRunAiTurn,
  onPlayActivity,
  onPlayAiActivity,
  onDirectWorld,
  onStopDirector,
  onCommitDirectorTurn,
  onClose,
}: WorldStoryDockProps) => {
  const { locale, t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const [showStoryTools, setShowStoryTools] = useState(false)
  const [activityHost, setActivityHost] = useState<'local' | 'ai'>('local')
  const [focusEntityId, setFocusEntityId] = useState(world.entities.find((entity) => entity.health > 0)?.id ?? '')
  const [input, setInput] = useState('')
  const [activeTurn, setActiveTurn] = useState<ActiveWorldDirectorTurn>()
  const [panelHeight, setPanelHeight] = useState(initialStoryPanelHeight)
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const resizeCleanupRef = useRef<() => void>()
  const feedRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const feed = useMemo(() => buildWorldNarrativeFeed(world, activeTurn).slice(-40), [activeTurn, world])
  const protagonist = useMemo(() => (
    world.scenarios
      .flatMap((scenario) => scenario.stages)
      .map((stage) => stage.trigger.actorId)
      .map((actorId) => world.entities.find((entity) => entity.id === actorId && entity.health > 0))
      .find((entity) => Boolean(entity))
      ?? world.entities.find((entity) => entity.controller === 'player' && entity.health > 0)
      ?? world.entities.find((entity) => entity.health > 0)
  ), [world.entities, world.scenarios])
  const references = useMemo(() => {
    const hidden = new Set(world.hiddenTargets.map((target) => `${target.kind}:${target.id}`))
    return [
      ...world.entities
        .filter((entity) => entity.name && !hidden.has(`entity:${entity.id}`))
        .map((entity): NarrativeReference => ({
          name: entity.name,
          details: locale === 'zh-CN'
            ? `${entity.description}\n阵营：${entity.factionId} · 生命：${entity.health}/${entity.maxHealth}`
            : `${entity.description}\nFaction: ${entity.factionId} · Health: ${entity.health}/${entity.maxHealth}`,
        })),
      ...structures
        .filter((structure) => structure.name && !hidden.has(`structure:${structure.id}`))
        .map((structure): NarrativeReference => ({
          name: structure.name,
          details: locale === 'zh-CN'
            ? `${structure.description}\n${structure.brickIds.length} 个零件`
            : `${structure.description}\n${structure.brickIds.length} bricks`,
        })),
    ].sort((a, b) => b.name.length - a.name.length)
  }, [locale, structures, world.entities, world.hiddenTargets])
  const feedVersion = feed.reduce((total, item) => total + item.blocks.length, 0)
  const availableEntities = world.entities.filter((entity) => entity.health > 0 && !world.hiddenTargets.some((target) => target.kind === 'entity' && target.id === entity.id))
  const getResizeViewport = () => {
    const bounds = panelRef.current?.parentElement?.getBoundingClientRect()
    return bounds
      ? { width: bounds.width, height: bounds.height }
      : { width: window.innerWidth, height: window.innerHeight }
  }

  useEffect(() => {
    if (availableEntities.some((entity) => entity.id === focusEntityId)) return
    setFocusEntityId(availableEntities[0]?.id ?? '')
  }, [availableEntities, focusEntityId])

  useEffect(() => {
    const container = feedRef.current
    if (container && shouldAutoScrollRef.current) container.scrollTop = container.scrollHeight
  }, [feed.length, feedVersion])

  useEffect(() => {
    const parent = panelRef.current?.parentElement
    if (!parent) return
    const clampToViewport = () => {
      const bounds = parent.getBoundingClientRect()
      setPanelHeight((current) => Math.min(current, Math.max(0, bounds.height - 24)))
    }
    const observer = new ResizeObserver(clampToViewport)
    observer.observe(parent)
    clampToViewport()
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => resizeCleanupRef.current?.(), [])

  const beginResize = (event: ReactPointerEvent) => {
    event.preventDefault()
    const session = {
      startY: event.clientY,
      initialHeight: panelHeight,
    }
    const handlePointerMove = (event: PointerEvent) => {
      setPanelHeight(resizeBottomDockHeight({
        initialHeight: session.initialHeight,
        deltaY: event.clientY - session.startY,
        viewportHeight: getResizeViewport().height,
        minimumHeight: minimumStoryPanelHeight,
      }))
    }
    const finishResize = () => {
      resizeCleanupRef.current?.()
      resizeCleanupRef.current = undefined
      setIsResizing(false)
    }
    resizeCleanupRef.current?.()
    resizeCleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
    setIsResizing(true)
  }

  const chooseInput = (value: string) => {
    setInput(value)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  const submit = async () => {
    const playerText = input.trim()
    if (!playerText || isDirectorThinking || !llmConfigured) return
    const id = `director-turn-${Date.now().toString(36)}`
    const createdAtSeconds = world.elapsedSeconds
    const entries: TavernDirectorEntry[] = []
    shouldAutoScrollRef.current = true
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
      onCommitDirectorTurn({ id, playerText, entries, createdAtSeconds, status, ...(errorMessage ? { error: errorMessage } : {}) })
      setActiveTurn(undefined)
    }
  }

  const playActivity = async (activity: TavernActivityKind) => {
    shouldAutoScrollRef.current = true
    if (activityHost === 'ai') await onPlayAiActivity(activity, focusEntityId)
    else onPlayActivity(activity, focusEntityId)
  }

  return (
    <section
      ref={panelRef}
      className={`world-story-dock${collapsed ? ' collapsed' : ''}${isResizing ? ' resizing' : ''}`}
      aria-label={locale === 'zh-CN' ? '剧情对话' : 'Story dialogue'}
      style={collapsed ? undefined : { height: panelHeight, maxHeight: 'none' }}
    >
      {!collapsed && (
        <div
          className="world-story-resize-handle top"
          aria-hidden="true"
          onPointerDown={beginResize}
        />
      )}
      <header>
        <div>
          <BookOpen size={14} />
          <strong>{locale === 'zh-CN' ? '剧情对话' : 'Story dialogue'}</strong>
          <small>{locale === 'zh-CN' ? `${feed.length} 段` : `${feed.length} passages`}</small>
        </div>
        <span>
          <button className="icon-button" type="button" aria-label={collapsed ? (locale === 'zh-CN' ? '展开' : 'Expand') : (locale === 'zh-CN' ? '折叠' : 'Collapse')} onClick={() => setCollapsed((current) => !current)}>
            <ChevronDown size={14} />
          </button>
          <button className="icon-button" type="button" aria-label={t('common.close')} onClick={onClose}><X size={14} /></button>
        </span>
      </header>
      {!collapsed && (
        <div className="world-story-director">
          <div
            ref={feedRef}
            className="world-story-feed narrative-feed"
            aria-live="polite"
            onScroll={(event) => {
              const element = event.currentTarget
              shouldAutoScrollRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
            }}
          >
            {protagonist && (
              <aside className="world-story-identity">
                {locale === 'zh-CN' ? '你将扮演 ' : 'You are '}
                <AnnotatedText text={protagonist.name} references={references} />
                {locale === 'zh-CN' ? `。${protagonist.description}` : `. ${protagonist.description}`}
              </aside>
            )}
            {feed.map((item) => (
              <article className={`narrative-passage ${item.kind}`} key={item.id}>
                {item.playerText && <p className="player"><strong>{locale === 'zh-CN' ? `你（${protagonist?.name ?? '玩家'}）` : `You (${protagonist?.name ?? 'Player'})`}</strong><AnnotatedText text={item.playerText} references={references} /></p>}
                {item.blocks.map((block) => (
                  <FeedBlock key={block.id} block={block} world={world} structures={structures} references={references} locale={locale} disabled={isDirectorThinking} onChoose={chooseInput} />
                ))}
                {item.status === 'streaming' && <p className="streaming"><Bot size={12} />{locale === 'zh-CN' ? '场景正在演绎……' : 'The scene is unfolding…'}</p>}
                {item.error && <p className="error">{item.error}</p>}
              </article>
            ))}
            {feed.length === 0 && <p className="world-story-empty">{locale === 'zh-CN' ? '故事还没有开始。输入一句话，或从“剧情灵感”选择一个轻量事件。' : 'The story has not begun. Enter a direction or choose a story prompt.'}</p>}
          </div>

          {showStoryTools && (
            <div className="world-story-tools">
              <div className="world-story-tool-settings">
                <select aria-label={locale === 'zh-CN' ? '剧情主角' : 'Story lead'} value={focusEntityId} onChange={(event) => setFocusEntityId(event.target.value)}>
                  {availableEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
                </select>
                <span className="tavern-host-toggle" role="group" aria-label={locale === 'zh-CN' ? '主持方式' : 'Host mode'}>
                  <button type="button" className={activityHost === 'local' ? 'active' : ''} onClick={() => setActivityHost('local')}>{locale === 'zh-CN' ? '本地' : 'Local'}</button>
                  <button type="button" className={activityHost === 'ai' ? 'active' : ''} disabled={!llmConfigured} onClick={() => setActivityHost('ai')}><Bot size={11} />AI</button>
                </span>
              </div>
              <div className="world-story-tool-actions">
                {storyActivityOptions.map(({ kind, icon: Icon, zh, en }) => (
                  <button type="button" key={kind} disabled={availableEntities.length === 0 || isAiActivityThinking} onClick={() => void playActivity(kind)}><Icon size={13} />{locale === 'zh-CN' ? zh : en}</button>
                ))}
                <button type="button" onClick={onGenerateStory} disabled={world.entities.length === 0 && world.events.length === 0}><Sparkles size={13} />{locale === 'zh-CN' ? '整理传闻' : 'Compose rumor'}</button>
                <button type="button" onClick={onRunAiTurn} disabled={!llmConfigured || isAiThinking}><Bot size={13} />{isAiThinking ? (locale === 'zh-CN' ? '推演中' : 'Thinking') : (locale === 'zh-CN' ? 'AI 推演' : 'AI turn')}</button>
              </div>
              {isAiActivityThinking && <p className="world-story-tool-status"><Bot size={12} />{locale === 'zh-CN' ? 'AI 正在编排这一刻……' : 'AI is staging this moment…'}</p>}
              {aiFeedback && <p className={`tavern-ai-feedback ${aiFeedback.tone}`}>{aiFeedback.text}</p>}
            </div>
          )}

          <div className="world-story-composer">
            <button type="button" className={showStoryTools ? 'active' : ''} aria-expanded={showStoryTools} onClick={() => setShowStoryTools((current) => !current)}>
              <Sparkles size={14} />{locale === 'zh-CN' ? '剧情灵感' : 'Story prompts'}
            </button>
            {llmConfigured ? (
              <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
                <textarea
                  ref={inputRef}
                  rows={2}
                  maxLength={800}
                  value={input}
                  disabled={isDirectorThinking}
                  placeholder={locale === 'zh-CN' ? '让角色行动、交谈，或改变故事走向……' : 'Let characters act, speak, or change the story…'}
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
              <p className="world-story-config-hint">{locale === 'zh-CN' ? '配置 LLM 后可用自然语言推进剧情；剧情灵感仍可使用本地规则。' : 'Configure an LLM for freeform direction; local story prompts remain available.'}</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
