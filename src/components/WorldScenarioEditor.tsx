import { Bot, GitBranch, ListTree, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WorldEntity, WorldEntityCommand, WorldEvent, WorldScenarioAction, WorldScenarioBranch, WorldScenarioCondition, WorldScenarioConditionGroup, WorldScenarioRuntime, WorldScenarioStage } from '../types/world'
import type { BrickStructure, PlacedBrick } from '../types/bricks'
import { getVoxelInteractionKind } from '../lib/voxelBlockState'
import { validateWorldScenario, type WorldScenarioValidationIssue } from '../lib/worldScenarioValidation'
import {
  addWorldScenarioStage,
  deleteWorldScenarioStage,
  duplicateWorldScenarioStage,
  moveWorldScenarioStage,
  updateWorldScenarioStageTransition,
} from '../lib/worldScenarioAuthoring'
import { WorldScenarioFlowEditor } from './WorldScenarioFlowEditor'

type Props = {
  scenario: WorldScenarioRuntime
  entities: WorldEntity[]
  structures: BrickStructure[]
  bricks: PlacedBrick[]
  hiddenTargets: Array<{ kind: 'entity' | 'brick' | 'structure'; id: string }>
  llmConfigured: boolean
  locale: 'zh-CN' | 'en-US'
  onChange: (scenario: WorldScenarioRuntime) => void
  onSetTargetVisibility: (target: { kind: 'entity' | 'brick' | 'structure'; id: string }, visible: boolean) => void
}

const triggerTypes: WorldEvent['type'][] = ['interaction', 'command-complete', 'command-issued', 'defeated']
const commandTypes: WorldEntityCommand['type'][] = ['attack', 'interact', 'follow', 'guard', 'move', 'revive', 'wander', 'stop']
const factions = ['blue', 'red', 'neutral']
const triggerLabel = (type: WorldEvent['type'], zh: boolean) => ({
  interaction: zh ? '交谈完成' : 'Conversation completed',
  'command-complete': zh ? '命令完成' : 'Command completed',
  'command-issued': zh ? '命令下达' : 'Command issued',
  defeated: zh ? '单位被击败' : 'Entity defeated',
}[type] ?? type)
const commandLabel = (type: WorldEntityCommand['type'], zh: boolean) => ({
  attack: zh ? '攻击' : 'Attack',
  interact: zh ? '交谈' : 'Talk',
  follow: zh ? '跟随' : 'Follow',
  guard: zh ? '守卫' : 'Guard',
  move: zh ? '移动' : 'Move',
  revive: zh ? '复活' : 'Revive',
  wander: zh ? '闲逛' : 'Wander',
  stop: zh ? '停止' : 'Stop',
}[type] ?? type)

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

const makeCondition = (
  type: WorldScenarioCondition['type'],
  firstEntityId: string,
  secondEntityId: string,
  firstStructureId: string,
): WorldScenarioCondition => {
  if (type === 'affinity') return { type, actorId: firstEntityId, targetId: secondEntityId || firstEntityId, comparison: 'gte', value: 45 }
  if (type === 'health-ratio') return { type, entityId: firstEntityId, comparison: 'lte', value: 0.4 }
  if (type === 'faction') return { type, entityId: firstEntityId, factionId: 'blue' }
  if (type === 'party-member') return { type, entityId: firstEntityId, status: 'active' }
  if (type === 'clue') return { type, entityId: firstEntityId, clueId: '', minimumConfidence: 0.5 }
  if (type === 'scenario-outcome') return { type, scenarioId: '' }
  if (type === 'visibility') return { type, target: firstStructureId ? { kind: 'structure', id: firstStructureId } : { kind: 'entity', id: firstEntityId }, visible: true }
  return { type, entityId: firstEntityId, alive: true }
}

const ScenarioConditionEditor = ({
  group,
  entities,
  structures,
  zh,
  onChange,
}: {
  group?: WorldScenarioConditionGroup
  entities: WorldEntity[]
  structures: BrickStructure[]
  zh: boolean
  onChange: (group: WorldScenarioConditionGroup | undefined) => void
}) => {
  const firstEntityId = entities[0]?.id ?? ''
  const secondEntityId = entities[1]?.id ?? firstEntityId
  const firstStructureId = structures[0]?.id ?? ''
  const conditions = group?.conditions ?? []
  const patchCondition = (index: number, condition: WorldScenarioCondition) => onChange({
    mode: group?.mode ?? 'all',
    ...(group?.negate ? { negate: true } : {}),
    conditions: conditions.map((item, itemIndex) => itemIndex === index ? condition : item),
  })
  return (
    <details className="scenario-condition-editor" open={conditions.length > 0}>
      <summary>{zh ? `组合条件（${conditions.length}）` : `Combined conditions (${conditions.length})`}</summary>
      <div className="scenario-condition-toolbar">
        <select value={group?.mode ?? 'all'} onChange={(event) => onChange({
          mode: event.target.value as 'all' | 'any',
          ...(group?.negate ? { negate: true } : {}),
          conditions,
        })}>
          <option value="all">{zh ? '全部满足' : 'Match all'}</option>
          <option value="any">{zh ? '任一满足' : 'Match any'}</option>
        </select>
        <label><input type="checkbox" checked={group?.negate ?? false} onChange={(event) => onChange({ mode: group?.mode ?? 'all', negate: event.target.checked || undefined, conditions })} />{zh ? '结果取反' : 'Negate'}</label>
      </div>
      {conditions.map((condition, index) => (
        <div className="scenario-condition-row" key={`${condition.type}-${index}`}>
          <select value={condition.type} onChange={(event) => patchCondition(index, makeCondition(event.target.value as WorldScenarioCondition['type'], firstEntityId, secondEntityId, firstStructureId))}>
            <option value="affinity">{zh ? '角色好感' : 'Affinity'}</option>
            <option value="health-ratio">{zh ? '生命比例' : 'Health ratio'}</option>
            <option value="faction">{zh ? '所属阵营' : 'Faction'}</option>
            <option value="party-member">{zh ? '队伍成员' : 'Party member'}</option>
            <option value="clue">{zh ? '持有线索' : 'Known clue'}</option>
            <option value="entity-alive">{zh ? '存活状态' : 'Alive state'}</option>
            <option value="visibility">{zh ? '显隐状态' : 'Visibility'}</option>
            <option value="scenario-outcome">{zh ? '流程结果' : 'Flow outcome'}</option>
          </select>
          {condition.type === 'affinity' && <>
            <select value={condition.actorId} onChange={(event) => patchCondition(index, { ...condition, actorId: event.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
            <select value={condition.targetId} onChange={(event) => patchCondition(index, { ...condition, targetId: event.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
            <select value={condition.comparison} onChange={(event) => patchCondition(index, { ...condition, comparison: event.target.value as 'gte' | 'lte' })}><option value="gte">≥</option><option value="lte">≤</option></select>
            <input type="number" min="-100" max="100" value={condition.value} onChange={(event) => patchCondition(index, { ...condition, value: Math.max(-100, Math.min(100, Number(event.target.value) || 0)) })} />
          </>}
          {condition.type === 'health-ratio' && <>
            <select value={condition.entityId} onChange={(event) => patchCondition(index, { ...condition, entityId: event.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
            <select value={condition.comparison} onChange={(event) => patchCondition(index, { ...condition, comparison: event.target.value as 'gte' | 'lte' })}><option value="gte">≥</option><option value="lte">≤</option></select>
            <input type="number" min="0" max="1" step="0.05" value={condition.value} onChange={(event) => patchCondition(index, { ...condition, value: Math.max(0, Math.min(1, Number(event.target.value) || 0)) })} />
          </>}
          {(condition.type === 'faction' || condition.type === 'party-member' || condition.type === 'entity-alive' || condition.type === 'clue') && (
            <select value={condition.entityId} onChange={(event) => patchCondition(index, { ...condition, entityId: event.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
          )}
          {condition.type === 'faction' && <select value={condition.factionId} onChange={(event) => patchCondition(index, { ...condition, factionId: event.target.value })}>{factions.map((faction) => <option key={faction} value={faction}>{faction}</option>)}</select>}
          {condition.type === 'party-member' && <>
            <select value={condition.leaderId ?? ''} onChange={(event) => patchCondition(index, { ...condition, leaderId: event.target.value || undefined })}><option value="">{zh ? '任意队长' : 'Any leader'}</option>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
            <select value={condition.status ?? ''} onChange={(event) => patchCondition(index, { ...condition, status: event.target.value ? event.target.value as 'active' | 'reserve' : undefined })}><option value="">{zh ? '任意身份' : 'Any status'}</option><option value="active">{zh ? '正式' : 'Active'}</option><option value="reserve">{zh ? '候补' : 'Reserve'}</option></select>
          </>}
          {condition.type === 'entity-alive' && <select value={condition.alive ? 'alive' : 'dead'} onChange={(event) => patchCondition(index, { ...condition, alive: event.target.value === 'alive' })}><option value="alive">{zh ? '存活' : 'Alive'}</option><option value="dead">{zh ? '已倒下' : 'Defeated'}</option></select>}
          {condition.type === 'clue' && <>
            <input value={condition.clueId} placeholder={zh ? '线索 ID' : 'Clue ID'} onChange={(event) => patchCondition(index, { ...condition, clueId: event.target.value })} />
            <label>{zh ? '可信度 ≥' : 'Confidence ≥'}<input type="number" min="0" max="1" step="0.05" value={condition.minimumConfidence ?? 0} onChange={(event) => patchCondition(index, { ...condition, minimumConfidence: Math.max(0, Math.min(1, Number(event.target.value) || 0)) })} /></label>
          </>}
          {condition.type === 'visibility' && <>
            <select value={condition.target.kind} onChange={(event) => {
              const kind = event.target.value as 'entity' | 'structure'
              patchCondition(index, { ...condition, target: { kind, id: kind === 'entity' ? firstEntityId : firstStructureId } })
            }}><option value="entity">{zh ? '单位' : 'Entity'}</option><option value="structure">{zh ? '建筑' : 'Structure'}</option></select>
            <select value={condition.target.id} onChange={(event) => patchCondition(index, { ...condition, target: { ...condition.target, id: event.target.value } })}>{(condition.target.kind === 'entity' ? entities : structures).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <select value={condition.visible ? 'visible' : 'hidden'} onChange={(event) => patchCondition(index, { ...condition, visible: event.target.value === 'visible' })}><option value="visible">{zh ? '已显示' : 'Visible'}</option><option value="hidden">{zh ? '已隐藏' : 'Hidden'}</option></select>
          </>}
          {condition.type === 'scenario-outcome' && <>
            <input value={condition.scenarioId} placeholder={zh ? '流程 ID' : 'Flow ID'} onChange={(event) => patchCondition(index, { ...condition, scenarioId: event.target.value })} />
            <input value={condition.outcomeId ?? ''} placeholder={zh ? '结果 ID（可选）' : 'Outcome ID (optional)'} onChange={(event) => patchCondition(index, { ...condition, outcomeId: event.target.value || undefined })} />
          </>}
          <button type="button" className="icon-button" onClick={() => {
            const next = conditions.filter((_, itemIndex) => itemIndex !== index)
            onChange(next.length ? { mode: group?.mode ?? 'all', ...(group?.negate ? { negate: true } : {}), conditions: next } : undefined)
          }}><Trash2 size={13} /></button>
        </div>
      ))}
      <button type="button" disabled={!firstEntityId} onClick={() => onChange({
        mode: group?.mode ?? 'all',
        ...(group?.negate ? { negate: true } : {}),
        conditions: [...conditions, makeCondition('affinity', firstEntityId, secondEntityId, firstStructureId)],
      })}><Plus size={13} />{zh ? '添加条件' : 'Add condition'}</button>
    </details>
  )
}

const ScenarioBranchContentEditor = ({
  branch,
  entities,
  structures,
  bricks,
  zh,
  onChange,
}: {
  branch: WorldScenarioBranch
  entities: WorldEntity[]
  structures: BrickStructure[]
  bricks: PlacedBrick[]
  zh: boolean
  onChange: (branch: WorldScenarioBranch) => void
}) => {
  const firstEntityId = entities[0]?.id ?? ''
  const interactiveBricks = bricks.filter((brick) => getVoxelInteractionKind(brick))
  const patchAction = (actionIndex: number, action: WorldScenarioAction) => onChange({
    ...branch,
    actions: branch.actions?.map((item, index) => index === actionIndex ? action : item),
  })
  const addAction = (action: WorldScenarioAction) => onChange({
    ...branch,
    actions: [...(branch.actions ?? []), action],
  })
  return (
    <div className="scenario-branch-content">
      <section>
        <header><strong>{zh ? '分支对白' : 'Branch dialogue'}</strong><small>{zh ? '命中该分支后按顺序演出。' : 'Played in order when this branch matches.'}</small></header>
        {(branch.dialogue ?? []).map((line, lineIndex) => (
          <div className="scenario-dialogue-row" key={line.id}>
            <span>{lineIndex + 1}</span>
            <select value={line.speakerId} onChange={(event) => onChange({ ...branch, dialogue: branch.dialogue?.map((item, index) => index === lineIndex ? { ...item, speakerId: event.target.value } : item) })}>
              {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
            </select>
            <textarea rows={2} value={line.text} onChange={(event) => onChange({ ...branch, dialogue: branch.dialogue?.map((item, index) => index === lineIndex ? { ...item, text: event.target.value } : item) })} />
            <label><input type="number" min="0.5" max="30" step="0.5" value={line.durationSeconds} onChange={(event) => onChange({ ...branch, dialogue: branch.dialogue?.map((item, index) => index === lineIndex ? { ...item, durationSeconds: Math.max(0.5, Number(event.target.value) || 0.5) } : item) })} />{zh ? '秒' : 'sec'}</label>
            <button type="button" className="icon-button" title={zh ? '删除台词' : 'Delete line'} onClick={() => onChange({ ...branch, dialogue: branch.dialogue?.filter((_, index) => index !== lineIndex) })}><Trash2 size={14} /></button>
          </div>
        ))}
        <button type="button" disabled={!firstEntityId} onClick={() => onChange({
          ...branch,
          dialogue: [...(branch.dialogue ?? []), {
            id: `${branch.id}-line-${Date.now()}`,
            speakerId: branch.trigger.actorId ?? firstEntityId,
            text: zh ? '输入分支台词……' : 'Enter branch dialogue…',
            durationSeconds: 4,
          }],
        })}><Plus size={13} />{zh ? '添加分支台词' : 'Add branch line'}</button>
      </section>

      <section>
        <header><strong>{zh ? '分支行为' : 'Branch actions'}</strong><small>{zh ? '对白结束后执行，只作用于这个分支。' : 'Runs after dialogue for this branch only.'}</small></header>
        {(branch.actions ?? []).map((action, actionIndex) => (
          <div className="scenario-action-row" key={`${action.type}-${actionIndex}`}>
            <strong>{action.type}</strong>
            {action.type === 'set-faction' && <>
              <select value={action.entityId} onChange={(event) => patchAction(actionIndex, { ...action, entityId: event.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
              <select value={action.factionId} onChange={(event) => patchAction(actionIndex, { ...action, factionId: event.target.value })}>{factions.map((faction) => <option key={faction} value={faction}>{faction}</option>)}</select>
            </>}
            {action.type === 'join-party' && <>
              <select value={action.entityId} onChange={(event) => patchAction(actionIndex, { ...action, entityId: event.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
              <select value={action.leaderId} onChange={(event) => patchAction(actionIndex, { ...action, leaderId: event.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{zh ? `队长：${entity.name}` : `Leader: ${entity.name}`}</option>)}</select>
              <select value={action.status ?? 'active'} onChange={(event) => patchAction(actionIndex, { ...action, status: event.target.value as 'active' | 'reserve' })}><option value="active">{zh ? '正式成员' : 'Active'}</option><option value="reserve">{zh ? '候补成员' : 'Reserve'}</option></select>
              <input value={action.partyName ?? ''} placeholder={zh ? '队伍名称（可选）' : 'Party name (optional)'} onChange={(event) => patchAction(actionIndex, { ...action, partyName: event.target.value || undefined })} />
            </>}
            {action.type === 'leave-party' && (
              <select value={action.entityId} onChange={(event) => patchAction(actionIndex, { ...action, entityId: event.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
            )}
            {action.type === 'grant-clue' && <>
              <select value={action.entityId} onChange={(event) => patchAction(actionIndex, { ...action, entityId: event.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
              <select value={action.clue.kind} onChange={(event) => patchAction(actionIndex, { ...action, clue: { ...action.clue, kind: event.target.value as 'fact' | 'rumor' | 'secret' } })}><option value="fact">{zh ? '事实' : 'Fact'}</option><option value="rumor">{zh ? '传闻' : 'Rumor'}</option><option value="secret">{zh ? '秘密' : 'Secret'}</option></select>
              <input type="number" min="0.05" max="1" step="0.05" value={action.clue.confidence} title={zh ? '可信度' : 'Confidence'} onChange={(event) => patchAction(actionIndex, { ...action, clue: { ...action.clue, confidence: Math.max(0.05, Math.min(1, Number(event.target.value) || 0.05)) } })} />
              <textarea rows={2} value={action.clue.text} placeholder={zh ? '角色获得的线索' : 'Clue learned by this character'} onChange={(event) => patchAction(actionIndex, { ...action, clue: { ...action.clue, text: event.target.value } })} />
              <input value={action.clue.tags.join(', ')} placeholder={zh ? '标签，用逗号分隔' : 'Comma-separated tags'} onChange={(event) => patchAction(actionIndex, { ...action, clue: { ...action.clue, tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) } })} />
            </>}
            {action.type === 'issue-command' && <>
              <select value={action.entityId} onChange={(event) => patchAction(actionIndex, { ...action, entityId: event.target.value })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
              <select value={action.command.type} onChange={(event) => patchAction(actionIndex, { ...action, command: makeCommand(event.target.value as WorldEntityCommand['type'], getCommandTargetId(action.command) || firstEntityId) })}>{commandTypes.map((type) => <option key={type} value={type}>{commandLabel(type, zh)}</option>)}</select>
              {'target' in action.command && <select value={getCommandTargetId(action.command)} onChange={(event) => patchAction(actionIndex, { ...action, command: makeCommand(action.command.type, event.target.value) })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>}
            </>}
            {action.type === 'set-visibility' && <>
              <select value={action.target.kind} onChange={(event) => {
                const kind = event.target.value as 'entity' | 'structure'
                patchAction(actionIndex, { ...action, target: { kind, id: kind === 'entity' ? firstEntityId : structures[0]?.id ?? '' } })
              }}><option value="entity">{zh ? '单位' : 'Entity'}</option><option value="structure">{zh ? '建筑' : 'Structure'}</option></select>
              <select value={action.target.id} onChange={(event) => patchAction(actionIndex, { ...action, target: { ...action.target, id: event.target.value } })}>
                {(action.target.kind === 'entity' ? entities : structures).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <select value={action.visible ? 'show' : 'hide'} onChange={(event) => patchAction(actionIndex, { ...action, visible: event.target.value === 'show' })}><option value="show">{zh ? '显示' : 'Reveal'}</option><option value="hide">{zh ? '隐藏' : 'Hide'}</option></select>
            </>}
            {action.type === 'add-story' && <>
              <input value={action.title} placeholder={zh ? '段落标题' : 'Passage title'} onChange={(event) => patchAction(actionIndex, { ...action, title: event.target.value })} />
              <textarea rows={2} value={action.body} placeholder={zh ? '段落内容' : 'Passage body'} onChange={(event) => patchAction(actionIndex, { ...action, body: event.target.value })} />
            </>}
            {action.type === 'world-object' && <>
              <select value={action.brickId} onChange={(event) => patchAction(actionIndex, { ...action, brickId: event.target.value })}>{interactiveBricks.map((brick) => <option key={brick.id} value={brick.id}>{brick.voxelState?.containerName || `${getVoxelInteractionKind(brick)} · ${brick.id}`}</option>)}</select>
              <select value={action.action} onChange={(event) => patchAction(actionIndex, { ...action, action: event.target.value as typeof action.action })}><option value="open">{zh ? '打开' : 'Open'}</option><option value="close">{zh ? '关闭' : 'Close'}</option><option value="toggle">{zh ? '切换' : 'Toggle'}</option><option value="inspect">{zh ? '检查' : 'Inspect'}</option><option value="power-on">{zh ? '点亮' : 'Power on'}</option><option value="power-off">{zh ? '熄灭' : 'Power off'}</option></select>
            </>}
            <label title={zh ? '等待上一行为完成后再执行' : 'Wait after the previous action'}>
              {zh ? '等待' : 'Delay'}
              <input
                type="number"
                min="0"
                max="120"
                step="0.5"
                value={action.delaySeconds ?? 0}
                onChange={(event) => patchAction(actionIndex, {
                  ...action,
                  delaySeconds: Math.max(0, Math.min(120, Number(event.target.value) || 0)) || undefined,
                })}
              />
              {zh ? '秒' : 's'}
            </label>
            <button type="button" className="icon-button" title={zh ? '删除行为' : 'Delete action'} onClick={() => onChange({ ...branch, actions: branch.actions?.filter((_, index) => index !== actionIndex) })}><Trash2 size={14} /></button>
          </div>
        ))}
        <div className="scenario-add-actions">
          <button type="button" disabled={!firstEntityId} onClick={() => addAction({ type: 'set-faction', entityId: firstEntityId, factionId: 'red' })}><Plus size={13} />{zh ? '阵营变化' : 'Faction'}</button>
          <button type="button" disabled={!firstEntityId} onClick={() => addAction({ type: 'join-party', entityId: firstEntityId, leaderId: firstEntityId })}><Plus size={13} />{zh ? '加入队伍' : 'Join party'}</button>
          <button type="button" disabled={!firstEntityId} onClick={() => addAction({ type: 'leave-party', entityId: firstEntityId })}><Plus size={13} />{zh ? '离开队伍' : 'Leave party'}</button>
          <button type="button" disabled={!firstEntityId} onClick={() => addAction({ type: 'grant-clue', entityId: firstEntityId, clue: { id: `clue-${Date.now()}`, text: '', kind: 'fact', confidence: 1, tags: [] } })}><Plus size={13} />{zh ? '授予线索' : 'Grant clue'}</button>
          <button type="button" disabled={!firstEntityId} onClick={() => addAction({ type: 'issue-command', entityId: firstEntityId, command: { type: 'wander' } })}><Plus size={13} />{zh ? '单位命令' : 'Command'}</button>
          <button type="button" onClick={() => addAction({ type: 'add-story', title: zh ? '分支段落' : 'Branch passage', body: '' })}><Plus size={13} />{zh ? '剧情段落' : 'Passage'}</button>
          <button type="button" disabled={!firstEntityId} onClick={() => addAction({ type: 'set-visibility', target: { kind: 'entity', id: firstEntityId }, visible: true })}><Plus size={13} />{zh ? '显示/隐藏' : 'Visibility'}</button>
          <button type="button" disabled={!interactiveBricks[0]} onClick={() => interactiveBricks[0] && addAction({ type: 'world-object', brickId: interactiveBricks[0].id, action: 'toggle' })}><Plus size={13} />{zh ? '世界物件' : 'World object'}</button>
        </div>
      </section>
    </div>
  )
}

export const WorldScenarioEditor = ({ scenario, entities, structures, bricks, hiddenTargets, llmConfigured, locale, onChange, onSetTargetVisibility }: Props) => {
  const zh = locale === 'zh-CN'
  const [editorMode, setEditorMode] = useState<'flow' | 'form'>('flow')
  const [selectedStageId, setSelectedStageId] = useState(
    () => scenario.stages.find((stage) => stage.status === 'active')?.id ?? scenario.stages[0]?.id ?? '',
  )
  useEffect(() => {
    if (scenario.stages.some((stage) => stage.id === selectedStageId)) return
    setSelectedStageId(scenario.stages.find((stage) => stage.status === 'active')?.id ?? scenario.stages[0]?.id ?? '')
  }, [scenario.stages, selectedStageId])
  const patchScenario = (patch: Partial<WorldScenarioRuntime>) => onChange({ ...scenario, ...patch, authoringVersion: 3 })
  const patchStage = (stageIndex: number, patch: Partial<WorldScenarioStage>) => patchScenario({
    stages: scenario.stages.map((stage, index) => index === stageIndex ? { ...stage, ...patch } : stage),
  })
  const firstEntityId = entities[0]?.id ?? ''
  const interactiveBricks = bricks.filter((brick) => getVoxelInteractionKind(brick))
  const hiddenTargetKeys = new Set(hiddenTargets.map((target) => `${target.kind}:${target.id}`))
  const validationIssues = validateWorldScenario(scenario, {
    entityIds: entities.map((entity) => entity.id),
    structureIds: structures.map((structure) => structure.id),
    brickIds: bricks.map((brick) => brick.id),
  })
  const validationErrorCount = validationIssues.filter((issue) => issue.severity === 'error').length
  const visibleStages = editorMode === 'flow'
    ? scenario.stages.filter((stage) => stage.id === selectedStageId)
    : scenario.stages

  return (
    <div className="scenario-editor">
      <div className="scenario-editor-grid">
        <label>{zh ? '流程名称' : 'Flow title'}<input value={scenario.title} onChange={(event) => patchScenario({ title: event.target.value })} /></label>
        <label>{zh ? '流程简介' : 'Description'}<input value={scenario.description} onChange={(event) => patchScenario({ description: event.target.value })} /></label>
        <label>{zh ? '演出优先级' : 'Playback priority'}<input type="number" min="-100" max="100" value={scenario.priority ?? 0} onChange={(event) => patchScenario({ priority: Math.max(-100, Math.min(100, Math.floor(Number(event.target.value) || 0))) })} /></label>
        <label>{zh ? '互斥组（可选）' : 'Mutex group (optional)'}<input value={scenario.mutexGroup ?? ''} placeholder={zh ? '同组流程不会重复消费同一事件' : 'Same group shares event claims'} onChange={(event) => patchScenario({ mutexGroup: event.target.value || undefined })} /></label>
      </div>
      <div className="scenario-editor-mode" role="group" aria-label={zh ? '剧情编辑模式' : 'Scenario editor mode'}>
        <button type="button" className={editorMode === 'flow' ? 'active' : ''} aria-pressed={editorMode === 'flow'} onClick={() => setEditorMode('flow')}><GitBranch size={14} />{zh ? '流程图' : 'Flowchart'}</button>
        <button type="button" className={editorMode === 'form' ? 'active' : ''} aria-pressed={editorMode === 'form'} onClick={() => setEditorMode('form')}><ListTree size={14} />{zh ? '完整表单' : 'Full form'}</button>
      </div>
      {editorMode === 'flow' && (
        <WorldScenarioFlowEditor
          scenario={scenario}
          selectedStageId={selectedStageId}
          issues={validationIssues}
          locale={locale}
          onSelectStage={setSelectedStageId}
          onAddStage={() => {
            const result = addWorldScenarioStage(scenario, locale)
            setSelectedStageId(result.stageId)
            onChange({ ...result.scenario, authoringVersion: 3 })
          }}
          onDuplicateStage={() => {
            const result = duplicateWorldScenarioStage(scenario, selectedStageId, locale)
            if (!result) return
            setSelectedStageId(result.stageId)
            onChange({ ...result.scenario, authoringVersion: 3 })
          }}
          onDeleteStage={() => {
            const result = deleteWorldScenarioStage(scenario, selectedStageId)
            if (!result) return
            setSelectedStageId(result.selectedStageId)
            onChange({ ...result.scenario, authoringVersion: 3 })
          }}
          onMoveStage={(direction) => onChange({
            ...moveWorldScenarioStage(scenario, selectedStageId, direction),
            authoringVersion: 3,
          })}
        />
      )}
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
                  : <a
                      href={editorMode === 'flow' ? `#scenario-flow-stage-${issue.stageIndex}` : `#scenario-stage-${issue.stageIndex}`}
                      onClick={() => {
                        if (editorMode === 'flow') setSelectedStageId(scenario.stages[issue.stageIndex!]?.id ?? selectedStageId)
                      }}
                    >
                      {formatValidationIssue(issue, scenario, zh)}
                    </a>}
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
      {visibleStages.map((stage) => {
        const stageIndex = scenario.stages.findIndex((candidate) => candidate.id === stage.id)
        return (
        <details id={`scenario-stage-${stageIndex}`} key={`${stage.id}-${stageIndex}`} open={editorMode === 'flow' || stage.status === 'active'}>
          <summary>{stageIndex + 1}. {stage.title} · {zh ? ({ locked: '等待进入', active: '等待触发', completed: '已完成' }[stage.status]) : stage.status}</summary>
          <div className="scenario-stage-editor">
            <div className="scenario-editor-grid">
              <label>{zh ? '节点名称' : 'Node title'}<input value={stage.title} onChange={(event) => patchStage(stageIndex, { title: event.target.value })} /></label>
              <label>{zh ? '节点说明' : 'Node description'}<input value={stage.description} onChange={(event) => patchStage(stageIndex, { description: event.target.value })} /></label>
              <label>{zh ? '默认下一节点' : 'Default next node'}
                <select
                  value={stage.nextStageId === null ? '__end__' : stage.nextStageId ?? '__auto__'}
                  onChange={(event) => {
                    const value = event.target.value
                    const nextStageId = value === '__auto__' ? undefined : value === '__end__' ? null : value
                    onChange({
                      ...updateWorldScenarioStageTransition(scenario, stage.id, nextStageId),
                      authoringVersion: 3,
                    })
                  }}
                >
                  <option value="__auto__">{zh ? '按流程图顺序推进' : 'Continue in flow order'}</option>
                  <option value="__end__">{zh ? '在此结束流程' : 'End flow here'}</option>
                  {scenario.stages.filter((candidate) => candidate.id !== stage.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
                </select>
              </label>
              <label>{zh ? '触发事件' : 'Trigger event'}
                <select value={stage.trigger.eventType} onChange={(event) => patchStage(stageIndex, { trigger: { ...stage.trigger, eventType: event.target.value as WorldEvent['type'] } })}>
                  {triggerTypes.map((type) => <option key={type} value={type}>{triggerLabel(type, zh)}</option>)}
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
              <label>{zh ? '最低好感（可选）' : 'Minimum affinity (optional)'}
                <input
                  type="number"
                  min="-100"
                  max="100"
                  value={stage.trigger.minimumAffinity ?? ''}
                  placeholder={zh ? '不限制' : 'No limit'}
                  onChange={(event) => patchStage(stageIndex, {
                    trigger: {
                      ...stage.trigger,
                      minimumAffinity: event.target.value === ''
                        ? undefined
                        : Math.max(-100, Math.min(100, Number(event.target.value) || 0)),
                    },
                  })}
                />
              </label>
              <ScenarioConditionEditor
                group={stage.trigger.conditions}
                entities={entities}
                structures={structures}
                zh={zh}
                onChange={(conditions) => patchStage(stageIndex, {
                  trigger: { ...stage.trigger, conditions },
                })}
              />
            </div>

            <div className={`scenario-editor-section scenario-ai-editor${stage.ai ? ' enabled' : ''}`}>
              <header>
                <strong><Bot size={13} />{zh ? '节点编排方式' : 'Node direction'}</strong>
                <small>{zh
                  ? '流程图决定何时触发和最终去向；AI 只补对白，或在作者列出的分支中选择。'
                  : 'The graph owns triggers and outcomes. AI only fills dialogue or chooses among authored branches.'}</small>
              </header>
              <div className="scenario-ai-mode-row">
                <label>{zh ? '模式' : 'Mode'}
                  <select
                    value={stage.ai?.mode ?? 'authored'}
                    onChange={(event) => {
                      const mode = event.target.value
                      if (mode === 'authored') {
                        patchStage(stageIndex, { ai: undefined })
                        return
                      }
                      patchStage(stageIndex, {
                        ai: {
                          mode: mode as 'dialogue' | 'choice',
                          instruction: stage.ai?.instruction ?? (zh
                            ? '结合已有剧情自然推进当前节点，不新增角色、地点或世界状态。'
                            : 'Advance this node naturally from established canon without inventing entities, places, or world state.'),
                          speakerIds: stage.ai?.speakerIds?.length
                            ? stage.ai.speakerIds
                            : (scenario.castEntityIds ?? entities.map((entity) => entity.id)).slice(0, 8),
                          maxDialogueLines: stage.ai?.maxDialogueLines ?? 3,
                          ...(mode === 'choice'
                            ? { fallbackBranchId: stage.ai?.fallbackBranchId ?? stage.branches?.[0]?.id }
                            : {}),
                        },
                      })
                    }}
                  >
                    <option value="authored">{zh ? '固定编排' : 'Authored'}</option>
                    <option value="dialogue">{zh ? 'AI 生成对白' : 'AI dialogue'}</option>
                    <option value="choice">{zh ? 'AI 对白并选择分支' : 'AI dialogue + branch choice'}</option>
                  </select>
                </label>
                {stage.ai && (
                  <label>{zh ? '最多台词' : 'Max lines'}
                    <input
                      type="number"
                      min="1"
                      max="6"
                      value={stage.ai.maxDialogueLines ?? 3}
                      onChange={(event) => patchStage(stageIndex, {
                        ai: { ...stage.ai!, maxDialogueLines: Math.max(1, Math.min(6, Number(event.target.value) || 1)) },
                      })}
                    />
                  </label>
                )}
                {stage.ai?.mode === 'choice' && (
                  <label>{zh ? '保底分支' : 'Fallback branch'}
                    <select
                      value={stage.ai.fallbackBranchId ?? ''}
                      onChange={(event) => patchStage(stageIndex, {
                        ai: { ...stage.ai!, fallbackBranchId: event.target.value || undefined },
                      })}
                    >
                      <option value="">{zh ? '请选择' : 'Select'}</option>
                      {(stage.branches ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.title}</option>)}
                    </select>
                  </label>
                )}
              </div>
              {stage.ai && (
                <>
                  <label>{zh ? '给 AI 的节点目标与边界' : 'AI node objective and boundaries'}
                    <textarea
                      rows={3}
                      maxLength={2_000}
                      value={stage.ai.instruction}
                      placeholder={zh ? '说明这一幕要推进什么、哪些事实不能改变……' : 'Describe what this scene should advance and which facts must not change…'}
                      onChange={(event) => patchStage(stageIndex, { ai: { ...stage.ai!, instruction: event.target.value } })}
                    />
                  </label>
                  <div className="scenario-ai-speakers">
                    <strong>{zh ? '允许说话的角色' : 'Allowed speakers'}</strong>
                    <div>
                      {entities.map((entity) => {
                        const selected = stage.ai?.speakerIds?.includes(entity.id) ?? false
                        return (
                          <label className={selected ? 'selected' : ''} key={entity.id}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(event) => {
                                const current = stage.ai?.speakerIds ?? []
                                patchStage(stageIndex, {
                                  ai: {
                                    ...stage.ai!,
                                    speakerIds: event.target.checked
                                      ? Array.from(new Set([...current, entity.id]))
                                      : current.filter((id) => id !== entity.id),
                                  },
                                })
                              }}
                            />
                            {entity.name}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                  {!llmConfigured && (
                    <p className="scenario-ai-notice">{zh
                      ? '当前未配置 LLM：游玩时会使用本节点的固定台词和保底分支，不会卡住流程。'
                      : 'No LLM configured: play mode will use authored dialogue and the fallback branch without blocking.'}</p>
                  )}
                </>
              )}
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
              <header><strong>{zh ? '触发后的行为' : 'Actions after trigger'}</strong><small>{zh ? '可以改变阵营、下达命令或写入剧情段落。' : 'Change factions, issue orders, or add a story passage.'}</small></header>
              {(stage.actions ?? []).map((action, actionIndex) => (
                <div className="scenario-action-row" key={`${action.type}-${actionIndex}`}>
                  <strong>{action.type}</strong>
                  {action.type === 'set-faction' && <>
                    <select value={action.entityId} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, entityId: event.target.value } : item) })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
                    <select value={action.factionId} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, factionId: event.target.value } : item) })}>{factions.map((faction) => <option key={faction} value={faction}>{faction}</option>)}</select>
                  </>}
                  {action.type === 'join-party' && <>
                    <select value={action.entityId} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, entityId: event.target.value } : item) })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
                    <select value={action.leaderId} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, leaderId: event.target.value } : item) })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{zh ? `队长：${entity.name}` : `Leader: ${entity.name}`}</option>)}</select>
                    <select value={action.status ?? 'active'} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, status: event.target.value as 'active' | 'reserve' } : item) })}><option value="active">{zh ? '正式成员' : 'Active'}</option><option value="reserve">{zh ? '候补成员' : 'Reserve'}</option></select>
                    <input value={action.partyName ?? ''} placeholder={zh ? '队伍名称（可选）' : 'Party name (optional)'} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, partyName: event.target.value || undefined } : item) })} />
                  </>}
                  {action.type === 'leave-party' && (
                    <select value={action.entityId} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, entityId: event.target.value } : item) })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
                  )}
                  {action.type === 'grant-clue' && <>
                    <select value={action.entityId} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, entityId: event.target.value } : item) })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>
                    <select value={action.clue.kind} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, clue: { ...action.clue, kind: event.target.value as 'fact' | 'rumor' | 'secret' } } : item) })}><option value="fact">{zh ? '事实' : 'Fact'}</option><option value="rumor">{zh ? '传闻' : 'Rumor'}</option><option value="secret">{zh ? '秘密' : 'Secret'}</option></select>
                    <input type="number" min="0.05" max="1" step="0.05" value={action.clue.confidence} title={zh ? '可信度' : 'Confidence'} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, clue: { ...action.clue, confidence: Math.max(0.05, Math.min(1, Number(event.target.value) || 0.05)) } } : item) })} />
                    <textarea rows={2} value={action.clue.text} placeholder={zh ? '角色获得的线索' : 'Clue learned by this character'} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, clue: { ...action.clue, text: event.target.value } } : item) })} />
                    <input value={action.clue.tags.join(', ')} placeholder={zh ? '标签，用逗号分隔' : 'Comma-separated tags'} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, clue: { ...action.clue, tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) } } : item) })} />
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
                    <select value={action.command.type} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, command: makeCommand(event.target.value as WorldEntityCommand['type'], getCommandTargetId(action.command) || firstEntityId) } : item) })}>{commandTypes.map((type) => <option key={type} value={type}>{commandLabel(type, zh)}</option>)}</select>
                    {'target' in action.command && <select value={getCommandTargetId(action.command)} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, command: makeCommand(action.command.type, event.target.value) } : item) })}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>}
                  </>}
                  {action.type === 'add-story' && <>
                    <input value={action.title} placeholder={zh ? '段落标题' : 'Passage title'} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, title: event.target.value } : item) })} />
                    <textarea rows={2} value={action.body} placeholder={zh ? '段落内容' : 'Passage body'} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, body: event.target.value } : item) })} />
                  </>}
                  {action.type === 'world-object' && <>
                    <select value={action.brickId} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, brickId: event.target.value } : item) })}>{interactiveBricks.map((brick) => <option key={brick.id} value={brick.id}>{brick.voxelState?.containerName || `${getVoxelInteractionKind(brick)} · ${brick.id}`}</option>)}</select>
                    <select value={action.action} onChange={(event) => patchStage(stageIndex, { actions: stage.actions?.map((item, index) => index === actionIndex ? { ...action, action: event.target.value as typeof action.action } : item) })}><option value="open">{zh ? '打开' : 'Open'}</option><option value="close">{zh ? '关闭' : 'Close'}</option><option value="toggle">{zh ? '切换' : 'Toggle'}</option><option value="inspect">{zh ? '检查' : 'Inspect'}</option><option value="power-on">{zh ? '点亮' : 'Power on'}</option><option value="power-off">{zh ? '熄灭' : 'Power off'}</option></select>
                  </>}
                  <label title={zh ? '等待上一行为完成后再执行' : 'Wait after the previous action'}>
                    {zh ? '等待' : 'Delay'}
                    <input
                      type="number"
                      min="0"
                      max="120"
                      step="0.5"
                      value={action.delaySeconds ?? 0}
                      onChange={(event) => patchStage(stageIndex, {
                        actions: stage.actions?.map((item, index) => index === actionIndex ? {
                          ...action,
                          delaySeconds: Math.max(0, Math.min(120, Number(event.target.value) || 0)) || undefined,
                        } : item),
                      })}
                    />
                    {zh ? '秒' : 's'}
                  </label>
                  <button type="button" className="icon-button" title={zh ? '删除行为' : 'Delete action'} onClick={() => patchStage(stageIndex, { actions: stage.actions?.filter((_, index) => index !== actionIndex) })}><Trash2 size={14} /></button>
                </div>
              ))}
              <div className="scenario-add-actions">
                <button type="button" onClick={() => addAction(stageIndex, { type: 'set-faction', entityId: firstEntityId, factionId: 'red' })}><Plus size={13} />{zh ? '阵营变化' : 'Faction'}</button>
                <button type="button" disabled={!firstEntityId} onClick={() => addAction(stageIndex, { type: 'join-party', entityId: firstEntityId, leaderId: firstEntityId })}><Plus size={13} />{zh ? '加入队伍' : 'Join party'}</button>
                <button type="button" disabled={!firstEntityId} onClick={() => addAction(stageIndex, { type: 'leave-party', entityId: firstEntityId })}><Plus size={13} />{zh ? '离开队伍' : 'Leave party'}</button>
                <button type="button" disabled={!firstEntityId} onClick={() => addAction(stageIndex, { type: 'grant-clue', entityId: firstEntityId, clue: { id: `clue-${Date.now()}`, text: '', kind: 'fact', confidence: 1, tags: [] } })}><Plus size={13} />{zh ? '授予线索' : 'Grant clue'}</button>
                <button type="button" onClick={() => addAction(stageIndex, { type: 'issue-command', entityId: firstEntityId, command: { type: 'wander' } })}><Plus size={13} />{zh ? '单位命令' : 'Command'}</button>
                <button type="button" onClick={() => addAction(stageIndex, { type: 'add-story', title: zh ? '新段落' : 'New passage', body: '' })}><Plus size={13} />{zh ? '剧情段落' : 'Passage'}</button>
                <button type="button" disabled={!firstEntityId} onClick={() => addAction(stageIndex, { type: 'set-visibility', target: { kind: 'entity', id: firstEntityId }, visible: true })}><Plus size={13} />{zh ? '显示/隐藏' : 'Visibility'}</button>
                <button type="button" disabled={!interactiveBricks[0]} onClick={() => interactiveBricks[0] && addAction(stageIndex, { type: 'world-object', brickId: interactiveBricks[0].id, action: 'toggle' })}><Plus size={13} />{zh ? '世界物件' : 'World object'}</button>
              </div>
            </div>

            <div className="scenario-editor-section">
              <header><strong>{zh ? '条件分支' : 'Conditional branches'}</strong><small>{zh ? '分支触发后走向指定节点；不选择下一节点表示结束这条流程。' : 'A matched branch moves to its target node. No target ends this flow.'}</small></header>
              {(stage.branches ?? []).map((branch, branchIndex) => (
                <div className="scenario-branch-card" key={branch.id}>
                  <input value={branch.title} aria-label={zh ? '分支名称' : 'Branch name'} onChange={(event) => patchStage(stageIndex, { branches: stage.branches?.map((item, index) => index === branchIndex ? { ...item, title: event.target.value } : item) })} />
                  {stage.ai?.mode === 'choice'
                    ? <textarea
                        rows={2}
                        value={branch.aiGuidance ?? ''}
                        aria-label={zh ? 'AI 选择条件' : 'AI choice guidance'}
                        placeholder={zh ? '什么情况下应选择这个分支？' : 'When should AI choose this branch?'}
                        onChange={(event) => patchStage(stageIndex, { branches: stage.branches?.map((item, index) => index === branchIndex ? { ...item, aiGuidance: event.target.value } : item) })}
                      />
                    : <>
                        <select value={branch.trigger.eventType} aria-label={zh ? '分支触发事件' : 'Branch trigger'} onChange={(event) => patchStage(stageIndex, { branches: stage.branches?.map((item, index) => index === branchIndex ? { ...item, trigger: { ...item.trigger, eventType: event.target.value as WorldEvent['type'] } } : item) })}>{triggerTypes.map((type) => <option key={type} value={type}>{triggerLabel(type, zh)}</option>)}</select>
                        <select value={branch.trigger.actorId ?? ''} aria-label={zh ? '分支发起者' : 'Branch actor'} onChange={(event) => patchStage(stageIndex, { branches: stage.branches?.map((item, index) => index === branchIndex ? { ...item, trigger: { ...item.trigger, actorId: event.target.value || undefined } } : item) })}>
                          <option value="">{zh ? '任意发起者' : 'Any actor'}</option>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
                        </select>
                        <select value={branch.trigger.targetId ?? ''} aria-label={zh ? '分支目标' : 'Branch target'} onChange={(event) => patchStage(stageIndex, { branches: stage.branches?.map((item, index) => index === branchIndex ? { ...item, trigger: { ...item.trigger, targetId: event.target.value || undefined } } : item) })}>
                          <option value="">{zh ? '任意目标' : 'Any target'}</option>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
                        </select>
                        <input
                          type="number"
                          min="-100"
                          max="100"
                          value={branch.trigger.minimumAffinity ?? ''}
                          aria-label={zh ? '分支最低好感' : 'Branch minimum affinity'}
                          placeholder={zh ? '最低好感（可选）' : 'Minimum affinity'}
                          onChange={(event) => patchStage(stageIndex, {
                            branches: stage.branches?.map((item, index) => index === branchIndex
                              ? {
                                  ...item,
                                  trigger: {
                                    ...item.trigger,
                                    minimumAffinity: event.target.value === ''
                                      ? undefined
                                      : Math.max(-100, Math.min(100, Number(event.target.value) || 0)),
                                  },
                                }
                              : item),
                          })}
                        />
                      </>}
                  {stage.ai?.mode !== 'choice' && (
                    <ScenarioConditionEditor
                      group={branch.trigger.conditions}
                      entities={entities}
                      structures={structures}
                      zh={zh}
                      onChange={(conditions) => patchStage(stageIndex, {
                        branches: stage.branches?.map((item, index) => index === branchIndex
                          ? { ...item, trigger: { ...item.trigger, conditions } }
                          : item),
                      })}
                    />
                  )}
                  <select value={branch.nextStageId ?? ''} aria-label={zh ? '分支下一节点' : 'Branch next node'} onChange={(event) => patchStage(stageIndex, { branches: stage.branches?.map((item, index) => index === branchIndex ? { ...item, nextStageId: event.target.value || undefined } : item) })}>
                    <option value="">{zh ? '结束这条流程' : 'End this flow'}</option>{scenario.stages.filter((candidate) => candidate.id !== stage.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
                  </select>
                  <small>{zh ? `后续行为 ${branch.actions?.length ?? 0} 个 · 台词 ${branch.dialogue?.length ?? 0} 句` : `${branch.actions?.length ?? 0} actions · ${branch.dialogue?.length ?? 0} lines`}</small>
                  <button type="button" className="icon-button" title={zh ? '删除分支' : 'Delete branch'} onClick={() => patchStage(stageIndex, { branches: stage.branches?.filter((_, index) => index !== branchIndex) })}><Trash2 size={14} /></button>
                  <details className="scenario-branch-content-toggle">
                    <summary>{zh ? '编辑分支对白与行为' : 'Edit branch dialogue and actions'}</summary>
                    <ScenarioBranchContentEditor
                      branch={branch}
                      entities={entities}
                      structures={structures}
                      bricks={bricks}
                      zh={zh}
                      onChange={(updatedBranch) => patchStage(stageIndex, {
                        branches: stage.branches?.map((item, index) => index === branchIndex ? updatedBranch : item),
                      })}
                    />
                  </details>
                </div>
              ))}
              <button type="button" onClick={() => patchStage(stageIndex, { branches: [...(stage.branches ?? []), { id: `branch-${Date.now()}`, title: zh ? '新分支' : 'New branch', trigger: { eventType: 'interaction' }, actions: [] }] })}><Plus size={14} />{zh ? '添加分支' : 'Add branch'}</button>
            </div>
          </div>
        </details>
        )
      })}
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
    'missing-brick': `引用的积木 ${reference} 不存在`,
    'invalid-dialogue': '台词为空或显示时间不足 0.5 秒',
    'invalid-ai-config': 'AI 节点缺少有效指令，或对白数量超出 1–6 句',
    'missing-ai-fallback': `AI 抉择节点缺少有效的保底分支 ${reference}`,
    'empty-flow': '流程至少需要一个节点',
    'duplicate-dialogue-id': `台词 ID ${reference} 重复`,
    'invalid-action-delay': '行为等待时间必须在 0–120 秒之间',
  } : {
    'duplicate-stage-id': `Duplicate stage ID ${reference}`,
    'duplicate-branch-id': `Duplicate branch ID ${reference}`,
    'missing-stage': `Next stage ${reference} does not exist`,
    'unreachable-stage': 'Cannot be reached from the first stage',
    'cyclic-stage-flow': 'Stage flow contains a cycle; completed stages cannot reactivate',
    'missing-entity': `Referenced entity ${reference} does not exist`,
    'missing-structure': `Referenced structure ${reference} does not exist`,
    'missing-brick': `Referenced brick ${reference} does not exist`,
    'invalid-dialogue': 'Dialogue is empty or shorter than 0.5 seconds',
    'invalid-ai-config': 'AI node needs a valid instruction and a 1–6 line limit',
    'missing-ai-fallback': `AI choice node needs a valid fallback branch ${reference}`,
    'empty-flow': 'A flow needs at least one node',
    'duplicate-dialogue-id': `Duplicate dialogue ID ${reference}`,
    'invalid-action-delay': 'Action delay must be between 0 and 120 seconds',
  }
  return `${location}${messages[issue.code]}`
}
