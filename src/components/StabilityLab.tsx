import { Activity, CloudRain, Pause, Play, RotateCcw, Wind, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { BrickScene } from './BrickScene'
import { getDisasterFrame, runDisasterSimulation, type DisasterScenario } from '../lib/disasterSimulation'
import { useI18n } from '../lib/i18n'
import type { BuildPlan } from '../types/bricks'

type StabilityLabProps = {
  plan: BuildPlan
  onClose: () => void
}

const weatherParticleCount = 18

export const StabilityLab = ({ plan, onClose }: StabilityLabProps) => {
  const { t } = useI18n()
  const [scenario, setScenario] = useState<DisasterScenario>('wind')
  const [intensity, setIntensity] = useState(70)
  const [directionDegrees, setDirectionDegrees] = useState(25)
  const [result, setResult] = useState(() => runDisasterSimulation(plan.bricks, {
    scenario: 'wind',
    intensity: 70,
    directionDegrees: 25,
  }))
  const [timeSeconds, setTimeSeconds] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)

  const restartSimulation = useCallback(() => {
    const nextResult = runDisasterSimulation(plan.bricks, { scenario, intensity, directionDegrees })
    setResult(nextResult)
    setTimeSeconds(0)
    setIsPlaying(true)
  }, [directionDegrees, intensity, plan.bricks, scenario])

  useEffect(() => {
    if (!isPlaying) return
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
  }, [isPlaying, result.options.durationSeconds])

  const frame = useMemo(() => getDisasterFrame(result, timeSeconds), [result, timeSeconds])
  const displayBricks = useMemo(() => plan.bricks.map((brick) => {
    const offset = frame.offsetsByBrickId.get(brick.id)
    return {
      ...brick,
      color: frame.failedIds.has(brick.id) ? 'red' as const : brick.color,
      pose: offset ? {
        ...brick.pose,
        xStud: brick.pose.xStud + offset.x,
        yStud: brick.pose.yStud + offset.y,
        zStud: brick.pose.zStud + offset.z,
      } : brick.pose,
    }
  }), [frame.failedIds, frame.offsetsByBrickId, plan.bricks])
  const currentFailedCount = frame.failedIds.size
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
              <label>
                <span>{t('stabilityLab.direction')} <strong>{directionDegrees}°</strong></span>
                <input type="range" min={0} max={355} step={5} value={directionDegrees} onChange={(event) => setDirectionDegrees(Number(event.target.value))} />
              </label>
            )}
            <button className="primary stability-run" type="button" onClick={restartSimulation} disabled={plan.bricks.length === 0}>
              <Zap size={16} />
              {t('stabilityLab.run')}
            </button>
          </section>

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
        </div>

        <section className="stability-simulator">
          <div className={`disaster-weather disaster-weather-${result.options.scenario} ${isPlaying ? '' : 'paused'}`} aria-hidden="true">
            {Array.from({ length: weatherParticleCount }, (_, index) => <i key={index} style={{ '--particle-index': index } as CSSProperties} />)}
          </div>
          <BrickScene
            bricks={displayBricks}
            selectedId=""
            cameraFrameKey={`${plan.id}:stability-lab`}
            stabilityAnalysis={result.analysis}
            onSelect={() => {}}
            onNudgeSelected={() => {}}
            onRotateSelected={() => {}}
            onDeleteSelected={() => {}}
          />
          <div className="simulation-status">
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
      </section>
    </div>
  )
}
