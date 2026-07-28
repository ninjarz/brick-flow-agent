import { BookOpen, Bot, Brain, ChevronDown, Dice5, GlassWater, LockKeyhole, MessageCircle, RefreshCw, Save, Send, Sparkles, Square, X } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { resizeBottomDockHeight, resizeBottomDockWidth } from '../lib/bottomDockResize'
import { useI18n } from '../lib/i18n'
import {
  buildWorldNarrativeFeed,
  type ActiveWorldDirectorTurn,
  type WorldNarrativeFeedBlock,
} from '../lib/worldNarrativeFeed'
import type { TavernDirectorEntry, TavernDirectorStreamPreview } from '../lib/worldTavernDirector'
import type { TavernActivityKind, TavernActivityResult } from '../lib/worldTavernActivities'
import type { BrickStructure } from '../types/bricks'
import type { WorldDirectorTurn, WorldState } from '../types/world'

type WorldStoryDockProps = {
  world: WorldState
  structures: BrickStructure[]
  llmConfigured: boolean
  isLlmTesting: boolean
  isAiThinking: boolean
  isDirectorThinking: boolean
  isDirectorCompacting: boolean
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
    onProgress: (progress: { reasoningDelta?: string; preview?: TavernDirectorStreamPreview }) => void,
  ) => Promise<{
    requestMessage: string
    responseMessage: string
    contextStats?: WorldDirectorTurn['contextStats']
  }>
  onStopDirector: () => void
  onCommitDirectorTurn: (turn: WorldDirectorTurn) => void
  onCompactDirectorMemory: () => Promise<{ compactedTurns: number; triggered: boolean }>
  onUpdateDirectorMemory: (summary: string, lockedFacts: string[]) => void
  onSelectEntity: (entityId: string) => void
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
const minimumStoryPanelWidth = 420
const initialStoryPanelHeight = () => Math.min(520, Math.max(minimumStoryPanelHeight, window.innerHeight - 24))
const initialStoryPanelWidth = () => Math.min(760, Math.max(0, window.innerWidth - 24))

type NarrativeReference = {
  name: string
  details: string
  entityId?: string
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const AnnotatedText = ({
  text,
  references,
  onSelectEntity,
}: {
  text: string
  references: NarrativeReference[]
  onSelectEntity?: (entityId: string) => void
}) => {
  if (references.length === 0) return text
  const referenceByName = new Map(references.map((reference) => [reference.name, reference]))
  const pattern = new RegExp(`(${references.map((reference) => escapeRegExp(reference.name)).join('|')})`, 'g')
  return text.split(pattern).map((part, index): ReactNode => {
    const reference = referenceByName.get(part)
    if (!reference) return part
    return reference.entityId && onSelectEntity
      ? (
          <button
            type="button"
            className="narrative-reference entity"
            title={`${reference.details}\n${localeSelectionHint}`}
            onClick={() => onSelectEntity(reference.entityId!)}
            key={`${part}-${index}`}
          >
            {part}
          </button>
        )
      : <span className="narrative-reference" title={reference.details} tabIndex={0} key={`${part}-${index}`}>{part}</span>
  })
}

const localeSelectionHint = '点击选中角色 / Click to select'

const FeedBlock = ({
  block,
  world,
  structures,
  references,
  locale,
  disabled,
  onChoose,
  onSelectEntity,
}: {
  block: WorldNarrativeFeedBlock
  world: WorldState
  structures: BrickStructure[]
  references: NarrativeReference[]
  locale: 'zh-CN' | 'en-US'
  disabled: boolean
  onChoose: (input: string) => void
  onSelectEntity: (entityId: string) => void
}) => {
  if (block.type === 'narration') return <p className="narration"><AnnotatedText text={block.text} references={references} onSelectEntity={onSelectEntity} /></p>
  if (block.type === 'dialogue') {
    const speaker = world.entities.find((entity) => entity.id === block.speakerId)
    const speakerName = speaker?.name ?? block.speakerId
    const waitingForProximity = 'detail' in block && block.detail === 'WAITING_FOR_PROXIMITY'
    return <p className={`dialogue${waitingForProximity ? ' queued' : ''}`}><strong><AnnotatedText text={speakerName} references={references} onSelectEntity={onSelectEntity} /></strong><span>{waitingForProximity && <em>{locale === 'zh-CN' ? '接近后' : 'on arrival'}</em>}“<AnnotatedText text={block.text} references={references} onSelectEntity={onSelectEntity} />”</span></p>
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
    return <p className={`stage-direction ${block.status ?? ''}`}>〔<AnnotatedText text={actor?.name ?? block.entityId} references={references} onSelectEntity={onSelectEntity} /> · {commandLabel}{target ? <> → <AnnotatedText text={target} references={references} onSelectEntity={onSelectEntity} /></> : ''}{block.detail ? ` · ${block.detail}` : ''}〕</p>
  }
  if (block.type === 'relationship') {
    const from = world.entities.find((entity) => entity.id === block.fromId)?.name ?? block.fromId
    const to = world.entities.find((entity) => entity.id === block.toId)?.name ?? block.toId
    return <p className={`stage-direction ${block.status ?? ''}`}>〔<AnnotatedText text={from} references={references} onSelectEntity={onSelectEntity} />与<AnnotatedText text={to} references={references} onSelectEntity={onSelectEntity} />的关系：{block.before ?? 0} → {block.after ?? 0} · <AnnotatedText text={block.reason} references={references} onSelectEntity={onSelectEntity} />〕</p>
  }
  if (block.type === 'choice') {
    return <button type="button" className="choice" disabled={disabled} onClick={() => onChoose(block.suggestedInput)}>{block.label}</button>
  }
  return <p className="summary">{block.summary}</p>
}

const ReasoningPanel = ({
  text,
  streaming,
  locale,
}: {
  text: string
  streaming: boolean
  locale: 'zh-CN' | 'en-US'
}) => {
  const [open, setOpen] = useState(streaming)
  useEffect(() => setOpen(streaming), [streaming])
  return (
    <details
      className="world-story-reasoning"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <Bot size={12} />
        {streaming
          ? (locale === 'zh-CN' ? '正在思考……' : 'Thinking…')
          : (locale === 'zh-CN' ? '思考过程' : 'Reasoning')}
      </summary>
      <div>{text}</div>
    </details>
  )
}

export const WorldStoryDock = ({
  world,
  structures,
  llmConfigured,
  isLlmTesting,
  isAiThinking,
  isDirectorThinking,
  isDirectorCompacting,
  isAiActivityThinking,
  aiFeedback,
  onGenerateStory,
  onRunAiTurn,
  onPlayActivity,
  onPlayAiActivity,
  onDirectWorld,
  onStopDirector,
  onCommitDirectorTurn,
  onCompactDirectorMemory,
  onUpdateDirectorMemory,
  onSelectEntity,
  onClose,
}: WorldStoryDockProps) => {
  const { locale, t } = useI18n()
  const [collapsed, setCollapsed] = useState(false)
  const [showStoryTools, setShowStoryTools] = useState(false)
  const [activityHost, setActivityHost] = useState<'local' | 'ai'>('local')
  const [focusEntityId, setFocusEntityId] = useState(world.entities.find((entity) => entity.health > 0)?.id ?? '')
  const [input, setInput] = useState('')
  const [activeTurn, setActiveTurn] = useState<ActiveWorldDirectorTurn>()
  const [showDirectorMemory, setShowDirectorMemory] = useState(false)
  const [memorySummaryDraft, setMemorySummaryDraft] = useState('')
  const [lockedFactsDraft, setLockedFactsDraft] = useState('')
  const [memoryFeedback, setMemoryFeedback] = useState('')
  const [panelHeight, setPanelHeight] = useState(initialStoryPanelHeight)
  const [panelWidth, setPanelWidth] = useState(initialStoryPanelWidth)
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
          entityId: entity.id,
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
  const latestContextStats = useMemo(() => (
    [...world.narrative.directorTurns].reverse().find((turn) => turn.contextStats)?.contextStats
  ), [world.narrative.directorTurns])
  const displayedInputTokens = latestContextStats?.inputTokens ?? latestContextStats?.estimatedInputTokens
  const cachedPercent = latestContextStats?.cachedTokens !== undefined && latestContextStats.inputTokens
    ? Math.round(latestContextStats.cachedTokens / latestContextStats.inputTokens * 100)
    : undefined
  const activeRawTurnCount = Math.max(
    0,
    world.narrative.directorTurns.length - (world.narrative.directorMemory?.sourceTurnCount ?? 0),
  )
  const feedVersion = feed.reduce((total, item) => total + item.blocks.length, 0)
  const streamVersion = activeTurn
    ? (activeTurn.reasoning?.length ?? 0) + (activeTurn.streamPreview?.text.length ?? 0)
    : 0
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
  }, [feed.length, feedVersion, streamVersion])

  useEffect(() => {
    const parent = panelRef.current?.parentElement
    if (!parent) return
    const clampToViewport = () => {
      const bounds = parent.getBoundingClientRect()
      setPanelHeight((current) => Math.min(current, Math.max(0, bounds.height - 24)))
      setPanelWidth((current) => Math.min(current, Math.max(0, bounds.width - 24)))
    }
    const observer = new ResizeObserver(clampToViewport)
    observer.observe(parent)
    clampToViewport()
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => resizeCleanupRef.current?.(), [])

  const beginHeightResize = (event: ReactPointerEvent) => {
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

  const beginWidthResize = (side: 'left' | 'right') => (event: ReactPointerEvent) => {
    event.preventDefault()
    const session = {
      startX: event.clientX,
      initialWidth: panelWidth,
    }
    const handlePointerMove = (event: PointerEvent) => {
      setPanelWidth(resizeBottomDockWidth({
        initialWidth: session.initialWidth,
        deltaX: event.clientX - session.startX,
        side,
        viewportWidth: getResizeViewport().width,
        minimumWidth: minimumStoryPanelWidth,
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

  const toggleDirectorMemory = () => {
    setShowDirectorMemory((current) => {
      if (!current) {
        setMemorySummaryDraft(world.narrative.directorMemory?.summary ?? '')
        setLockedFactsDraft((world.narrative.directorMemory?.lockedFacts ?? []).join('\n'))
        setMemoryFeedback('')
      }
      return !current
    })
  }

  const saveDirectorMemory = () => {
    onUpdateDirectorMemory(memorySummaryDraft, lockedFactsDraft.split(/\r?\n/))
    setMemoryFeedback(locale === 'zh-CN' ? '剧情记忆已保存。' : 'Story memory saved.')
  }

  const compactDirectorMemory = async () => {
    setMemoryFeedback('')
    const result = await onCompactDirectorMemory()
    setMemoryFeedback(result.compactedTurns > 0
      ? (locale === 'zh-CN' ? `已将 ${result.compactedTurns} 轮剧情并入摘要。` : `Compacted ${result.compactedTurns} story turns.`)
      : (locale === 'zh-CN' ? '最近原文不足 5 轮，暂时无需压缩。' : 'Fewer than five raw turns; nothing to compact.'))
  }

  const submit = async () => {
    const playerText = input.trim()
    if (!playerText || isDirectorThinking || isLlmTesting || !llmConfigured) return
    const id = `director-turn-${Date.now().toString(36)}`
    const createdAtSeconds = world.elapsedSeconds
    const entries: TavernDirectorEntry[] = []
    let reasoning = ''
    let streamPreview: TavernDirectorStreamPreview | undefined
    let requestMessage = ''
    let responseMessage = ''
    let contextStats: WorldDirectorTurn['contextStats']
    let progressFrame = 0
    const flushProgress = () => {
      progressFrame = 0
      setActiveTurn((current) => current?.id === id
        ? {
            ...current,
            ...(reasoning ? { reasoning } : {}),
            ...(streamPreview ? { streamPreview } : { streamPreview: undefined }),
          }
        : current)
    }
    const scheduleProgress = () => {
      if (progressFrame) return
      progressFrame = window.requestAnimationFrame(flushProgress)
    }
    shouldAutoScrollRef.current = true
    setInput('')
    setActiveTurn({ id, playerText, entries: [], createdAtSeconds, status: 'streaming' })
    let status: WorldDirectorTurn['status'] = 'completed'
    let errorMessage: string | undefined
    try {
      const result = await onDirectWorld(
        playerText,
        world.narrative.directorTurns.flatMap((turn) => turn.entries).slice(-12),
        (entry) => {
          entries.push(entry)
          setActiveTurn((current) => current?.id === id ? { ...current, entries: [...entries] } : current)
        },
        (progress) => {
          if (progress.reasoningDelta) reasoning += progress.reasoningDelta
          if ('preview' in progress) streamPreview = progress.preview
          scheduleProgress()
        },
      )
      requestMessage = result.requestMessage
      responseMessage = result.responseMessage
      contextStats = result.contextStats
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : (locale === 'zh-CN' ? '导演请求失败' : 'Director request failed')
      status = /取消|canceled/i.test(errorMessage) ? 'stopped' : 'failed'
    } finally {
      if (progressFrame) window.cancelAnimationFrame(progressFrame)
      onCommitDirectorTurn({
        id,
        playerText,
        entries,
        ...(reasoning.trim() ? { reasoning: reasoning.trim() } : {}),
        ...(requestMessage ? { requestMessage } : {}),
        ...(responseMessage ? { responseMessage } : {}),
        ...(contextStats ? { contextStats } : {}),
        createdAtSeconds,
        status,
        ...(errorMessage ? { error: errorMessage } : {}),
      })
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
      style={collapsed ? undefined : { width: panelWidth, height: panelHeight, maxWidth: 'none', maxHeight: 'none' }}
    >
      {!collapsed && (
        <div
          className="world-story-resize-handle top"
          aria-hidden="true"
          onPointerDown={beginHeightResize}
        />
      )}
      {!collapsed && (
        <>
          <div
            className="world-story-resize-handle left"
            aria-hidden="true"
            onPointerDown={beginWidthResize('left')}
          />
          <div
            className="world-story-resize-handle right"
            aria-hidden="true"
            onPointerDown={beginWidthResize('right')}
          />
        </>
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
                <AnnotatedText text={protagonist.name} references={references} onSelectEntity={onSelectEntity} />
                {locale === 'zh-CN' ? `。${protagonist.description}` : `. ${protagonist.description}`}
              </aside>
            )}
            <aside
              className="world-story-context-status"
              aria-label={locale === 'zh-CN' ? '剧情上下文状态' : 'Story context status'}
              title={world.narrative.directorMemory?.summary}
            >
                {displayedInputTokens !== undefined && (
                  <span>{latestContextStats?.inputTokens === undefined ? '~' : ''}{displayedInputTokens.toLocaleString(locale)} tok</span>
                )}
                {latestContextStats?.cachedTokens !== undefined && (
                  <span className={latestContextStats.cachedTokens > 0 ? 'cache-hit' : ''}>
                    {locale === 'zh-CN' ? '缓存' : 'Cache'} {latestContextStats.cachedTokens.toLocaleString(locale)}
                    {cachedPercent !== undefined ? ` · ${cachedPercent}%` : ''}
                  </span>
                )}
                {latestContextStats && (
                  <span>{locale === 'zh-CN' ? '消息' : 'Messages'} {latestContextStats.messageCount}</span>
                )}
                <span>{locale === 'zh-CN' ? '原文' : 'Raw'} {latestContextStats?.rawTurnCount ?? world.narrative.directorTurns.length}</span>
                {(latestContextStats?.memoryTurnCount || world.narrative.directorMemory?.sourceTurnCount) ? (
                  <span>{locale === 'zh-CN' ? '摘要' : 'Memory'} {latestContextStats?.memoryTurnCount ?? world.narrative.directorMemory?.sourceTurnCount}</span>
                ) : null}
                {latestContextStats?.compactionTriggered && (
                  <strong>{locale === 'zh-CN' ? '本轮已压缩' : 'Compacted this turn'}</strong>
                )}
                <button type="button" onClick={toggleDirectorMemory} aria-expanded={showDirectorMemory}>
                  <Brain size={10} />
                  {locale === 'zh-CN' ? '剧情记忆' : 'Story memory'}
                </button>
            </aside>
            {showDirectorMemory && (
              <section className="world-story-memory-editor" aria-label={locale === 'zh-CN' ? '编辑剧情记忆' : 'Edit story memory'}>
                <header>
                  <div>
                    <Brain size={13} />
                    <strong>{locale === 'zh-CN' ? '剧情记忆' : 'Story memory'}</strong>
                  </div>
                  <small>
                    {locale === 'zh-CN'
                      ? `摘要覆盖 ${world.narrative.directorMemory?.sourceTurnCount ?? 0} 轮 · 最近原文 ${activeRawTurnCount} 轮`
                      : `${world.narrative.directorMemory?.sourceTurnCount ?? 0} summarized · ${activeRawTurnCount} raw`}
                  </small>
                </header>
                <label>
                  <span>{locale === 'zh-CN' ? '长期摘要' : 'Long-term summary'}</span>
                  <textarea
                    rows={5}
                    maxLength={4_000}
                    value={memorySummaryDraft}
                    placeholder={locale === 'zh-CN' ? '压缩后保留的剧情事实、关系与未解决线索……' : 'Compacted facts, relationships, and unresolved clues…'}
                    onChange={(event) => setMemorySummaryDraft(event.target.value)}
                  />
                </label>
                <label>
                  <span><LockKeyhole size={11} />{locale === 'zh-CN' ? '锁定事实（每行一条）' : 'Locked facts (one per line)'}</span>
                  <textarea
                    rows={3}
                    maxLength={9_000}
                    value={lockedFactsDraft}
                    placeholder={locale === 'zh-CN' ? '例如：罗兰是玩家角色\n黑岩使者尚未透露采石场入口' : 'Example: Roland is the player character'}
                    onChange={(event) => setLockedFactsDraft(event.target.value)}
                  />
                </label>
                <div className="world-story-memory-actions">
                  <button type="button" onClick={saveDirectorMemory}><Save size={12} />{locale === 'zh-CN' ? '保存记忆' : 'Save memory'}</button>
                  <button
                    type="button"
                    disabled={activeRawTurnCount <= 4 || isDirectorThinking || isDirectorCompacting}
                    onClick={() => void compactDirectorMemory()}
                  >
                    <RefreshCw size={12} className={isDirectorCompacting ? 'spinning' : ''} />
                    {isDirectorCompacting
                      ? (locale === 'zh-CN' ? '压缩中' : 'Compacting')
                      : (locale === 'zh-CN' ? '手动压缩' : 'Compact now')}
                  </button>
                  {memoryFeedback && <span role="status">{memoryFeedback}</span>}
                </div>
              </section>
            )}
            {feed.map((item) => (
              <article className={`narrative-passage ${item.kind}`} key={item.id}>
                {item.playerText && <p className="player"><strong>{locale === 'zh-CN' ? `你（${protagonist?.name ?? '玩家'}）` : `You (${protagonist?.name ?? 'Player'})`}</strong><AnnotatedText text={item.playerText} references={references} onSelectEntity={onSelectEntity} /></p>}
                {item.reasoning && (
                  <ReasoningPanel text={item.reasoning} streaming={item.status === 'streaming'} locale={locale} />
                )}
                {item.blocks.map((block) => (
                  <FeedBlock key={block.id} block={block} world={world} structures={structures} references={references} locale={locale} disabled={isDirectorThinking} onChoose={chooseInput} onSelectEntity={onSelectEntity} />
                ))}
                {item.streamPreview && (
                  <p className={`world-story-stream-preview ${item.streamPreview.type}`}>
                    {item.streamPreview.type === 'dialogue' && item.streamPreview.speakerId && (
                      <strong>{world.entities.find((entity) => entity.id === item.streamPreview?.speakerId)?.name ?? item.streamPreview.speakerId}</strong>
                    )}
                    <span>{item.streamPreview.text}</span><i aria-hidden="true" />
                  </p>
                )}
                {item.status === 'streaming' && (
                  <p className="streaming">
                    <Bot size={12} />
                    {isLlmTesting
                      ? (locale === 'zh-CN' ? '首次使用，正在测试 LLM 连接……' : 'First use: testing the LLM connection…')
                      : (locale === 'zh-CN' ? '场景正在演绎……' : 'The scene is unfolding…')}
                  </p>
                )}
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
                  disabled={isDirectorThinking || isLlmTesting}
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
                  : <button type="submit" disabled={!input.trim() || isLlmTesting}><Send size={14} />{isLlmTesting
                      ? (locale === 'zh-CN' ? '测试中' : 'Testing')
                      : (locale === 'zh-CN' ? '发送' : 'Send')}</button>}
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
