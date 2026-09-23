import { AlertTriangle, Download, FlaskConical, LoaderCircle, Play, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DisasterPhysicsProfile, DisasterSimulationOptions } from '../lib/disasterSimulation'
import { useI18n } from '../lib/i18n'
import { createPlanFingerprint } from '../lib/stabilityHistory'
import {
  formatStabilitySuiteMarkdown,
  formatStabilitySuiteSvg,
  getStabilitySuiteCases,
  loadStabilitySuiteConfig,
  loadStabilitySuiteResult,
  saveStabilitySuiteConfig,
  saveStabilitySuiteResult,
  suiteCaseToOptions,
  type StabilitySuitePreset,
  type StabilitySuiteResult,
} from '../lib/stabilitySuite'
import type { StabilitySuiteWorkerResponse } from '../workers/stabilitySuiteWorker'
import type { BuildPlan } from '../types/bricks'

type Props = {
  plan: BuildPlan
  projectId: string
  onInspect: (options: DisasterSimulationOptions) => void
}

const download = (name: string, content: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const scenarioLabel = (scenario: string, zh: boolean) => ({
  wind: zh ? '阵风' : 'Wind',
  rain: zh ? '暴雨' : 'Rain',
  earthquake: zh ? '地震' : 'Earthquake',
}[scenario] ?? scenario)

export const StabilitySuitePanel = ({ plan, projectId, onInspect }: Props) => {
  const { locale } = useI18n()
  const zh = locale === 'zh-CN'
  const initialConfig = useMemo(loadStabilitySuiteConfig, [])
  const [preset, setPreset] = useState<StabilitySuitePreset>(initialConfig.preset)
  const [physicsProfile, setPhysicsProfile] = useState<DisasterPhysicsProfile>(initialConfig.physicsProfile)
  const [result, setResult] = useState<StabilitySuiteResult | undefined>(() => loadStabilitySuiteResult(plan.id, projectId))
  const [progress, setProgress] = useState<{ completed: number; total: number }>()
  const [error, setError] = useState('')
  const workerRef = useRef<Worker>()
  const requestIdRef = useRef(0)
  const cases = getStabilitySuiteCases(preset, physicsProfile)
  const fingerprint = createPlanFingerprint(plan)
  const stale = Boolean(result && result.plan.fingerprint !== fingerprint)
  const weakest = result?.cases.find((item) => item.id === result.weakestCaseId)

  useEffect(() => {
    saveStabilitySuiteConfig({ preset, physicsProfile })
  }, [physicsProfile, preset])

  useEffect(() => () => workerRef.current?.terminate(), [])

  useEffect(() => {
    workerRef.current?.terminate()
    workerRef.current = undefined
    requestIdRef.current += 1
    setResult(loadStabilitySuiteResult(plan.id, projectId))
    setProgress(undefined)
    setError('')
  }, [plan.id, projectId])

  const runSuite = () => {
    workerRef.current?.terminate()
    const requestId = ++requestIdRef.current
    setProgress({ completed: 0, total: cases.length })
    setError('')
    try {
      const worker = new Worker(new URL('../workers/stabilitySuiteWorker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      worker.onmessage = (event: MessageEvent<StabilitySuiteWorkerResponse>) => {
        if (event.data.requestId !== requestIdRef.current) return
        if (event.data.type === 'progress') {
          setProgress({ completed: event.data.completed, total: event.data.total })
          return
        }
        worker.terminate()
        workerRef.current = undefined
        setProgress(undefined)
        if (event.data.type === 'error') {
          setError(event.data.message)
          return
        }
        setResult(saveStabilitySuiteResult(event.data.result, projectId))
      }
      worker.onerror = () => {
        if (requestId !== requestIdRef.current) return
        worker.terminate()
        workerRef.current = undefined
        setProgress(undefined)
        setError('STABILITY_SUITE_WORKER_FAILED')
      }
      worker.postMessage({
        type: 'run-suite',
        requestId,
        bricks: plan.bricks,
        plan: { id: plan.id, title: plan.title, brickCount: plan.bricks.length, fingerprint },
        preset,
        physicsProfile,
      })
    } catch (cause) {
      setProgress(undefined)
      setError(cause instanceof Error ? cause.message : 'STABILITY_SUITE_WORKER_FAILED')
    }
  }

  return (
    <section className="stability-suite-panel">
      <header>
        <div>
          <h3><FlaskConical size={16} />{zh ? '结构测试套件' : 'Structural test suite'}</h3>
          <p>{zh ? '批量验证多种灾害、强度和方向，自动找出最弱工况。' : 'Batch-test hazards, intensities, and directions to find the weakest case.'}</p>
        </div>
        {stale && <span className="suite-stale"><AlertTriangle size={13} />{zh ? '模型已变化' : 'Model changed'}</span>}
      </header>
      <div className="stability-suite-config">
        <label>
          <span>{zh ? '测试范围' : 'Test coverage'}</span>
          <select value={preset} onChange={(event) => setPreset(event.target.value as StabilitySuitePreset)} disabled={Boolean(progress)}>
            <option value="quick">{zh ? '快速 · 5 个工况' : 'Quick · 5 cases'}</option>
            <option value="standard">{zh ? '标准 · 10 个工况' : 'Standard · 10 cases'}</option>
            <option value="stress">{zh ? '极限 · 9 个工况' : 'Stress · 9 cases'}</option>
          </select>
        </label>
        <label>
          <span>{zh ? '物理档案' : 'Physics profile'}</span>
          <select value={physicsProfile} onChange={(event) => setPhysicsProfile(event.target.value as DisasterPhysicsProfile)} disabled={Boolean(progress)}>
            <option value="challenge">{zh ? '挑战模式' : 'Challenge'}</option>
            <option value="realistic">{zh ? '现实近似' : 'Realistic'}</option>
          </select>
        </label>
        <button type="button" className="primary" onClick={runSuite} disabled={Boolean(progress) || plan.bricks.length === 0}>
          {progress ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}
          {progress ? `${progress.completed}/${progress.total}` : (result ? (zh ? '重新测试' : 'Run again') : (zh ? '运行测试套件' : 'Run test suite'))}
        </button>
      </div>
      {progress && <div className="suite-progress" role="status"><i><b style={{ width: `${progress.total ? progress.completed / progress.total * 100 : 0}%` }} /></i><span>{zh ? `正在运行工况 ${progress.completed}/${progress.total}` : `Running case ${progress.completed}/${progress.total}`}</span></div>}
      {error && <p className="suite-error" role="alert">{zh ? '测试套件运行失败：' : 'Test suite failed: '}{error}</p>}
      {result && (
        <>
          <div className="suite-summary">
            <div><strong>{result.resilienceScore}</strong><span>{zh ? '综合韧性' : 'Resilience'}</span></div>
            <div><strong>{result.passedCaseCount}/{result.cases.length}</strong><span>{zh ? '通过工况' : 'Passing cases'}</span></div>
            <div><strong>{weakest ? `${scenarioLabel(weakest.scenario, zh)} ${weakest.score}` : '—'}</strong><span>{zh ? '最弱工况' : 'Weakest case'}</span></div>
          </div>
          <div className="suite-case-list">
            {result.cases.map((item) => (
              <button key={item.id} type="button" className={item.id === result.weakestCaseId ? 'weakest' : ''} onClick={() => onInspect(suiteCaseToOptions(item))}>
                <span>{scenarioLabel(item.scenario, zh)} · {item.intensity}% · {item.directionDegrees}°</span>
                <small>{item.survivedBrickCount}/{result.plan.brickCount} {zh ? '存活' : 'survived'}{item.primaryFailureMode ? ` · ${item.primaryFailureMode}` : ''}</small>
                <strong>{item.grade} · {item.score}</strong>
              </button>
            ))}
          </div>
          <footer>
            <span>{new Date(result.generatedAt).toLocaleString(locale)} · {result.preset} · {result.physicsProfile}</span>
            <div>
              {weakest && <button type="button" onClick={() => onInspect(suiteCaseToOptions(weakest))}><RotateCcw size={14} />{zh ? '复现最弱工况' : 'Replay weakest'}</button>}
              <button type="button" title={zh ? '导出测试套件 Markdown' : 'Export suite Markdown'} onClick={() => download(`${plan.title}-test-suite.md`, formatStabilitySuiteMarkdown(result, locale), 'text/markdown')}><Download size={14} />MD</button>
              <button type="button" title={zh ? '导出测试套件 JSON' : 'Export suite JSON'} onClick={() => download(`${plan.title}-test-suite.json`, JSON.stringify(result, null, 2), 'application/json')}><Download size={14} />JSON</button>
              <button type="button" title={zh ? '导出测试套件 SVG' : 'Export suite SVG'} onClick={() => download(`${plan.title}-test-suite.svg`, formatStabilitySuiteSvg(result, locale), 'image/svg+xml')}><Download size={14} />SVG</button>
            </div>
          </footer>
        </>
      )}
    </section>
  )
}
