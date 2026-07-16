import { Activity, ArrowRight, CloudRain, LoaderCircle, Pause, Play, RotateCcw, Wind, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BrickScene } from './BrickScene'
import {
  getDisasterFrame,
  type DisasterScenario,
  type DisasterSimulationOptions,
  type DisasterSimulationResult,
  type DisasterSimulationWorkerRequest,
  type DisasterSimulationWorkerResponse,
} from '../lib/disasterSimulation'
import { useI18n } from '../lib/i18n'
import type { BuildPlan } from '../types/bricks'

type StabilityLabProps = {
  plan: BuildPlan
  onClose: () => void
}

const weatherParticleCount = 18
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

export const StabilityLab = ({ plan, onClose }: StabilityLabProps) => {
  const { t } = useI18n()
  const [scenario, setScenario] = useState<DisasterScenario>('wind')
  const [intensity, setIntensity] = useState(70)
  const [directionDegrees, setDirectionDegrees] = useState(25)
  const [result, setResult] = useState<DisasterSimulationResult>()
  const [isSimulating, setIsSimulating] = useState(true)
  const [simulationError, setSimulationError] = useState('')
  const [timeSeconds, setTimeSeconds] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [cameraAzimuthDegrees, setCameraAzimuthDegrees] = useState(18)
  const workerRef = useRef<Worker>()
  const simulationRunRef = useRef(0)

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
    runSimulation({ scenario: 'wind', intensity: 70, directionDegrees: 25 })
    return () => {
      simulationRunRef.current += 1
      stopWorker()
    }
  }, [runSimulation, stopWorker])

  const restartSimulation = useCallback(() => {
    runSimulation({ scenario, intensity, directionDegrees })
  }, [directionDegrees, intensity, runSimulation, scenario])

  useEffect(() => {
    if (!isPlaying || !result) return
    let animationFrame = 0
    let previousTime = performance.now()
    const animate = (now: number) => {
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
  }, [isPlaying, result])

  const frame = useMemo(() => result ? getDisasterFrame(result, timeSeconds) : undefined, [result, timeSeconds])
  const displayBricks = useMemo(() => plan.bricks.map((brick) => {
    const offset = frame?.offsetsByBrickId.get(brick.id)
    return {
      ...brick,
      color: frame?.failedIds.has(brick.id) ? 'red' as const : brick.color,
      pose: offset ? {
        ...brick.pose,
        xStud: brick.pose.xStud + offset.x,
        yStud: brick.pose.yStud + offset.y,
        zStud: brick.pose.zStud + offset.z,
      } : brick.pose,
    }
  }), [frame, plan.bricks])
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
                  onClick={() => setScenario(value)}
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
            {scenario === 'wind' && (
              <div className="wind-direction-control">
                <WindDirectionIndicator
                  degrees={directionDegrees}
                  label={t('stabilityLab.directionConfigured')}
                  hint={t('stabilityLab.directionHint')}
                />
                <div className="wind-direction-settings">
                  <label>
                    <span>{t('stabilityLab.direction')} <strong>{directionDegrees}°</strong></span>
                    <input
                      type="range"
                      min={0}
                      max={355}
                      step={5}
                      value={directionDegrees}
                      onChange={(event) => setDirectionDegrees(Number(event.target.value))}
                    />
                  </label>
                  <div className="wind-direction-presets" aria-label={t('stabilityLab.directionPresets')}>
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
            <section className="stability-simulator">
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
                bricks={displayBricks}
                selectedId=""
                cameraFrameKey={`${plan.id}:stability-lab`}
                stabilityAnalysis={result.analysis}
                onCameraAzimuthChange={setCameraAzimuthDegrees}
                onSelect={() => {}}
                onNudgeSelected={() => {}}
                onRotateSelected={() => {}}
                onDeleteSelected={() => {}}
              />
              {result.options.scenario === 'wind' && (
                <div className="simulation-wind-direction">
                  <WindDirectionIndicator
                    compact
                    degrees={result.options.directionDegrees}
                    viewAzimuthDegrees={cameraAzimuthDegrees}
                    label={t('stabilityLab.directionActive')}
                  />
                </div>
              )}
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
                <span>{t('stabilityLab.load', { load: Math.round(frame.loadFactor * result.options.intensity) })}</span>
                <span className={currentFailedCount > 0 ? 'failed' : ''}>{t('stabilityLab.failedNow', { count: currentFailedCount })}</span>
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
              <span>{t('stabilityLab.survived', { survived: result.survivedBrickCount, total: plan.bricks.length })}</span>
              <span>{t('stabilityLab.staticScore', { score: result.analysis.stabilityScore })}</span>
              <span>{t('stabilityLab.tippingMargin', { margin: result.analysis.tippingMargin.toFixed(2) })}</span>
            </footer>
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
