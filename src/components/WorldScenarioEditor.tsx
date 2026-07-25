import { Plus, Trash2 } from 'lucide-react'
import type { WorldEntity, WorldEntityCommand, WorldEvent, WorldScenarioAction, WorldScenarioRuntime, WorldScenarioStage } from '../types/world'
import type { BrickStructure } from '../types/bricks'
import { validateWorldScenario, type WorldScenarioValidationIssue } from '../lib/worldScenarioValidation'

type Props = {
  scenario: WorldScenarioRuntime
  entities: WorldEntity[]
  structures: BrickStructure[]
  hiddenTargets: Array<{ kind: 'entity' | 'brick' | 'structure'; id: string }>
  locale: 'zh-CN' | 'en-US'
  onChange: (scenario: WorldScenarioRuntime) => void
  onSetTargetVisibility: (target: { kind: 'entity' | 'brick' | 'structure'; id: string }, visible: boolean) => void
}

const triggerTypes: WorldEvent['type'][] = ['interaction', 'command-complete', 'command-issued', 'defeated']
const commandTypes: WorldEntityCommand['type'][] = ['attack', 'interact', 'follow', 'guard', 'move', 'revive', 'wander', 'stop']
const factions = ['blue', 'red', 'neutral']

const makeCommand = (type: WorldEntityCommand['type'], targetId?: string): WorldEntityCommand => {
  if (type === 'stop' || type === 'wander') return { type }
  const target = { kind: 'entity' as const, id: targetId ?? '' }
  if (type === 'attack') return { type, target }
  if (type === 'revive' || type === 'follow') return { type, target }
  if (type === 'patrol') return { type, waypointIds: [] }
  return { type, target }
}

const getCommandTargetId = (command: WorldEntityCommand) => 'target' in command && command.target.kind === 'entity'
  ? command.target.id
  : ''

export const WorldScenarioEditor = ({ scenario, entities, structures, hiddenTargets, locale, onChange, onSetTargetVisibility }: Props) => {
  const zh = locale === 'zh-CN'
  const patchScenario = (patch: Partial<WorldScenarioRuntime>) => onChange({ ...scenario, ...patch, authoringVersion: 2 })
  const patchStage = (stageIndex: number, patch: Partial<WorldScenarioStage>) => patchScenario({
    stages: scenario.stages.map((stage, index) => index === stageIndex ? { ...stage, ...patch } : stage),
  })
  const firstEntityId = entities[0]?.id ?? ''
  const hiddenTargetKeys = new Set(hiddenTargets.map((target) => `${target.kind}:${target.id}`))
  const validationIssues = validateWorldScenario(scenario, {
    entityIds: entities.map((entity) => entity.id),
    structureIds: structures.map((structure) => structure.id),
  })
  const validationErrorCount = validationIssues.filter((issue) => issue.severity === 'error').length

  return (
    <div className="scenario-editor">
      <div className="scenario-editor-grid">
        <label>{zh ? '剧情名称' : 'Scenario title'}<input value={scenario.title} onChange={(event) => patchScenario({ title: event.target.value })} /></label>
        <label>{zh ? '剧情简介' : 'Description'}<input value={scenario.description} onChange={(event) => patchScenario({ description: event.target.value })} /></label>
      </div>
      <section className={`scenario-validation-summary${validationErrorCount > 0 ? ' has-errors' : ''}`} aria-live="polite">
        <header>
          <strong>{validationIssues.length === 0
            ? (zh ? '剧情结构检查通过' : 'Scenario structure is valid')
            : (zh ? `发现 ${validationIssues.length} 个创作问题` : `${validationIssues.length} authoring issue(s)`)}</strong>
          {validationIssues.length > 0 && <small>{zh ? `${validationErrorCount} 个错误 · ${validationIssues.length - validationErrorCount} 个提醒` : `${validationErrorCount} error(s) · ${validationIssues.length - validationErrorCount} warning(s)`}</small>}
        </header>
        {validationIssues.length > 0 && (
          <ol>
            {validationIssues.map((issue, issueIndex) => (
              <li className={issue.severity} key={`${issue.code}-${issue.stageIndex ?? 'scenario'}-${issue.branchIndex ?? ''}-${issue.referenceId ?? ''}-${issueIndex}`}>
                {issue.stageIndex === undefined
                  ? <span>{formatValidationIssue(issue, scenario, zh)}</span>
                  : <a href={`#scenario-stage-${issue.stageIndex}`}>{formatValidationIssue(issue, scenario, zh)}</a>}
              </li>
            ))}
          </ol>
        )}
      </section>
      <div className="scenario-editor-section scenario-revealables">
        <header><strong>{zh ? '登场对象' : 'Revealable objects'}</strong><small>{zh ? '隐藏对象在游玩时不显示、不碰撞、也不会执行 AI；可用场景上方的“显影”按钮查看和编辑幽灵。' : 'Hidden objects do not render, collide, or run AI during play. Use Reveal above the scene to edit their ghosts.'}</small></header>
        <div>
          {entities.map((entity) => {
            const hidden = hiddenTargetKeys.has(`entity:${entity.id}`)
            return <button type="button" className={hidden ? 'hidden' : ''} key={entity.id} onClick={() => onSetTargetVisibility({ kind: 'entity', id: entity.id }, hidden)}>{entity.name}<small>{hidden ? (zh ? '隐藏' : 'Hidden') : (zh ? '显示' : 'Visible')}</small></button>
          })}
          {structures.map((structure) => {
            const hidden = hiddenTargetKeys.has(`structure:${structure.id}`)
            return <button type="button" className={hidden ? 'hidden' : ''} key={structure.id} onClick={() => onSetTargetVisibility({ kind: 'structure', id: structure.id }, hidden)}>{structure.name}<small>{hidden ? (zh ? '隐藏建筑' : 'Hidden structure') : (zh ? '显示建筑' : 'Visible structure')} · #{structure.id.slice(-5)}</small></button>
          })}
        </div>
      </div>
      {scenario.stages.map((stage, stageIndex) => (
        <details id={`scenario-stage-${stageIndex}`} key={`${stage.id}-${stageIndex}`} open={stage.status === 'active'}>
          <summary>{stageIndex + 1}. {stage.title} · {zh ? ({ locked: '未解锁', active: '当前阶段', completed: '已完成' }[stage.status]) : stage.status}</summary>
          <div className="scenario-stage-editor">
            <div className="scenario-editor-grid">
              <label>{zh ? '阶段名称' : 'Stage title'}<input value={stage.title} onChange={(event) => patchStage(stageIndex, { title: event.target.value })} /></label>
              <label>{zh ? '玩家目标' : 'Objective'}<input value={stage.description} onChange={(event) => patchStage(stageIndex, { description: event.target.value })} /></label>
              <label>{zh ? '触发事件' : 'Trigger event'}
                <select value={stage.trigger.eventType} onChange={(event) => patchStage(stageIndex, { trigger: { ...stage.trigger, eventType: event.target.value as WorldEvent['type'] } })}>
                  {triggerTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <label>{zh ? '发起者' : 'Actor'}
                <select value={stage.trigger.actorId ?? ''} onChange={(event) => patchStage(stageIndex, { trigger: { ...stage.trigger, actorId: event.target.value || undefined } })}>
                  <option value="">{zh ? '任意单位' : 'Any entity'}</option>
                  {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
                </select>
              </label>
              <label>{zh ? '目标' : 'Target'}
                <select value={stage.trigger.targetId ?? ''} onChange={(event) => patchStage(stageIndex, { trigger: { ...stage.trigger, targetId: event.target.value || undefined } })}>
                  <option value="">{zh ? '任意目标' : 'Any target'}</option>
                  {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
                </select>
              </label>
            </div>

            <div className="scenario-editor-section">
              <header><strong>{zh ? '演出台词' : 'Dialogue performance'}</strong><small>{zh ? '按顺序冒泡，全部结束后才执行后续行为。' : 'Lines play in order; actions run only after the final line.'}</small></header>
              {(stage.dialogue ?? []).map((line, lineIndex) => (
                <div className="scenario-dialogue-row" key={line.id}>
                  <span>{lineIndex + 1}</span>
                  <select value={line.speakerId} onChange={(event) => patchStage(stageIndex, { dialogue: stage.dialogue?.map((item, index) => index === lineIndex ? { ...item, speakerId: event.target.value } : item) })}>
                    {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
                  </select>
                  <textarea rows={2} value={line.text} onChange={(event) => patchStage(stageIndex, { dialogue: stage.dialogue?.map((item, index) => index === lineIndex ? { ...item, text: event.target.value } : item) })} />
                  <label><input type="number" min="0.5" max="30" step="0.5" value={line.durationSeconds} onChange={(event) => patchStage(stageIndex, { dialogue: stage.dialogue?.map((item, index) => index === lineIndex ? { ...item, durationSeconds: Math.max(0.5, Number(event.target.value) || 0.5) } : item) })} />{zh ? '秒' : 'sec'}</label>
                  <button type="button" className="icon-button" title={zh ? '删除台词' : 'Delete line'} onClick={() => patchStage(stageIndex, { dialogue: stage.dialogue?.filter((_, index) => index !== lineIndex) })}><Trash2 size={14} /></button>
                </div>
              ))}
              <button type="button" onClick={() => patchStage(stageIndex, { dialogue: [...(stage.dialogue ?? []), { id: `dialogue-${Date.now()}`, speakerId: stage.trigger.actorId ?? firstEntityId, text: zh ? '输入台词……' : 'Enter dialogue…', durationSeconds: 4 }] })}><Plus size={14} />{zh ? '添加台词' : 'Add line'}</button>
            </div>

            <div className="scenario-editor-section">
              <header><strong>{zh ? '对话后的行为' : 'Actions after dialogue'}</strong><small>{zh ? '可以改变阵营、下达命令或写入新章节。' : 'Change factions, issue orders, or add a chapter.'}</small></header>
              {(stage.actions ?? []).map((action, actionIndex) => (
                <div className="scenario-action-row" key={`${action.type}-${actionIndex}`}>
                  <strong>{action.type}</strong>
                  {action.type === 'set-faction' && <>
                    <select value={action.entityId} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, entityId: event.target.value } : item) })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
                    <select value={action.factionId} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, factionId: event.target.value } : item) })}>{factions.map((faction) => <option key={faction} value={faction}>{faction}</option>)}</select>
                  </>}
                  {action.type === 'set-visibility' && <>
                    <select value={action.target.kind} onChange={(event) => {
                      const kind = event.target.value as 'entity' | 'structure'
                      const id = kind === 'entity' ? firstEntityId : structures[0]?.id ?? ''
                      patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, target: { kind, id } } : item) })
                    }}><option value="entity">{zh ? '单位' : 'Entity'}</option><option value="structure">{zh ? '建筑' : 'Structure'}</option></select>
                    <select value={action.target.id} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, target: { ...action.target, id: event.target.value } } : item) })}>
                      {(action.target.kind === 'entity' ? entities : structures).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <select value={action.visible ? 'show' : 'hide'} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, visible: event.target.value === 'show' } : item) })}><option value="show">{zh ? '显示登场' : 'Reveal'}</option><option value="hide">{zh ? '隐藏退场' : 'Hide'}</option></select>
                  </>}
                  {action.type === 'issue-command' && <>
                    <select value={action.entityId} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, entityId: event.target.value } : item) })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
                    <select value={action.command.type} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, command: makeCommand(event.target.value as WorldEntityCommand['type'], getCommandTargetId(action.command) || firstEntityId) } : item) })}>{commandTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>
                    {'target' in action.command && <select value={getCommandTargetId(action.command)} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, command: makeCommand(action.command.type, event.target.value) } : item) })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>}
                  </>}
                  {action.type === 'add-story' && <>
                    <input value={action.title} placeholder={zh ? '章节标题' : 'Chapter title'} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, title: event.target.value } : item) })} />
                    <textarea rows={2} value={action.body} placeholder={zh ? '章节内容' : 'Chapter body'} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, body: event.target.value } : item) })} />
                  </>}
                  <button type="button" className="icon-button" title={zh ? '删除行为' : 'Delete action'} onClick={() => patchStage(stageIndex, { actions: stage.actions?.filter((_, index) => index !== actionIndex) })}><Trash2 size={14} /></button>
                </div>
              ))}
              <div className="scenario-add-actions">
                <button type="button" onClick={() => addAction(stageIndex, { type: 'set-faction', entityId: firstEntityId, factionId: 'red' })}><Plus size={13} />{zh ? '阵营变化' : 'Faction'}</button>
                <button type="button" onClick={() => addAction(stageIndex, { type: 'issue-command', entityId: firstEntityId, command: { type: 'wander' } })}><Plus size={13} />{zh ? '单位命令' : 'Command'}</button>
                <button type="button" onClick={() => addAction(stageIndex, { type: 'add-story', title: zh ? '新章节' : 'New chapter', body: '' })}><Plus size={13} />{zh ? '故事章节' : 'Chapter'}</button>
                <button type="button" disabled={!firstEntityId} onClick={() => addAction(stageIndex, { type: 'set-visibility', target: { kind: 'entity', id: firstEntityId }, visible: true })}><Plus size={13} />{zh ? '显示/隐藏' : 'Visibility'}</button>
              </div>
            </div>

            <div className="scenario-editor-section">
              <header><strong>{zh ? '分支结果' : 'Branch outcomes'}</strong><small>{zh ? '分支命中后会替代上面的默认结果；不选择下一阶段表示在此结局。' : 'A matched branch replaces the default result. No next stage means the storyline ends here.'}</small></header>
              {(stage.branches ?? []).map((branch, branchIndex) => (
                <div className="scenario-branch-card" key={branch.id}>
                  <input value={branch.title} aria-label={zh ? '分支名称' : 'Branch name'} onChange={(event) => patchStage(stageIndex, { branches: stage.branches?.map((item, index) => index === branchIndex ? { ...item, title: event.target.value } : item) })} />
                  <select value={branch.trigger.eventType} aria-label={zh ? '分支触发事件' : 'Branch trigger'} onChange={(event) => patchStage(stageIndex, { branches: stage.branches?.map((item, index) => index === branchIndex ? { ...item, trigger: { ...item.trigger, eventType: event.target.value as WorldEvent['type'] } } : item) })}>{triggerTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>
                  <select value={branch.trigger.actorId ?? ''} aria-label={zh ? '分支发起者' : 'Branch actor'} onChange={(event) => patchStage(stageIndex, { branches: stage.branches?.map((item, index) => index === branchIndex ? { ...item, trigger: { ...item.trigger, actorId: event.target.value || undefined } } : item) })}>
                    <option value="">{zh ? '任意发起者' : 'Any actor'}</option>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
                  </select>
                  <select value={branch.trigger.targetId ?? ''} aria-label={zh ? '分支目标' : 'Branch target'} onChange={(event) => patchStage(stageIndex, { branches: stage.branches?.map((item, index) => index === branchIndex ? { ...item, trigger: { ...item.trigger, targetId: event.target.value || undefined } } : item) })}>
                    <option value="">{zh ? '任意目标' : 'Any target'}</option>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
                  </select>
                  <select value={branch.nextStageId ?? ''} aria-label={zh ? '分支下一阶段' : 'Branch next stage'} onChange={(event) => patchStage(stageIndex, { branches: stage.branches?.map((item, index) => index === branchIndex ? { ...item, nextStageId: event.target.value || undefined } : item) })}>
                    <option value="">{zh ? '结束剧情线' : 'End storyline'}</option>{scenario.stages.filter((candidate) => candidate.id !== stage.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
                  </select>
                  <small>{zh ? `后续行为 ${branch.actions?.length ?? 0} 个 · 台词 ${branch.dialogue?.length ?? 0} 句` : `${branch.actions?.length ?? 0} actions · ${branch.dialogue?.length ?? 0} lines`}</small>
                  <button type="button" className="icon-button" title={zh ? '删除分支' : 'Delete branch'} onClick={() => patchStage(stageIndex, { branches: stage.branches?.filter((_, index) => index !== branchIndex) })}><Trash2 size={14} /></button>
                </div>
              ))}
              <button type="button" onClick={() => patchStage(stageIndex, { branches: [...(stage.branches ?? []), { id: `branch-${Date.now()}`, title: zh ? '新分支' : 'New branch', trigger: { eventType: 'interaction' }, actions: [] }] })}><Plus size={14} />{zh ? '添加分支' : 'Add branch'}</button>
            </div>
          </div>
        </details>
      ))}
    </div>
  )

  function addAction(stageIndex: number, action: WorldScenarioAction) {
    patchStage(stageIndex, { actions: [...(scenario.stages[stageIndex]?.actions ?? []), action] })
  }
}

const formatValidationIssue = (
  issue: WorldScenarioValidationIssue,
  scenario: WorldScenarioRuntime,
  zh: boolean,
) => {
  const stageTitle = issue.stageIndex === undefined
    ? ''
    : scenario.stages[issue.stageIndex]?.title || `${zh ? '阶段' : 'Stage'} ${issue.stageIndex + 1}`
  const location = stageTitle ? `${stageTitle}：` : ''
  const reference = issue.referenceId ? `“${issue.referenceId}”` : ''
  const messages: Record<WorldScenarioValidationIssue['code'], string> = zh ? {
    'duplicate-stage-id': `阶段 ID ${reference} 重复`,
    'duplicate-branch-id': `分支 ID ${reference} 重复`,
    'missing-stage': `找不到下一阶段 ${reference}`,
    'unreachable-stage': '无法从第一阶段到达',
    'cyclic-stage-flow': '剧情跳转形成循环，运行时无法重新激活已完成阶段',
    'missing-entity': `引用的单位 ${reference} 不存在`,
    'missing-structure': `引用的建筑 ${reference} 不存在`,
    'invalid-dialogue': '台词为空或显示时间不足 0.5 秒',
  } : {
    'duplicate-stage-id': `Duplicate stage ID ${reference}`,
    'duplicate-branch-id': `Duplicate branch ID ${reference}`,
    'missing-stage': `Next stage ${reference} does not exist`,
    'unreachable-stage': 'Cannot be reached from the first stage',
    'cyclic-stage-flow': 'Stage flow contains a cycle; completed stages cannot reactivate',
    'missing-entity': `Referenced entity ${reference} does not exist`,
    'missing-structure': `Referenced structure ${reference} does not exist`,
    'invalid-dialogue': 'Dialogue is empty or shorter than 0.5 seconds',
  }
  return `${location}${messages[issue.code]}`
}
