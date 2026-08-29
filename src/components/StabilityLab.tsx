import { Activity, ArrowLeft, ArrowRight, CloudRain, Download, FileJson, Gauge, Image, LoaderCircle, Pause, Play, RotateCcw, Wind, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BrickScene, type BrickSceneTransform } from './BrickScene'
import { brickById } from '../data/basicBricks'
import {
  getDisasterFrame,
  type DisasterFailureMode,
  type DisasterPhysicsProfile,
  type DisasterScenario,
  type DisasterSimulationOptions,
  type DisasterSimulationResult,
  type DisasterSimulationWorkerRequest,
  type DisasterSimulationWorkerResponse,
} from '../lib/disasterSimulation'
import { useI18n } from '../lib/i18n'
import { getSimulationPlaybackFps } from '../lib/scenePerformance'
import { createBrickStabilityInsights, createStabilityReport, formatStabilityReportMarkdown, formatStabilityReportSvg } from '../lib/stabilityReport'
import { createPlanFingerprint, deleteStabilitySnapshot, loadStabilityHistory, renameStabilitySnapshot, saveStabilitySnapshot, type StabilitySnapshot } from '../lib/stabilityHistory'
import { createBuildGraph } from '../lib/planUtils'
import { StabilityHistoryPanel } from './StabilityHistoryPanel'
import { StabilitySuitePanel } from './StabilitySuitePanel'
import type { BuildPlan } from '../types/bricks'

type StabilityLabProps = {
  plan: BuildPlan
  onClose: () => void
  onSnapshotSaved?: () => void
}

const weatherParticleCount = 18
const ignoreSceneEdit = () => {}
const failedConnectionColor = '#dc2626'
const connectionHeatColor = (utilization: number) => {
  if (utilization <= 0.001) return '#64748b'
  if (utilization < 0.35) return '#38bdf8'
  if (utilization < 0.7) return '#22c55e'
  if (utilization < 1) return '#f59e0b'
  return failedConnectionColor
}
const windDirectionPresets = [
  { degrees: 0, axis: 'X+' },
  { degrees: 90, axis: 'Z+' },
  { degrees: 180, axis: 'X−' },
  { degrees: 270, axis: 'Z−' },
] as const

type WindDirectionIndicatorProps = {
  degrees: number
  label: string
  hint?: string
  compact?: boolean
  viewAzimuthDegrees?: number
}

const WindDirectionIndicator = ({
  degrees,
  label,
  hint,
  compact = false,
  viewAzimuthDegrees = 0,
}: WindDirectionIndicatorProps) => (
  <div
    className={`wind-direction-indicator ${compact ? 'compact' : ''}`}
    role="img"
    aria-label={`${label} ${degrees}°`}
  >
    <div className="wind-direction-dial" aria-hidden="true">
      <div
        className="wind-direction-compass"
        style={{
          '--camera-angle': `${viewAzimuthDegrees}deg`,
          '--camera-counter-angle': `${-viewAzimuthDegrees}deg`,
        } as CSSProperties}
      >
        <span className="wind-axis wind-axis-x-positive">X+</span>
        <span className="wind-axis wind-axis-z-positive">Z+</span>
        <span className="wind-axis wind-axis-x-negative">X−</span>
        <span className="wind-axis wind-axis-z-negative">Z−</span>
        <ArrowRight
          className="wind-direction-arrow"
          style={{ '--wind-angle': `${degrees}deg` } as CSSProperties}
        />
      </div>
    </div>
    <div className="wind-direction-copy">
      <span>{label}</span>
      <strong>{degrees}°</strong>
      {hint && <small>{hint}</small>}
    </div>
  </div>
)

export const StabilityLab = ({ plan, onClose, onSnapshotSaved }: StabilityLabProps) => {
  const { locale, t } = useI18n()
  const [scenario, setScenario] = useState<DisasterScenario>('wind')
  const [intensity, setIntensity] = useState(70)
  const [directionDegrees, setDirectionDegrees] = useState(25)
  const [physicsProfile, setPhysicsProfile] = useState<DisasterPhysicsProfile>('challenge')
  const [result, setResult] = useState<DisasterSimulationResult>()
  const [isSimulating, setIsSimulating] = useState(true)
  const [simulationError, setSimulationError] = useState('')
  const [timeSeconds, setTimeSeconds] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [cameraAzimuthDegrees, setCameraAzimuthDegrees] = useState(18)
  const [showConnectionHeatmap, setShowConnectionHeatmap] = useState(true)
  const [inspectedBrickId, setInspectedBrickId] = useState('')
  const [history, setHistory] = useState<StabilitySnapshot[]>(() => loadStabilityHistory(plan.id))
  const [baselineId, setBaselineId] = useState(() => loadStabilityHistory(plan.id)[0]?.id ?? '')
  const [reportTheme, setReportTheme] = useState<'light' | 'dark'>('light')
  const workerRef = useRef<Worker>()
  const simulatorRef = useRef<HTMLElement>(null)
  const simulationRunRef = useRef(0)
  const simulationPlaybackIntervalMs = 1000 / getSimulationPlaybackFps(plan.bricks.length)

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = undefined
  }, [])

  const runSimulation = useCallback((options: DisasterSimulationOptions) => {
    const requestId = ++simulationRunRef.current
    stopWorker()
    setResult(undefined)
    setIsSimulating(true)
    setSimulationError('')
    setTimeSeconds(0)
    setIsPlaying(false)

    try {
      const worker = new Worker(new URL('../workers/stabilityWorker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      worker.onmessage = (event: MessageEvent<DisasterSimulationWorkerResponse>) => {
        if (event.data.requestId !== simulationRunRef.current) return
        stopWorker()
        setIsSimulating(false)
        if (event.data.type === 'error') {
          setSimulationError(event.data.message)
          return
        }
        setResult(event.data.result)
        setIsPlaying(true)
      }
      worker.onerror = () => {
        if (requestId !== simulationRunRef.current) return
        stopWorker()
        setIsSimulating(false)
        setSimulationError('STABILITY_SIMULATION_WORKER_FAILED')
      }
      worker.postMessage({
        type: 'simulate',
        requestId,
        bricks: plan.bricks,
        options,
      } satisfies DisasterSimulationWorkerRequest)
    } catch (error) {
      stopWorker()
      setIsSimulating(false)
      setSimulationError(error instanceof Error ? error.message : 'STABILITY_SIMULATION_WORKER_FAILED')
    }
  }, [plan.bricks, stopWorker])

  useEffect(() => {
    runSimulation({ scenario: 'wind', intensity: 70, directionDegrees: 25, physicsProfile: 'challenge' })
    return () => {
      simulationRunRef.current += 1
      stopWorker()
    }
  }, [runSimulation, stopWorker])

  const restartSimulation = useCallback(() => {
    runSimulation({ scenario, intensity, directionDegrees, physicsProfile })
  }, [directionDegrees, intensity, physicsProfile, runSimulation, scenario])

  const inspectSuiteCase = useCallback((options: DisasterSimulationOptions) => {
    setScenario(options.scenario)
    setIntensity(options.intensity)
    setDirectionDegrees(options.directionDegrees ?? 0)
    setPhysicsProfile(options.physicsProfile ?? 'challenge')
    runSimulation(options)
  }, [runSimulation])

  useEffect(() => {
    if (!isPlaying || !result) return
    let animationFrame = 0
    let previousTime = performance.now()
    const animate = (now: number) => {
      if (now - previousTime < simulationPlaybackIntervalMs * 0.9) {
        animationFrame = requestAnimationFrame(animate)
        return
      }
      const elapsed = Math.min(0.12, (now - previousTime) / 1000)
      previousTime = now
      setTimeSeconds((current) => {
        const next = current + elapsed
        if (next >= result.options.durationSeconds) {
          setIsPlaying(false)
          return result.options.durationSeconds
        }
        return next
      })
      animationFrame = requestAnimationFrame(animate)
    }
    animationFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrame)
  }, [isPlaying, result, simulationPlaybackIntervalMs])

  const inspectBrick = useCallback((brickId: string) => {
    setInspectedBrickId((current) => current === brickId ? '' : brickId)
  }, [])

  const frame = useMemo(() => result ? getDisasterFrame(result, timeSeconds) : undefined, [result, timeSeconds])
  const sceneDisplayColorByBrickId = useMemo(() => {
    if (!frame) return undefined
    const colors = new Map<string, string>()
    for (const brick of plan.bricks) {
      if (frame.failedIds.has(brick.id)) {
        colors.set(brick.id, failedConnectionColor)
      } else if (showConnectionHeatmap) {
        colors.set(brick.id, connectionHeatColor(frame.connectionUtilizationByBrickId.get(brick.id) ?? 0))
      }
    }
    return colors
  }, [frame, plan.bricks, showConnectionHeatmap])
  const sceneTransformsByBrickId = useMemo(() => {
    if (!frame) return undefined
    const brickIds = new Set([
      ...frame.offsetsByBrickId.keys(),
      ...frame.rotationsByBrickId.keys(),
    ])
    return new Map([...brickIds].map((brickId) => [brickId, {
      translation: frame.offsetsByBrickId.get(brickId),
      rotation: frame.rotationsByBrickId.get(brickId),
    } satisfies BrickSceneTransform]))
  }, [frame])
  const currentFailedCount = frame?.failedIds.size ?? 0
  const windExposureSummary = useMemo(() => {
    if (!result || !frame || result.options.scenario !== 'wind') return undefined
    let projectedArea = 0
    let exposedArea = 0
    for (const [brickId, exposure] of frame.windExposureByBrickId) {
      if (frame.failedIds.has(brickId)) continue
      projectedArea += exposure.projectedArea
      exposedArea += exposure.exposedArea
    }
    if (projectedArea <= 0) return undefined
    return {
      percent: Math.round(exposedArea / projectedArea * 100),
      area: exposedArea.toFixed(1),
    }
  }, [frame, result])
  const rainExposureSummary = useMemo(() => {
    if (!result || !frame || result.options.scenario !== 'rain') return undefined
    let projectedArea = 0
    let exposedArea = 0
    for (const [brickId, exposure] of frame.rainExposureByBrickId) {
      if (frame.failedIds.has(brickId)) continue
      projectedArea += exposure.projectedArea
      exposedArea += exposure.exposedArea
    }
    if (projectedArea <= 0) return undefined
    return {
      percent: Math.round(exposedArea / projectedArea * 100),
      area: exposedArea.toFixed(1),
    }
  }, [frame, result])
  const primaryFailureMode = useMemo(() => {
    if (!result || !frame || frame.failedIds.size === 0) return undefined
    const counts = new Map<DisasterFailureMode, number>()
    for (const brickId of frame.failedIds) {
      const mode = result.failureModeByBrickId.get(brickId)
      if (mode) counts.set(mode, (counts.get(mode) ?? 0) + 1)
    }
    const directFailures = [...counts].filter(([mode]) => mode !== 'detached')
    const primary = (directFailures.length > 0 ? directFailures : [...counts])
      .sort((left, right) => right[1] - left[1])[0]
    return primary ? { mode: primary[0], count: primary[1] } : undefined
  }, [frame, result])
  const peakConnectionUtilization = useMemo(() => {
    if (!result) return undefined
    const peak = Math.max(0, ...result.peakConnectionUtilizationByBrickId.values())
    return Math.round(peak * 100)
  }, [result])
  const criticalConnections = useMemo(() => {
    if (!result || !frame) return []
    const placedById = new Map(plan.bricks.map((brick) => [brick.id, brick]))
    return [...frame.connectionUtilizationByBrickId]
      .filter(([, utilization]) => utilization > 0.001)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([brickId, utilization]) => {
        const placed = placedById.get(brickId)
        const definition = placed ? brickById.get(placed.brickId) : undefined
        const failed = frame.failedIds.has(brickId)
        const mode = failed
          ? result.failureModeByBrickId.get(brickId)
          : result.governingFailureModeByBrickId.get(brickId)
        return {
          brickId,
          label: definition?.name ?? placed?.brickId ?? brickId,
          partNumber: definition?.partNumber,
          utilization: Math.round(utilization * 100),
          failed,
          mode,
        }
      })
  }, [frame, plan.bricks, result])
  const inspectedInsights = useMemo(() => {
    if (!result || !inspectedBrickId) return []
    const item = result.analysis.riskByBrickId.get(inspectedBrickId)
    return item ? createBrickStabilityInsights(item, locale) : []
  }, [inspectedBrickId, locale, result])
  const report = useMemo(
    () => result ? createStabilityReport(plan, result.analysis, locale, result) : undefined,
    [locale, plan, result],
  )
  useEffect(() => {
    if (!report) return
    const now = new Date()
    const saved = saveStabilitySnapshot({
      id: `analysis-${now.getTime().toString(36)}`,
      planId: plan.id,
      name: locale === 'zh-CN' ? `分析 ${now.toLocaleString('zh-CN')}` : `Analysis ${now.toLocaleString('en-US')}`,
      createdAt: now.toISOString(),
      planFingerprint: createPlanFingerprint(plan),
      report,
    })
    setHistory(saved.history)
    if (saved.created) {
      setBaselineId((current) => current || saved.history[1]?.id || saved.snapshot.id)
      onSnapshotSaved?.()
    }
  }, [locale, onSnapshotSaved, plan, report])

  const getSceneThumbnail = () => {
    try {
      return simulatorRef.current?.querySelector('canvas')?.toDataURL('image/png')
    } catch {
      return undefined
    }
  }

  const downloadReport = async (format: 'json' | 'md' | 'svg' | 'png') => {
    if (!report) return
    const content = format === 'json'
      ? JSON.stringify(report, null, 2)
      : format === 'md'
        ? formatStabilityReportMarkdown(report, locale)
        : formatStabilityReportSvg(report, locale, { theme: reportTheme, thumbnailDataUrl: getSceneThumbnail() })
    let blob: Blob
    if (format === 'png') {
      const svgUrl = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' }))
      try {
        const image = document.createElement('img')
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve()
          image.onerror = () => reject(new Error('REPORT_IMAGE_FAILED'))
          image.src = svgUrl
        })
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        canvas.getContext('2d')?.drawImage(image, 0, 0)
        blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('REPORT_PNG_FAILED')), 'image/png'))
      } finally {
        URL.revokeObjectURL(svgUrl)
      }
    } else {
      blob = new Blob([content], { type: format === 'json' ? 'application/json' : format === 'svg' ? 'image/svg+xml' : 'text/markdown' })
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${plan.title || 'brick-plan'}-stability-report.${format}`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }
  const riskyBrickIds = useMemo(() => result ? [...result.analysis.riskByBrickId.values()]
    .filter((item) => item.riskLevel !== 'stable')
    .sort((left, right) => right.risk - left.risk)
    .map((item) => item.brickId) : [], [result])
  const relatedSupportIds = useMemo(() => {
    if (!inspectedBrickId) return []
    const graph = createBuildGraph(plan.bricks)
    const selectedBounds = graph.boundsById.get(inspectedBrickId)
    const connected = [...(graph.attachmentEdges.get(inspectedBrickId) ?? [])]
    if (!selectedBounds) return connected
    const supports = connected.filter((brickId) => {
      const bounds = graph.boundsById.get(brickId)
      return bounds && bounds.maxY <= selectedBounds.minY + 0.15
    })
    return supports.length > 0 ? supports : connected
  }, [inspectedBrickId, plan.bricks])
  const navigateRisk = (direction: -1 | 1) => {
    if (riskyBrickIds.length === 0) return
    const current = riskyBrickIds.indexOf(inspectedBrickId)
    const next = current < 0 ? 0 : (current + direction + riskyBrickIds.length) % riskyBrickIds.length
    setInspectedBrickId(riskyBrickIds[next])
  }
  const scenarioOptions: Array<{ value: DisasterScenario; icon: typeof Wind }> = [
    { value: 'wind', icon: Wind },
    { value: 'rain', icon: CloudRain },
    { value: 'earthquake', icon: Activity },
  ]

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="stability-lab-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stability-lab-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="stability-lab-title">{t('stabilityLab.title')}</h2>
            <p>{t('stabilityLab.description', { title: plan.title })}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="stability-lab-layout">
          <section className="stability-lab-controls">
            <div className="disaster-scenarios" aria-label={t('stabilityLab.scenario')}>
              {scenarioOptions.map(({ value, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  className={scenario === value ? 'active' : ''}
                  aria-pressed={scenario === value}
                  onClick={() => {
                    setScenario(value)
                    runSimulation({
                      scenario: value,
                      intensity,
                      directionDegrees,
                      physicsProfile,
                    })
                  }}
                >
                  <Icon size={17} />
                  {t(`stabilityLab.scenario.${value}`)}
                </button>
              ))}
            </div>
            <label>
              <span>{t('stabilityLab.intensity')} <strong>{intensity}%</strong></span>
              <input type="range" min={10} max={100} step={5} value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} />
            </label>
            <div className="rain-physics-control">
              <span>{t('stabilityLab.physicsProfile')}</span>
              <div className="rain-physics-profiles">
                {(['challenge', 'realistic'] as const).map((profile) => (
                  <button
                    key={profile}
                    type="button"
                    className={physicsProfile === profile ? 'active' : ''}
                    aria-pressed={physicsProfile === profile}
                    onClick={() => {
                      setPhysicsProfile(profile)
                      runSimulation({ scenario, intensity, directionDegrees, physicsProfile: profile })
                    }}
                  >
                    {t(`stabilityLab.physicsProfile.${profile}`)}
                  </button>
                ))}
              </div>
              <small>{t(`stabilityLab.physicsProfile.${physicsProfile}.hint`)}</small>
            </div>
            {scenario !== 'rain' && (
              <div className="wind-direction-control">
                <WindDirectionIndicator
                  degrees={directionDegrees}
                  label={t(scenario === 'earthquake'
                    ? 'stabilityLab.shakeDirectionConfigured'
                    : 'stabilityLab.directionConfigured')}
                  hint={t(scenario === 'earthquake'
                    ? 'stabilityLab.shakeDirectionHint'
                    : 'stabilityLab.directionHint')}
                />
                <div className="wind-direction-settings">
                  <label>
                    <span>{t(scenario === 'earthquake'
                      ? 'stabilityLab.shakeDirection'
                      : 'stabilityLab.direction')} <strong>{directionDegrees}°</strong></span>
                    <input
                      type="range"
                      min={0}
                      max={355}
                      step={5}
                      value={directionDegrees}
                      onChange={(event) => setDirectionDegrees(Number(event.target.value))}
                    />
                  </label>
                  <div className="wind-direction-presets" aria-label={t(scenario === 'earthquake'
                    ? 'stabilityLab.shakeDirectionPresets'
                    : 'stabilityLab.directionPresets')}>
                    {windDirectionPresets.map(({ degrees, axis }) => (
                      <button
                        key={degrees}
                        type="button"
                        className={directionDegrees === degrees ? 'active' : ''}
                        aria-pressed={directionDegrees === degrees}
                        onClick={() => setDirectionDegrees(degrees)}
                      >
                        <strong>{axis}</strong>
                        <span>{degrees}°</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <button className="primary stability-run" type="button" onClick={restartSimulation} disabled={plan.bricks.length === 0 || isSimulating}>
              {isSimulating ? <LoaderCircle className="spin" size={16} /> : <Zap size={16} />}
              {t(isSimulating ? 'stabilityLab.calculating' : 'stabilityLab.run')}
            </button>
          </section>

          {result ? (
            <section className="stability-score-card">
              <div className={`stability-grade grade-${result.grade.toLowerCase()}`}>
                <span>{result.grade}</span>
                <strong>{result.score}</strong>
                <small>{t('stabilityLab.totalScore')}</small>
              </div>
              <div className="stability-score-breakdown">
                {Object.entries(result.scoreBreakdown).map(([key, value]) => (
                  <div key={key}>
                    <span>{t(`stabilityLab.score.${key}`)}</span>
                    <strong>{value}</strong>
                    <i><b style={{ width: `${value}%` }} /></i>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section className={`stability-compute-card ${simulationError ? 'error' : ''}`} role="status" aria-live="polite">
              {isSimulating ? <LoaderCircle className="spin" size={24} /> : <Activity size={24} />}
              <strong>{t(isSimulating ? 'stabilityLab.calculatingTitle' : 'stabilityLab.errorTitle')}</strong>
              <span>{t(isSimulating ? 'stabilityLab.calculatingHint' : 'stabilityLab.errorHint')}</span>
            </section>
          )}
        </div>

        {result && frame ? (
          <>
            <section className="stability-simulator" ref={simulatorRef}>
              <div
                className={`disaster-weather disaster-weather-${result.options.scenario} ${isPlaying ? '' : 'paused'}`}
                style={result.options.scenario === 'wind'
                  ? { '--wind-screen-angle': `${result.options.directionDegrees + cameraAzimuthDegrees}deg` } as CSSProperties
                  : undefined}
                aria-hidden="true"
              >
                {Array.from({ length: weatherParticleCount }, (_, index) => <i key={index} style={{ '--particle-index': index } as CSSProperties} />)}
              </div>
              <BrickScene
                bricks={plan.bricks}
                selectedId={inspectedBrickId}
                cameraFrameKey={`${plan.id}:stability-lab:${inspectedBrickId}`}
                cameraFocusBrickIds={inspectedBrickId ? [inspectedBrickId, ...relatedSupportIds] : undefined}
                preserveDrawingBuffer
                highlightedIds={relatedSupportIds}
                stabilityAnalysis={result.analysis}
                displayColorByBrickId={sceneDisplayColorByBrickId}
                transformsByBrickId={sceneTransformsByBrickId}
                onCameraAzimuthChange={setCameraAzimuthDegrees}
                onSelect={inspectBrick}
                onNudgeSelected={ignoreSceneEdit}
                onRotateSelected={ignoreSceneEdit}
                onDeleteSelected={ignoreSceneEdit}
              />
              {result.options.scenario !== 'rain' && (
                <div className="simulation-wind-direction">
                  <WindDirectionIndicator
                    compact
                    degrees={result.options.directionDegrees}
                    viewAzimuthDegrees={cameraAzimuthDegrees}
                    label={t(result.options.scenario === 'earthquake'
                      ? 'stabilityLab.shakeDirectionActive'
                      : 'stabilityLab.directionActive')}
                  />
                </div>
              )}
              <div className="simulation-load-inspector">
                <div className="simulation-load-inspector-header">
                  <strong>{t('stabilityLab.loadInspector')}</strong>
                  <button
                    type="button"
                    className={showConnectionHeatmap ? 'active' : ''}
                    aria-pressed={showConnectionHeatmap}
                    onClick={() => setShowConnectionHeatmap((visible) => !visible)}
                  >
                    <Gauge size={13} />
                    {t('stabilityLab.heatmap')}
                  </button>
                </div>
                {showConnectionHeatmap && (
                  <div className="simulation-load-legend" aria-label={t('stabilityLab.heatmapLegend')}>
                    <span><i className="cool" />{t('stabilityLab.heatmap.low')}</span>
                    <span><i className="safe" />{t('stabilityLab.heatmap.medium')}</span>
                    <span><i className="warning" />{t('stabilityLab.heatmap.high')}</span>
                    <span><i className="failed" />{t('stabilityLab.heatmap.failed')}</span>
                  </div>
                )}
                {criticalConnections.length > 0 ? (
                  <ol>
                    {criticalConnections.map((connection) => (
                      <li
                        key={connection.brickId}
                        className={`${connection.failed ? 'failed' : ''} ${inspectedBrickId === connection.brickId ? 'active' : ''}`}
                      >
                        <button
                          type="button"
                          aria-pressed={inspectedBrickId === connection.brickId}
                          aria-label={t('stabilityLab.inspectConnection', { label: connection.label })}
                          onClick={() => setInspectedBrickId((current) => (
                            current === connection.brickId ? '' : connection.brickId
                          ))}
                        >
                          <span>
                            <strong title={connection.label}>{connection.label}</strong>
                            <small>
                              {connection.partNumber ? `#${connection.partNumber} · ` : ''}
                              {connection.mode ? t(`stabilityLab.failureMode.${connection.mode}`) : t('stabilityLab.connectionLoad')}
                            </small>
                          </span>
                          <b>{connection.utilization}%</b>
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <small className="simulation-load-empty">{t('stabilityLab.noConnectionLoad')}</small>
                )}
                {inspectedBrickId && (
                  <div className="stability-brick-explanation" role="status">
                    <div className="stability-risk-navigation">
                      <button type="button" onClick={() => navigateRisk(-1)} aria-label={locale === 'zh-CN' ? '上一个风险' : 'Previous risk'}><ArrowLeft size={13} /></button>
                      <strong>{locale === 'zh-CN' ? `所选零件诊断 · 支撑 ${relatedSupportIds.length}` : `Selected part diagnosis · ${relatedSupportIds.length} supports`}</strong>
                      <button type="button" onClick={() => navigateRisk(1)} aria-label={locale === 'zh-CN' ? '下一个风险' : 'Next risk'}><ArrowRight size={13} /></button>
                    </div>
                    {inspectedInsights.length > 0 ? inspectedInsights.map((insight) => (
                      <p key={insight.reason}>
                        <span>{insight.reason}</span>
                        <small>{insight.suggestion}</small>
                      </p>
                    )) : <small>{locale === 'zh-CN' ? '没有发现明显的静态结构弱点。' : 'No obvious static weakness was found.'}</small>}
                  </div>
                )}
              </div>
              <div className="simulation-status">
                {windExposureSummary && (
                  <span>{t('stabilityLab.windExposure', windExposureSummary)}</span>
                )}
                {rainExposureSummary && (
                  <span>{t('stabilityLab.rainExposure', rainExposureSummary)}</span>
                )}
                {result.options.scenario === 'rain' && (
                  <span>{t('stabilityLab.waterAccumulation', { percent: Math.round(frame.waterAccumulation * 100) })}</span>
                )}
                <span>{t('stabilityLab.physicsProfileActive', {
                  profile: t(`stabilityLab.physicsProfile.${result.options.physicsProfile}`),
                })}</span>
                <span>{t('stabilityLab.loadCalibration', {
                  value: result.loadCalibration.baseValue.toFixed(1),
                  unit: result.loadCalibration.unit,
                  multiplier: result.loadCalibration.loadMultiplier.toFixed(1),
                })}</span>
                <span>{t('stabilityLab.simulationSteps', { count: result.simulationStepCount })}</span>
                {peakConnectionUtilization !== undefined && (
                  <span className={peakConnectionUtilization >= 100 ? 'failed' : ''}>
                    {t('stabilityLab.connectionUtilization', { percent: peakConnectionUtilization })}
                  </span>
                )}
                <span>{t('stabilityLab.gravityActive')}</span>
                <span className={result.initialStaticFailureCount > 0 ? 'failed' : ''}>
                  {t(result.initialStaticFailureCount > 0
                    ? 'stabilityLab.staticPreflightFailed'
                    : 'stabilityLab.staticPreflightPassed', {
                    count: result.initialStaticFailureCount,
                  })}
                </span>
                <span>{t('stabilityLab.load', { load: Math.round(frame.loadFactor * result.options.intensity) })}</span>
                <span className={currentFailedCount > 0 ? 'failed' : ''}>{t('stabilityLab.failedNow', { count: currentFailedCount })}</span>
                {primaryFailureMode && (
                  <span className="failed">
                    {t('stabilityLab.failureModeActive', {
                      mode: t(`stabilityLab.failureMode.${primaryFailureMode.mode}`),
                      count: primaryFailureMode.count,
                    })}
                  </span>
                )}
              </div>
            </section>

            <section className="simulation-timeline">
              <div>
                <button
                  type="button"
                  onClick={() => {
                    if (!isPlaying && timeSeconds >= result.options.durationSeconds) setTimeSeconds(0)
                    setIsPlaying((playing) => !playing)
                  }}
                >
                  {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                  {t(isPlaying ? 'stabilityLab.pause' : 'stabilityLab.play')}
                </button>
                <button type="button" onClick={() => { setIsPlaying(false); setTimeSeconds(0) }}>
                  <RotateCcw size={15} />
                  {t('stabilityLab.restart')}
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={result.options.durationSeconds}
                step={0.05}
                value={timeSeconds}
                onChange={(event) => { setIsPlaying(false); setTimeSeconds(Number(event.target.value)) }}
                aria-label={t('stabilityLab.timeline')}
              />
              <span>{timeSeconds.toFixed(1)}s / {result.options.durationSeconds.toFixed(1)}s</span>
            </section>

            <footer className="stability-result-summary">
              <div>
                <span>{t('stabilityLab.survived', { survived: result.survivedBrickCount, total: plan.bricks.length })}</span>
                <span>{t('stabilityLab.staticScore', { score: result.analysis.stabilityScore })}</span>
                <span>{t('stabilityLab.tippingMargin', { margin: result.analysis.tippingMargin.toFixed(2) })}</span>
              </div>
              <div className="stability-report-actions">
                <div className="report-theme-toggle" role="group" aria-label={locale === 'zh-CN' ? '报告主题' : 'Report theme'}>
                  {(['light', 'dark'] as const).map((theme) => <button key={theme} type="button" className={reportTheme === theme ? 'active' : ''} onClick={() => setReportTheme(theme)}>{theme === 'light' ? '☀' : '☾'}</button>)}
                </div>
                <button type="button" onClick={() => void downloadReport('png')} title={locale === 'zh-CN' ? '导出 PNG 图片' : 'Export PNG image'}><Image size={15} />PNG</button>
                <button type="button" onClick={() => downloadReport('svg')} title={locale === 'zh-CN' ? '导出可分享图片' : 'Export shareable image'}><Image size={15} />SVG</button>
                <button type="button" onClick={() => downloadReport('md')} title={locale === 'zh-CN' ? '导出 Markdown 报告' : 'Export Markdown report'}><Download size={15} />MD</button>
                <button type="button" onClick={() => downloadReport('json')} title={locale === 'zh-CN' ? '导出结构化报告' : 'Export structured report'}><FileJson size={15} />JSON</button>
              </div>
            </footer>
            <StabilitySuitePanel plan={plan} onInspect={inspectSuiteCase} />
            <StabilityHistoryPanel
              history={history}
              currentReport={report!}
              baselineId={baselineId}
              onBaselineChange={setBaselineId}
              onRename={(snapshot) => {
                const name = window.prompt(locale === 'zh-CN' ? '分析记录名称' : 'Analysis record name', snapshot.name)
                if (!name) return
                const next = renameStabilitySnapshot(plan.id, snapshot.id, name)
                setHistory(next)
                onSnapshotSaved?.()
              }}
              onDelete={(snapshot) => {
                const next = deleteStabilitySnapshot(plan.id, snapshot.id)
                setHistory(next)
                if (baselineId === snapshot.id) setBaselineId(next[0]?.id ?? '')
                onSnapshotSaved?.()
              }}
            />
          </>
        ) : (
          <section className={`stability-simulator stability-simulator-placeholder ${simulationError ? 'error' : ''}`} aria-hidden="true">
            <div />
            <div />
            <div />
          </section>
        )}
      </section>
    </div>
  )
}
