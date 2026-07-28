import { ArrowLeft, ArrowRight, Bot, Copy, GitBranch, Plus, Trash2 } from 'lucide-react'
import type { WorldScenarioRuntime } from '../types/world'
import type { WorldScenarioValidationIssue } from '../lib/worldScenarioValidation'
import { getWorldScenarioDefaultNextStageId } from '../lib/worldScenarioAuthoring'

type Props = {
  scenario: WorldScenarioRuntime
  selectedStageId: string
  issues: WorldScenarioValidationIssue[]
  locale: 'zh-CN' | 'en-US'
  onSelectStage: (stageId: string) => void
  onAddStage: () => void
  onDuplicateStage: () => void
  onDeleteStage: () => void
  onMoveStage: (direction: -1 | 1) => void
}

const nodeWidth = 190
const nodeHeight = 106
const nodeGap = 70
const canvasPadding = 24
const nodeTop = 42
const triggerLabel = (type: string, zh: boolean) => ({
  interaction: zh ? '交谈完成' : 'Conversation completed',
  'command-complete': zh ? '命令完成' : 'Command completed',
  'command-issued': zh ? '命令下达' : 'Command issued',
  defeated: zh ? '单位被击败' : 'Entity defeated',
}[type] ?? type)

export const WorldScenarioFlowEditor = ({
  scenario,
  selectedStageId,
  issues,
  locale,
  onSelectStage,
  onAddStage,
  onDuplicateStage,
  onDeleteStage,
  onMoveStage,
}: Props) => {
  const zh = locale === 'zh-CN'
  const stageIndexById = new Map(scenario.stages.map((stage, index) => [stage.id, index]))
  const maxBranchCount = Math.max(0, ...scenario.stages.map((stage) => stage.branches?.length ?? 0))
  const canvasWidth = Math.max(620, canvasPadding * 2 + scenario.stages.length * nodeWidth + Math.max(0, scenario.stages.length - 1) * nodeGap)
  const canvasHeight = Math.max(250, nodeTop + nodeHeight + 78 + maxBranchCount * 28)
  const getNodePoint = (stageIndex: number) => ({
    x: canvasPadding + stageIndex * (nodeWidth + nodeGap),
    y: nodeTop,
  })
  const edges = scenario.stages.flatMap((stage, stageIndex) => {
    const defaultTargetId = getWorldScenarioDefaultNextStageId(scenario, stageIndex)
    return [
      ...(defaultTargetId ? [{ id: `${stage.id}:default`, sourceIndex: stageIndex, targetId: defaultTargetId, kind: 'default' as const, label: zh ? '继续' : 'Next', branchIndex: -1 }] : []),
      ...(stage.branches ?? []).map((branch, branchIndex) => ({
        id: `${stage.id}:branch:${branch.id}`,
        sourceIndex: stageIndex,
        targetId: branch.nextStageId,
        kind: 'branch' as const,
        label: branch.title,
        branchIndex,
      })),
    ]
  })
  const terminalEdges = edges.filter((edge) => edge.kind === 'branch' && !edge.targetId)
  const selectedIndex = Math.max(0, scenario.stages.findIndex((stage) => stage.id === selectedStageId))

  return (
    <section className="scenario-flow-editor" aria-label={zh ? '剧情流程图' : 'Scenario flowchart'}>
      <header>
        <div>
          <strong><GitBranch size={15} />{zh ? '剧情流程图' : 'Scenario flowchart'}</strong>
          <small>{zh ? '流程图控制触发和去向；AI 节点只生成对白或从紫色分支中选择。' : 'The graph controls triggers and outcomes; AI nodes only write dialogue or choose a purple branch.'}</small>
        </div>
        <div className="scenario-flow-actions">
          <button type="button" title={zh ? '向前移动节点' : 'Move node left'} disabled={selectedIndex <= 0} onClick={() => onMoveStage(-1)}><ArrowLeft size={13} /></button>
          <button type="button" title={zh ? '向后移动节点' : 'Move node right'} disabled={selectedIndex >= scenario.stages.length - 1} onClick={() => onMoveStage(1)}><ArrowRight size={13} /></button>
          <button type="button" onClick={onDuplicateStage} disabled={!selectedStageId}><Copy size={13} />{zh ? '复制' : 'Duplicate'}</button>
          <button type="button" className="danger" onClick={onDeleteStage} disabled={scenario.stages.length <= 1}><Trash2 size={13} />{zh ? '删除' : 'Delete'}</button>
          <button type="button" onClick={onAddStage}><Plus size={13} />{zh ? '新节点' : 'New node'}</button>
        </div>
      </header>
      <div className="scenario-flow-viewport">
        <div className="scenario-flow-canvas" style={{ width: canvasWidth, height: canvasHeight }}>
          <svg width={canvasWidth} height={canvasHeight} aria-hidden="true">
            <defs>
              <marker id="scenario-flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" />
              </marker>
              <marker id="scenario-flow-branch-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" />
              </marker>
            </defs>
            {edges.flatMap((edge) => {
              const targetIndex = edge.targetId ? stageIndexById.get(edge.targetId) : undefined
              const source = getNodePoint(edge.sourceIndex)
              if (targetIndex === undefined) {
                if (edge.kind !== 'branch') return []
                const terminalX = source.x + 12
                const terminalY = nodeTop + nodeHeight + 36 + edge.branchIndex * 28
                return <path
                  key={edge.id}
                  className="branch"
                  d={`M ${source.x + nodeWidth / 2} ${source.y + nodeHeight} C ${source.x + nodeWidth / 2} ${terminalY}, ${terminalX - 20} ${terminalY}, ${terminalX} ${terminalY}`}
                  markerEnd="url(#scenario-flow-branch-arrow)"
                />
              }
              const target = getNodePoint(targetIndex)
              const sourceX = source.x + nodeWidth
              const sourceY = source.y + 46 + (edge.kind === 'branch' ? 20 : 0)
              const targetX = target.x
              const targetY = target.y + 46
              const bendsBackward = targetIndex <= edge.sourceIndex
              const laneY = nodeTop + nodeHeight + 36 + Math.max(0, edge.branchIndex) * 12
              const path = bendsBackward
                ? `M ${sourceX} ${sourceY} C ${sourceX + 34} ${laneY}, ${targetX - 34} ${laneY}, ${targetX} ${targetY}`
                : `M ${sourceX} ${sourceY} C ${sourceX + nodeGap * 0.55} ${sourceY}, ${targetX - nodeGap * 0.55} ${targetY}, ${targetX} ${targetY}`
              return <path key={edge.id} className={edge.kind} d={path} markerEnd={`url(#scenario-flow-${edge.kind === 'branch' ? 'branch-' : ''}arrow)`} />
            })}
          </svg>
          {scenario.stages.map((stage, stageIndex) => {
            const point = getNodePoint(stageIndex)
            const stageIssues = issues.filter((issue) => issue.stageIndex === stageIndex)
            return (
              <button
                type="button"
                id={`scenario-flow-stage-${stageIndex}`}
                key={`${stage.id}-${stageIndex}`}
                className={`scenario-flow-node ${stage.status}${stage.ai ? ' ai' : ''}${stage.id === selectedStageId ? ' selected' : ''}${stageIssues.some((issue) => issue.severity === 'error') ? ' has-errors' : ''}`}
                style={{ left: point.x, top: point.y, width: nodeWidth, height: nodeHeight }}
                onClick={() => onSelectStage(stage.id)}
                aria-pressed={stage.id === selectedStageId}
              >
                <span>{stageIndex + 1}</span>
                <strong>{stage.title}</strong>
                <small>{stage.description}</small>
                <em>{stage.ai
                  ? `${stage.ai.mode === 'choice' ? (zh ? 'AI 抉择' : 'AI choice') : (zh ? 'AI 对白' : 'AI dialogue')} · `
                  : ''}{triggerLabel(stage.trigger.eventType, zh)} · {stage.dialogue?.length ?? 0} {zh ? '句台词' : 'lines'} · {stage.branches?.length ?? 0} {zh ? '个分支' : 'branches'}</em>
                {stage.ai && <b className="ai-badge"><Bot size={9} />AI</b>}
                {stageIssues.length > 0 && <i>{stageIssues.length}</i>}
              </button>
            )
          })}
          {terminalEdges.map((edge) => {
            const source = getNodePoint(edge.sourceIndex)
            return (
              <span
                className="scenario-flow-terminal"
                key={`${edge.id}:terminal`}
                style={{ left: source.x + 12, top: nodeTop + nodeHeight + 24 + edge.branchIndex * 28 }}
              >
                {edge.label} → {zh ? '结束流程' : 'End flow'}
              </span>
            )
          })}
        </div>
      </div>
    </section>
  )
}
