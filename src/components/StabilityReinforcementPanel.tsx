import { AlertTriangle, Check, Eye, Hammer, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DisasterSimulationOptions } from '../lib/disasterSimulation'
import { useI18n } from '../lib/i18n'
import { createPlanFingerprint } from '../lib/stabilityHistory'
import type { ReinforcementProposal } from '../lib/stabilityReinforcement'
import type { InventoryOverrides } from '../lib/userInventory'
import type { StabilityReinforcementWorkerResponse } from '../workers/stabilityReinforcementWorker'
import type { BuildPlan, PlacedBrick } from '../types/bricks'

type Props = {
  plan: BuildPlan
  options: DisasterSimulationOptions
  inventoryOverrides: InventoryOverrides
  onPreview: (bricks: PlacedBrick[]) => void
  onApply: (proposal: ReinforcementProposal) => void
}

const optionsKey = (options: DisasterSimulationOptions) => [
  options.scenario,
  options.intensity,
  options.directionDegrees ?? 0,
  options.physicsProfile ?? 'challenge',
].join(':')

export const StabilityReinforcementPanel = ({ plan, options, inventoryOverrides, onPreview, onApply }: Props) => {
  const { locale } = useI18n()
  const zh = locale === 'zh-CN'
  const [proposals, setProposals] = useState<ReinforcementProposal[]>([])
  const [sourceKey, setSourceKey] = useState('')
  const [previewId, setPreviewId] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const workerRef = useRef<Worker>()
  const requestIdRef = useRef(0)
  const currentKey = `${createPlanFingerprint(plan)}:${optionsKey(options)}`
  const stale = Boolean(proposals.length > 0 && sourceKey !== currentKey)
  const usefulProposals = useMemo(
    () => proposals.filter((proposal) => proposal.scoreDelta > 0 || proposal.failureReduction > 0),
    [proposals],
  )

  useEffect(() => () => {
    workerRef.current?.terminate()
    onPreview([])
  }, [onPreview])

  useEffect(() => {
    setPreviewId('')
    onPreview([])
  }, [currentKey, onPreview])

  const analyze = () => {
    workerRef.current?.terminate()
    const requestId = ++requestIdRef.current
    setIsAnalyzing(true)
    setError('')
    setPreviewId('')
    onPreview([])
    try {
      const worker = new Worker(new URL('../workers/stabilityReinforcementWorker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      worker.onmessage = (event: MessageEvent<StabilityReinforcementWorkerResponse>) => {
        if (event.data.requestId !== requestIdRef.current) return
        worker.terminate()
        workerRef.current = undefined
        setIsAnalyzing(false)
        if (event.data.type === 'error') {
          setError(event.data.message)
          return
        }
        setProposals(event.data.proposals)
        setSourceKey(currentKey)
      }
      worker.onerror = () => {
        if (requestId !== requestIdRef.current) return
        worker.terminate()
        workerRef.current = undefined
        setIsAnalyzing(false)
        setError('REINFORCEMENT_WORKER_FAILED')
      }
      worker.postMessage({ type: 'analyze-reinforcement', requestId, plan, inventoryOverrides, options })
    } catch (cause) {
      setIsAnalyzing(false)
      setError(cause instanceof Error ? cause.message : 'REINFORCEMENT_WORKER_FAILED')
    }
  }

  const togglePreview = (proposal: ReinforcementProposal) => {
    const nextId = previewId === proposal.id ? '' : proposal.id
    setPreviewId(nextId)
    onPreview(nextId ? proposal.addedBricks : [])
  }

  return (
    <section className="stability-reinforcement-panel">
      <header>
        <div>
          <h3><Hammer size={16} />{zh ? '确定性加固建议' : 'Deterministic reinforcement'}</h3>
          <p>{zh ? '用当前工况重跑候选方案，只推荐无碰撞、库存允许且实际改善结果的支撑柱。' : 'Re-run the active case and recommend only collision-free, inventory-safe support columns that improve the result.'}</p>
        </div>
        {stale && <span><AlertTriangle size={13} />{zh ? '工况或模型已变化' : 'Case or model changed'}</span>}
      </header>
      <button type="button" className="reinforcement-analyze primary" onClick={analyze} disabled={isAnalyzing || plan.bricks.length === 0}>
        {isAnalyzing ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
        {isAnalyzing ? (zh ? '正在生成并验证…' : 'Generating and validating…') : proposals.length ? (zh ? '重新生成建议' : 'Regenerate proposals') : (zh ? '生成加固建议' : 'Generate reinforcement proposals')}
      </button>
      {error && <p className="reinforcement-error" role="alert">{zh ? '加固分析失败：' : 'Reinforcement analysis failed: '}{error}</p>}
      {!isAnalyzing && sourceKey === currentKey && proposals.length === 0 && !error && (
        <p className="reinforcement-empty">{zh ? '当前模型没有可安全自动添加的支撑柱。可以手动调整结构后重新分析。' : 'No support column can be added safely. Adjust the structure manually and analyze again.'}</p>
      )}
      {!isAnalyzing && sourceKey === currentKey && proposals.length > 0 && usefulProposals.length === 0 && (
        <p className="reinforcement-empty">{zh ? '找到了合法候选，但当前工况下没有候选带来可测量的改善，因此不会建议应用。' : 'Valid candidates were found, but none measurably improve this case, so applying them is not recommended.'}</p>
      )}
      {usefulProposals.length > 0 && (
        <div className="reinforcement-proposals">
          {usefulProposals.slice(0, 3).map((proposal, index) => (
            <article key={proposal.id} className={previewId === proposal.id ? 'previewing' : ''}>
              <header>
                <div><strong>{zh ? `方案 ${index + 1} · ${proposal.columnCount} 根支撑柱` : `Option ${index + 1} · ${proposal.columnCount} support column${proposal.columnCount > 1 ? 's' : ''}`}</strong><small>{proposal.addedBricks.length} {zh ? '个零件' : 'parts'}</small></div>
                <b className={proposal.scoreDelta > 0 ? 'improved' : ''}>{proposal.scoreDelta > 0 ? '+' : ''}{proposal.scoreDelta}</b>
              </header>
              <div className="reinforcement-metrics">
                <span>{zh ? '工况得分' : 'Case score'} <b>{proposal.beforeScore} → {proposal.afterScore}</b></span>
                <span>{zh ? '失效零件' : 'Failed parts'} <b>{proposal.beforeFailedBrickCount} → {proposal.afterFailedBrickCount}</b></span>
              </div>
              <footer>
                <button type="button" disabled={stale} className={previewId === proposal.id ? 'active' : ''} onClick={() => togglePreview(proposal)}><Eye size={14} />{previewId === proposal.id ? (zh ? '取消预览' : 'Hide preview') : (zh ? '预览' : 'Preview')}</button>
                <button type="button" disabled={stale} onClick={() => {
                  onApply(proposal)
                  setPreviewId('')
                  onPreview([])
                }}><Check size={14} />{zh ? '应用加固' : 'Apply reinforcement'}</button>
              </footer>
            </article>
          ))}
        </div>
      )}
      {previewId && <p className="reinforcement-preview-note"><RotateCcw size={12} />{zh ? '半透明零件是预览；应用后可使用全局撤销恢复。' : 'Translucent parts are a preview; use global Undo after applying to restore the model.'}</p>}
    </section>
  )
}
