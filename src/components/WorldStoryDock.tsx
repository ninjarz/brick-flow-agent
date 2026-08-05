import { BookOpen, Bot, Bug, ChevronDown, Database, Dice5, GlassWater, MessageCircle, RefreshCw, Send, Sparkles, Square, TrendingUp, X } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { resizeBottomDockHeight, resizeBottomDockWidth } from '../lib/bottomDockResize'
import { isDebugModeEnabled } from '../lib/debugMode'
import { useI18n } from '../lib/i18n'
import {
  buildContinuousDirectorIntent,
  continuousDirectorPollIntervalMs,
  getContinuousDirectorBackoffMs,
  getContinuousDirectorCadenceMs,
  shouldRunContinuousDirectorPulse,
} from '../lib/worldContinuousDirector'
import { createWorldDirectorCheckpoint } from '../lib/worldDirectorReplay'
import {
  buildWorldNarrativeFeed,
  upsertWorldDirectorEntry,
  type ActiveWorldDirectorTurn,
  type WorldNarrativeFeedBlock,
  type WorldNarrativeFeedItem,
} from '../lib/worldNarrativeFeed'
import { inspectWorldScenarioRuntime } from '../lib/worldScenarioDiagnostics'
import { deriveWorldReflections, rankWorldCognitionCandidates, retrieveWorldClues, retrieveWorldMemories } from '../lib/worldCognition'
import { buildWorldCognitionTraceEntry, createWorldCognitionTraceStore, type WorldCognitionTraceEntry } from '../lib/worldCognitionTrace'
import type { TavernDirectorEntry, TavernDirectorStreamPreview } from '../lib/worldTavernDirector'
import type { TavernActivityKind, TavernActivityResult } from '../lib/worldTavernActivities'
import type { BrickStructure } from '../types/bricks'
import type { WorldDirectorTurn, WorldState } from '../types/world'

type WorldStoryDockProps = {
  world: WorldState
  structures: BrickStructure[]
  llmConfigured: boolean
  isLlmTesting: boolean
  isDirectorThinking: boolean
  continuousAiDirectorEnabled: boolean
  isAiActivityThinking: boolean
  onGenerateStory: () => void
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
    validationIssues?: WorldDirectorTurn['validationIssues']
  }>
  onSetContinuousAiDirectorEnabled: (enabled: boolean) => void
  onStopDirector: () => void
  onCommitDirectorTurn: (turn: WorldDirectorTurn) => void
  onReplayDirectorTurn: (turn: WorldDirectorTurn) => Promise<void>
  onReplayDirectorEntry: (turn: WorldDirectorTurn, entryId: string) => Promise<void>
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
    const detail = 'detail' in block ? block.detail : undefined
    const playbackBadge = detail === 'WAITING_FOR_PROXIMITY'
      ? (locale === 'zh-CN' ? '正在接近' : 'approaching')
      : detail === 'PLAYING'
        ? (locale === 'zh-CN' ? '正在说' : 'speaking')
        : detail === 'BLOCKED_BY_PREVIOUS_EVENT'
          ? (locale === 'zh-CN' ? '前序动作失败，未播放' : 'skipped after a failed action')
        : detail === 'PLAYBACK_MISSED'
          ? (locale === 'zh-CN' ? '未能说出' : 'not played')
          : detail === 'PLAYBACK_TIMEOUT'
            ? (locale === 'zh-CN' ? '演绎超时' : 'timed out')
            : detail === 'PLAYBACK_PAUSED'
              ? (locale === 'zh-CN' ? '已暂停' : 'paused')
              : detail === 'PLAYBACK_STOPPED'
                ? (locale === 'zh-CN' ? '已停止' : 'stopped')
                : undefined
    const playbackClass = detail === 'WAITING_FOR_PROXIMITY'
      ? ' queued'
      : detail === 'PLAYING'
        ? ' playing'
        : detail?.startsWith('PLAYBACK_') || detail === 'BLOCKED_BY_PREVIOUS_EVENT'
          ? ' interrupted'
          : ''
    return <p className={`dialogue${playbackClass}${'status' in block && block.status === 'rejected' ? ' rejected' : ''}`}><strong><AnnotatedText text={speakerName} references={references} onSelectEntity={onSelectEntity} /></strong><span>{playbackBadge && <em>{playbackBadge}</em>}“<AnnotatedText text={block.text} references={references} onSelectEntity={onSelectEntity} />”</span></p>
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
    const detailLabel = block.detail === 'PLAYING'
      ? (locale === 'zh-CN' ? '执行中' : 'acting')
      : block.detail === 'PLAYED'
        ? (locale === 'zh-CN' ? '已完成' : 'completed')
        : block.detail === 'PLAYBACK_TIMEOUT'
          ? (locale === 'zh-CN' ? '执行超时' : 'timed out')
          : block.detail === 'PLAYBACK_PAUSED'
            ? (locale === 'zh-CN' ? '已暂停' : 'paused')
            : block.detail === 'PLAYBACK_STOPPED'
              ? (locale === 'zh-CN' ? '已停止' : 'stopped')
              : block.detail === 'BLOCKED_BY_PREVIOUS_EVENT'
                ? (locale === 'zh-CN' ? '前序动作失败，已跳过' : 'skipped after a failed action')
                : block.detail
    return <p className={`stage-direction ${block.status ?? ''}`}>〔<AnnotatedText text={actor?.name ?? block.entityId} references={references} onSelectEntity={onSelectEntity} /> · {commandLabel}{target ? <> → <AnnotatedText text={target} references={references} onSelectEntity={onSelectEntity} /></> : ''}{detailLabel ? ` · ${detailLabel}` : ''}〕</p>
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

const DirectorDebugPanel = ({
  item,
  locale,
}: {
  item: WorldNarrativeFeedItem
  locale: 'zh-CN' | 'en-US'
}) => (
  <details className="world-story-debug-turn">
    <summary>
      <Bug size={11} />
      {locale === 'zh-CN' ? 'LLM 编排' : 'LLM orchestration'}
      <span>{item.blocks.length} events · {item.status ?? 'completed'}</span>
    </summary>
    {item.contextStats && (
      <dl>
        <div><dt>{locale === 'zh-CN' ? '消息' : 'Messages'}</dt><dd>{item.contextStats.messageCount}</dd></div>
        <div><dt>{locale === 'zh-CN' ? '输入' : 'Input'}</dt><dd>{(item.contextStats.inputTokens ?? item.contextStats.estimatedInputTokens).toLocaleString(locale)} tok</dd></div>
        <div><dt>{locale === 'zh-CN' ? '输出' : 'Output'}</dt><dd>{item.contextStats.outputTokens?.toLocaleString(locale) ?? '—'} tok</dd></div>
        <div><dt>{locale === 'zh-CN' ? '缓存' : 'Cached'}</dt><dd>{item.contextStats.cachedTokens?.toLocaleString(locale) ?? '—'} tok</dd></div>
        <div><dt>{locale === 'zh-CN' ? '预算' : 'Budget'}</dt><dd>{item.contextStats.maxOutputTokens?.toLocaleString(locale) ?? '—'} tok</dd></div>
        <div><dt>{locale === 'zh-CN' ? '空响应重试' : 'Empty retries'}</dt><dd>{item.contextStats.responseRetryCount ?? 0}</dd></div>
        {item.contextStats.finishReason && <div><dt>{locale === 'zh-CN' ? '结束原因' : 'Finish'}</dt><dd>{item.contextStats.finishReason}</dd></div>}
      </dl>
    )}
    <section>
      <strong>{locale === 'zh-CN' ? '结构化事件' : 'Structured events'}</strong>
      <pre>{JSON.stringify(item.blocks, null, 2)}</pre>
    </section>
    {(item.validationIssues?.length ?? 0) > 0 && (
      <section>
        <strong>{locale === 'zh-CN' ? '协议拒绝记录' : 'Protocol rejections'}</strong>
        <pre>{JSON.stringify(item.validationIssues, null, 2)}</pre>
      </section>
    )}
    {item.requestMessage && (
      <section>
        <strong>{locale === 'zh-CN' ? '发送给 LLM' : 'Request to LLM'}</strong>
        <pre>{item.requestMessage}</pre>
      </section>
    )}
    {item.responseMessage && (
      <section>
        <strong>{locale === 'zh-CN' ? 'LLM 原始响应' : 'Raw LLM response'}</strong>
        <pre>{item.responseMessage}</pre>
      </section>
    )}
  </details>
)

export const WorldStoryDock = ({
  world,
  structures,
  llmConfigured,
  isLlmTesting,
  isDirectorThinking,
  continuousAiDirectorEnabled,
  isAiActivityThinking,
  onGenerateStory,
  onPlayActivity,
  onPlayAiActivity,
  onDirectWorld,
  onSetContinuousAiDirectorEnabled,
  onStopDirector,
  onCommitDirectorTurn,
  onReplayDirectorTurn,
  onReplayDirectorEntry,
  onSelectEntity,
  onClose,
}: WorldStoryDockProps) => {
  const { locale, t } = useI18n()
  const debugMode = isDebugModeEnabled(window.location.search)
  const [collapsed, setCollapsed] = useState(false)
  const [showStoryTools, setShowStoryTools] = useState(false)
  const [activityHost, setActivityHost] = useState<'local' | 'ai'>('local')
  const [focusEntityId, setFocusEntityId] = useState(world.entities.find((entity) => entity.health > 0)?.id ?? '')
  const [input, setInput] = useState('')
  const [activeTurn, setActiveTurn] = useState<ActiveWorldDirectorTurn>()
  const [panelHeight, setPanelHeight] = useState(initialStoryPanelHeight)
  const [panelWidth, setPanelWidth] = useState(initialStoryPanelWidth)
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const resizeCleanupRef = useRef<() => void>()
  const feedRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const continuousPulseInFlightRef = useRef(false)
  const continuousNextAllowedAtRef = useRef(performance.now())
  const continuousFailureCountRef = useRef(0)
  const cognitionTraceRef = useRef(createWorldCognitionTraceStore())
  const [cognitionTrace, setCognitionTrace] = useState<WorldCognitionTraceEntry[]>([])
  const mountedRef = useRef(true)
  const continuousRuntimeRef = useRef({
    world,
    llmConfigured,
    isLlmTesting,
    isDirectorThinking,
    continuousAiDirectorEnabled,
    input,
    onDirectWorld,
    onCommitDirectorTurn,
  })
  continuousRuntimeRef.current = {
    world,
    llmConfigured,
    isLlmTesting,
    isDirectorThinking,
    continuousAiDirectorEnabled,
    input,
    onDirectWorld,
    onCommitDirectorTurn,
  }
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
  const scenarioRuntimeIssues = useMemo(() => inspectWorldScenarioRuntime(world), [world])
  const displayedInputTokens = latestContextStats?.inputTokens ?? latestContextStats?.estimatedInputTokens
  const isScenarioDialoguePlaying = world.scenarios.some((scenario) => Boolean(scenario.activeDialogue || scenario.pendingAi))
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

  const submit = async (retryTurn?: WorldDirectorTurn) => {
    const playerText = (retryTurn?.playerText ?? input).trim()
    if (!playerText || isDirectorThinking || isScenarioDialoguePlaying || isLlmTesting || !llmConfigured) return
    const id = retryTurn?.id ?? `director-turn-${Date.now().toString(36)}`
    const createdAtSeconds = retryTurn?.createdAtSeconds ?? world.elapsedSeconds
    const checkpoint = createWorldDirectorCheckpoint(world)
    const entries: TavernDirectorEntry[] = []
    let reasoning = ''
    let streamPreview: TavernDirectorStreamPreview | undefined
    let requestMessage = ''
    let responseMessage = ''
    let contextStats: WorldDirectorTurn['contextStats']
    let validationIssues: WorldDirectorTurn['validationIssues']
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
    if (!retryTurn) setInput('')
    setActiveTurn({ id, playerText, entries: [], createdAtSeconds, status: 'streaming' })
    let status: WorldDirectorTurn['status'] = 'completed'
    let errorMessage: string | undefined
    try {
      const result = await onDirectWorld(
        playerText,
        world.narrative.directorTurns.flatMap((turn) => turn.entries).slice(-12),
        (entry) => {
          entries.splice(0, entries.length, ...upsertWorldDirectorEntry(entries, entry))
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
      validationIssues = result.validationIssues
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
        ...(validationIssues?.length ? { validationIssues } : {}),
        ...(contextStats ? { contextStats } : {}),
        createdAtSeconds,
        status,
        checkpoint,
        ...(errorMessage ? { error: errorMessage } : {}),
      })
      setActiveTurn(undefined)
    }
  }

  useEffect(() => {
    if (continuousAiDirectorEnabled) {
      continuousFailureCountRef.current = 0
      continuousNextAllowedAtRef.current = performance.now()
      return
    }
    if (continuousPulseInFlightRef.current) onStopDirector()
  }, [continuousAiDirectorEnabled, onStopDirector])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (continuousPulseInFlightRef.current) onStopDirector()
    }
  }, [onStopDirector])

  useEffect(() => {
    const runPulse = async () => {
      const runtime = continuousRuntimeRef.current
      const scenarioPerformanceActive = runtime.world.scenarios.some((scenario) => Boolean(
        scenario.activeDialogue || scenario.activeTimeline || scenario.pendingAi,
      ))
      if (
        continuousPulseInFlightRef.current
        || !shouldRunContinuousDirectorPulse({
          enabled: runtime.continuousAiDirectorEnabled,
          llmConfigured: runtime.llmConfigured,
          worldPaused: runtime.world.paused,
          directorThinking: runtime.isDirectorThinking,
          llmTesting: runtime.isLlmTesting,
          scenarioPerformanceActive,
          inputInProgress: Boolean(runtime.input.trim()) || document.activeElement === inputRef.current,
          now: performance.now(),
          nextAllowedAt: continuousNextAllowedAtRef.current,
        })
      ) return

      continuousPulseInFlightRef.current = true
      const playerText = buildContinuousDirectorIntent(locale, runtime.world.elapsedSeconds)
      const id = `director-auto-${Date.now().toString(36)}`
      const createdAtSeconds = runtime.world.elapsedSeconds
      const checkpoint = createWorldDirectorCheckpoint(runtime.world)
      const entries: TavernDirectorEntry[] = []
      let reasoning = ''
      let streamPreview: TavernDirectorStreamPreview | undefined
      let requestMessage = ''
      let responseMessage = ''
      let contextStats: WorldDirectorTurn['contextStats']
      let validationIssues: WorldDirectorTurn['validationIssues']
      let status: WorldDirectorTurn['status'] = 'completed'
      let errorMessage: string | undefined
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
      setActiveTurn({
        id,
        playerText,
        origin: 'autonomous',
        entries: [],
        createdAtSeconds,
        status: 'streaming',
      })
      try {
        const result = await runtime.onDirectWorld(
          playerText,
          runtime.world.narrative.directorTurns.flatMap((turn) => turn.entries).slice(-12),
          (entry) => {
            entries.splice(0, entries.length, ...upsertWorldDirectorEntry(entries, entry))
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
        validationIssues = result.validationIssues
        continuousFailureCountRef.current = 0
      } catch (error) {
        errorMessage = error instanceof Error
          ? error.message
          : (locale === 'zh-CN' ? '持续世界导演请求失败' : 'Continuous world director request failed')
        status = /取消|canceled/i.test(errorMessage) ? 'stopped' : 'failed'
        if (status === 'failed') continuousFailureCountRef.current += 1
      } finally {
        if (progressFrame) window.cancelAnimationFrame(progressFrame)
        runtime.onCommitDirectorTurn({
          id,
          playerText,
          origin: 'autonomous',
          entries,
          ...(reasoning.trim() ? { reasoning: reasoning.trim() } : {}),
          ...(requestMessage ? { requestMessage } : {}),
          ...(responseMessage ? { responseMessage } : {}),
          ...(validationIssues?.length ? { validationIssues } : {}),
          ...(contextStats ? { contextStats } : {}),
          createdAtSeconds,
          status,
          checkpoint,
          ...(errorMessage ? { error: errorMessage } : {}),
        })
        if (mountedRef.current) setActiveTurn(undefined)
        continuousPulseInFlightRef.current = false
        const nextDelayMs = status === 'failed'
          ? getContinuousDirectorBackoffMs(continuousFailureCountRef.current)
          : getContinuousDirectorCadenceMs(continuousRuntimeRef.current.world)
        continuousNextAllowedAtRef.current = performance.now() + nextDelayMs
        if (debugMode) {
          cognitionTraceRef.current.record(buildWorldCognitionTraceEntry(
            continuousRuntimeRef.current.world,
            4,
            status === 'failed' ? undefined : nextDelayMs,
          ))
          if (mountedRef.current) setCognitionTrace(cognitionTraceRef.current.entries().reverse())
        }
      }
    }
    const intervalId = window.setInterval(() => {
      void runPulse()
    }, continuousDirectorPollIntervalMs)
    void runPulse()
    return () => {
      window.clearInterval(intervalId)
    }
  }, [locale, debugMode])

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
          {debugMode && <em className="world-story-debug-badge"><Bug size={10} />DEBUG</em>}
        </div>
        <span>
          <button
            className={`world-story-auto-director${continuousAiDirectorEnabled ? ' active' : ''}`}
            type="button"
            aria-pressed={continuousAiDirectorEnabled}
            disabled={!llmConfigured}
            title={locale === 'zh-CN'
              ? '继续世界时，由 LLM 持续编排所有角色的自主行为'
              : 'Let the LLM continuously direct autonomous character behavior while the world runs'}
            onClick={() => onSetContinuousAiDirectorEnabled(!continuousAiDirectorEnabled)}
          >
            <Bot size={12} />
            <b>{locale === 'zh-CN' ? 'AI 导演' : 'AI director'}</b>
            <i>
              {continuousAiDirectorEnabled
                ? (world.paused
                    ? (locale === 'zh-CN' ? '等待世界' : 'Waiting')
                    : (isDirectorThinking
                        ? (locale === 'zh-CN' ? '编排中' : 'Directing')
                        : (locale === 'zh-CN' ? '运行中' : 'Running')))
                : (locale === 'zh-CN' ? '关闭' : 'Off')}
            </i>
          </button>
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
            {debugMode && (
              <aside className="world-story-debug-context" aria-label={locale === 'zh-CN' ? 'LLM 调试上下文' : 'LLM debug context'}>
                <div className="world-story-debug-stats">
                  <span>{displayedInputTokens === undefined ? '—' : displayedInputTokens.toLocaleString(locale)} tok</span>
                  <span>{locale === 'zh-CN' ? '消息' : 'Messages'} {latestContextStats?.messageCount ?? '—'}</span>
                  <span>{locale === 'zh-CN' ? '原文轮次' : 'Raw turns'} {latestContextStats?.rawTurnCount ?? world.narrative.directorTurns.length}</span>
                  <span>{locale === 'zh-CN' ? '已压缩' : 'Compacted'} {world.narrative.directorMemory?.sourceTurnCount ?? 0}</span>
                </div>
                <details className="world-story-debug-memory">
                  <summary><Database size={11} />{locale === 'zh-CN' ? '剧情记忆' : 'Story memory'}</summary>
                  {world.narrative.directorMemory ? (
                    <>
                      <p>{world.narrative.directorMemory.summary || (locale === 'zh-CN' ? '摘要为空。' : 'The summary is empty.')}</p>
                      {(world.narrative.directorMemory.lockedFacts?.length ?? 0) > 0 && (
                        <ul>
                          {world.narrative.directorMemory.lockedFacts?.map((fact) => <li key={fact}>{fact}</li>)}
                        </ul>
                      )}
                      <small>
                        {locale === 'zh-CN' ? '截至轮次' : 'Through turn'}：{world.narrative.directorMemory.throughTurnId || '—'}
                        {' · '}
                        {locale === 'zh-CN' ? '更新时间' : 'Updated'}：{world.narrative.directorMemory.updatedAtSeconds.toFixed(1)}s
                      </small>
                    </>
                  ) : (
                    <p>{locale === 'zh-CN' ? '尚未达到自动压缩阈值，当前仍使用原始对话历史。' : 'The automatic compaction threshold has not been reached; raw turns are still in use.'}</p>
                  )}
                </details>
                <details className="world-story-debug-memory">
                  <summary><Bug size={11} />{locale === 'zh-CN' ? '剧情运行诊断' : 'Story runtime diagnostics'}</summary>
                  {scenarioRuntimeIssues.length > 0
                    ? <pre>{JSON.stringify(scenarioRuntimeIssues, null, 2)}</pre>
                    : <p>{locale === 'zh-CN' ? '未发现悬空对白、时间轴或等待事件。' : 'No dangling dialogue, timeline, or queued event detected.'}</p>}
                </details>
                <details className="world-story-debug-memory">
                  <summary><Sparkles size={11} />{locale === 'zh-CN' ? '角色认知聚焦' : 'Character cognition focus'}</summary>
                  <pre>{JSON.stringify({
                    candidates: rankWorldCognitionCandidates(world),
                    entities: world.entities.map((entity) => ({
                      id: entity.id,
                      name: entity.name,
                      spark: entity.mind.spark,
                      activeGoal: entity.mind.goals[0],
                      queuedGoals: entity.mind.goals.slice(1),
                      memories: retrieveWorldMemories(world, entity.id).map(({ memory, score, reasons }) => ({
                        id: memory.id,
                        content: memory.content,
                        score,
                        reasons,
                      })),
                      clues: retrieveWorldClues(world, entity.id).map(({ clue, score }) => ({
                        id: clue.id,
                        kind: clue.kind,
                        confidence: clue.confidence,
                        text: clue.text,
                        score,
                      })),
                      reflections: deriveWorldReflections(world, entity.id),
                    })),
                  }, null, 2)}</pre>
                </details>
                <details className="world-story-debug-memory">
                  <summary><TrendingUp size={11} />{locale === 'zh-CN' ? '认知得分轨迹' : 'Cognition score trace'}</summary>
                  {cognitionTrace.length === 0 ? (
                    <p>{locale === 'zh-CN'
                      ? '开启 AI 导演后，每次脉冲都会记录全体候选的得分与入选情况。'
                      : 'Enable the AI director; every pulse records the full candidate ranking and selection.'}</p>
                  ) : (
                    <ol className="world-story-trace">
                      {cognitionTrace.map((entry) => (
                        <li key={entry.id} className="world-story-trace-entry">
                          <header>
                            <strong>{entry.timeSeconds.toFixed(1)}s</strong>
                            {entry.cadenceMs !== undefined && (
                              <span>{locale === 'zh-CN' ? `下一脉冲 +${(entry.cadenceMs / 1000).toFixed(0)}s` : `next pulse +${(entry.cadenceMs / 1000).toFixed(0)}s`}</span>
                            )}
                          </header>
                          {entry.candidates.length === 0 ? (
                            <p>{locale === 'zh-CN' ? '本轮没有可评估的候选。' : 'No eligible candidates this pulse.'}</p>
                          ) : (
                            <ul>
                              {entry.candidates.map((candidate) => (
                                <li key={candidate.entityId} className={candidate.selected ? 'selected' : ''}>
                                  <strong>{candidate.name}</strong>
                                  <span className="score">{candidate.score.toFixed(2)}</span>
                                  {candidate.deltaScore !== undefined && candidate.deltaScore !== 0 && (
                                    <em className={candidate.deltaScore > 0 ? 'up' : 'down'}>
                                      {candidate.deltaScore > 0 ? '+' : ''}{candidate.deltaScore.toFixed(2)}
                                    </em>
                                  )}
                                  <small>{candidate.reasons.length > 0
                                    ? candidate.reasons.join(', ')
                                    : (locale === 'zh-CN' ? '无加分项' : 'no signals')}</small>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </details>
              </aside>
            )}
            {feed.map((item) => (
              <article className={`narrative-passage ${item.kind}`} key={item.id}>
                {item.kind === 'director-turn' && item.status === 'completed' && world.narrative.directorTurns.some((turn) => turn.id === item.id && turn.checkpoint) && (
                  <button
                    type="button"
                    className="world-story-replay"
                    disabled={isDirectorThinking || isScenarioDialoguePlaying || isLlmTesting}
                    title={locale === 'zh-CN' ? '恢复到此节点开始前的场景并重新演绎；之后的节点将被撤回' : 'Restore the scene before this node and replay it; later nodes will be rewound'}
                    onClick={() => {
                      const turn = world.narrative.directorTurns.find((candidate) => candidate.id === item.id)
                      if (turn?.checkpoint) void onReplayDirectorTurn(turn)
                    }}
                  >
                    <RefreshCw size={11} />
                    {locale === 'zh-CN' ? '重播' : 'Replay'}
                  </button>
                )}
                {item.kind === 'active-dialogue' && (
                  <p className="narrative-phase">
                    <BookOpen size={11} />
                    {locale === 'zh-CN' ? '预设剧情接续' : 'Authored scene continues'}
                    {item.title ? ` · ${item.title}` : ''}
                  </p>
                )}
                {item.origin === 'autonomous'
                  ? (
                      <p className="narrative-phase">
                        <Bot size={11} />
                        {locale === 'zh-CN' ? 'AI 世界导演观察并编排角色' : 'AI world director observes and directs the cast'}
                      </p>
                    )
                  : item.playerText && <p className="player"><strong>{locale === 'zh-CN' ? `你（${protagonist?.name ?? '玩家'}）` : `You (${protagonist?.name ?? 'Player'})`}</strong><AnnotatedText text={item.playerText} references={references} onSelectEntity={onSelectEntity} /></p>}
                {item.reasoning && (
                  <ReasoningPanel text={item.reasoning} streaming={item.status === 'streaming'} locale={locale} />
                )}
                {debugMode && item.kind === 'director-turn' && (
                  <DirectorDebugPanel item={item} locale={locale} />
                )}
                {item.blocks.map((block) => (
                  <div className="world-story-block-row" key={block.id}>
                    <FeedBlock block={block} world={world} structures={structures} references={references} locale={locale} disabled={isDirectorThinking || isScenarioDialoguePlaying} onChoose={chooseInput} onSelectEntity={onSelectEntity} />
                    {item.kind === 'director-turn' && item.status === 'completed' && world.narrative.directorTurns.some((turn) => turn.id === item.id && turn.checkpoint) && (
                      <button
                        type="button"
                        className="world-story-entry-replay"
                        disabled={isDirectorThinking || isScenarioDialoguePlaying || isLlmTesting}
                        aria-label={locale === 'zh-CN' ? '重播到此事件' : 'Replay through this event'}
                        title={locale === 'zh-CN' ? '恢复场景并重播到此事件' : 'Restore the scene and replay through this event'}
                        onClick={() => {
                          const turn = world.narrative.directorTurns.find((candidate) => candidate.id === item.id)
                          if (turn?.checkpoint) void onReplayDirectorEntry(turn, block.id)
                        }}
                      >
                        <RefreshCw size={10} />
                      </button>
                    )}
                  </div>
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
                      : item.origin === 'autonomous'
                        ? (locale === 'zh-CN' ? 'AI 正在实时编排世界……' : 'AI is directing the live world…')
                      : (locale === 'zh-CN' ? '场景正在演绎……' : 'The scene is unfolding…')}
                  </p>
                )}
                {item.error && (
                  <div className="world-story-turn-error">
                    <p className="error">{item.error}</p>
                    {item.kind === 'director-turn' && item.status === 'failed' && (
                      <button
                        type="button"
                        disabled={isDirectorThinking || isScenarioDialoguePlaying || isLlmTesting || !llmConfigured}
                        onClick={() => {
                          const retryTurn = world.narrative.directorTurns.find((turn) => turn.id === item.id)
                          if (retryTurn) void submit(retryTurn)
                        }}
                      >
                        <RefreshCw size={12} />
                        {locale === 'zh-CN' ? '重试' : 'Retry'}
                      </button>
                    )}
                  </div>
                )}
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
              </div>
              {isAiActivityThinking && <p className="world-story-tool-status"><Bot size={12} />{locale === 'zh-CN' ? 'AI 正在编排这一刻……' : 'AI is staging this moment…'}</p>}
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
                  disabled={isDirectorThinking || isScenarioDialoguePlaying || isLlmTesting}
                  placeholder={isScenarioDialoguePlaying
                    ? (locale === 'zh-CN' ? '预设剧情正在演绎，结束后可继续……' : 'An authored scene is playing. Continue when it finishes…')
                    : (locale === 'zh-CN' ? '让角色行动、交谈，或改变故事走向……' : 'Let characters act, speak, or change the story…')}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                    event.preventDefault()
                    void submit()
                  }}
                />
                {isDirectorThinking
                  ? <button type="button" className="stop" onClick={onStopDirector}><Square size={14} />{locale === 'zh-CN' ? '停止' : 'Stop'}</button>
                  : <button type="submit" disabled={!input.trim() || isScenarioDialoguePlaying || isLlmTesting}><Send size={14} />{isLlmTesting
                      ? (locale === 'zh-CN' ? '测试中' : 'Testing')
                      : isScenarioDialoguePlaying
                        ? (locale === 'zh-CN' ? '演绎中' : 'Playing')
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
