import type { WorldScenarioRuntime, WorldScenarioStage } from '../types/world'

const makeUniqueId = (preferred: string, existingIds: Set<string>) => {
  if (!existingIds.has(preferred)) return preferred
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${preferred}-${suffix}`
    if (!existingIds.has(candidate)) return candidate
  }
}

const cloneStage = (stage: WorldScenarioStage): WorldScenarioStage => ({
  ...stage,
  trigger: { ...stage.trigger },
  dialogue: stage.dialogue?.map((line) => ({ ...line })),
  actions: stage.actions?.map((action) => (
    action.type === 'issue-command'
      ? { ...action, command: { ...action.command } }
      : action.type === 'set-visibility'
        ? { ...action, target: { ...action.target } }
        : { ...action }
  )),
  branches: stage.branches?.map((branch) => ({
    ...branch,
    trigger: { ...branch.trigger },
    dialogue: branch.dialogue?.map((line) => ({ ...line })),
    actions: branch.actions?.map((action) => (
      action.type === 'issue-command'
        ? { ...action, command: { ...action.command } }
        : action.type === 'set-visibility'
          ? { ...action, target: { ...action.target } }
          : { ...action }
    )),
  })),
})

export const getWorldScenarioDefaultNextStageId = (
  scenario: WorldScenarioRuntime,
  stageIndex: number,
) => {
  const stage = scenario.stages[stageIndex]
  if (!stage || stage.nextStageId === null) return undefined
  return stage.nextStageId ?? scenario.stages[stageIndex + 1]?.id
}

export const addWorldScenarioStage = (
  scenario: WorldScenarioRuntime,
  locale: 'zh-CN' | 'en-US',
): { scenario: WorldScenarioRuntime; stageId: string } => {
  const existingIds = new Set(scenario.stages.map((stage) => stage.id))
  const stageId = makeUniqueId('stage', existingIds)
  const stage: WorldScenarioStage = {
    id: stageId,
    title: locale === 'zh-CN' ? '新章节' : 'New stage',
    description: locale === 'zh-CN' ? '描述玩家需要完成的目标。' : 'Describe the player objective.',
    status: scenario.stages.length === 0 ? 'active' : 'locked',
    trigger: { eventType: 'interaction' },
  }
  return {
    scenario: { ...scenario, stages: [...scenario.stages, stage], activeDialogue: undefined, outcomeId: undefined },
    stageId,
  }
}

export const duplicateWorldScenarioStage = (
  scenario: WorldScenarioRuntime,
  sourceStageId: string,
  locale: 'zh-CN' | 'en-US',
): { scenario: WorldScenarioRuntime; stageId: string } | undefined => {
  const sourceIndex = scenario.stages.findIndex((stage) => stage.id === sourceStageId)
  if (sourceIndex < 0) return undefined
  const source = scenario.stages[sourceIndex]
  const stageId = makeUniqueId(`${source.id}-copy`, new Set(scenario.stages.map((stage) => stage.id)))
  const copied = cloneStage(source)
  copied.id = stageId
  copied.title = `${source.title}${locale === 'zh-CN' ? '（副本）' : ' (copy)'}`
  copied.status = 'locked'
  delete copied.completedAtSeconds
  copied.dialogue = copied.dialogue?.map((line, index) => ({ ...line, id: `${stageId}-line-${index + 1}` }))
  copied.branches = copied.branches?.map((branch, index) => ({
    ...branch,
    id: `${stageId}-branch-${index + 1}`,
    dialogue: branch.dialogue?.map((line, lineIndex) => ({ ...line, id: `${stageId}-branch-${index + 1}-line-${lineIndex + 1}` })),
  }))
  const stages = [...scenario.stages]
  if (source.nextStageId !== undefined) stages[sourceIndex] = { ...source, nextStageId: stageId }
  stages.splice(sourceIndex + 1, 0, copied)
  return {
    scenario: { ...scenario, stages, activeDialogue: undefined, outcomeId: undefined },
    stageId,
  }
}

export const deleteWorldScenarioStage = (
  scenario: WorldScenarioRuntime,
  stageId: string,
): { scenario: WorldScenarioRuntime; selectedStageId: string } | undefined => {
  const stageIndex = scenario.stages.findIndex((stage) => stage.id === stageId)
  if (stageIndex < 0 || scenario.stages.length <= 1) return undefined
  const deletedStage = scenario.stages[stageIndex]
  const successorStageId = getWorldScenarioDefaultNextStageId(scenario, stageIndex)
  const fallbackStageId = successorStageId ?? scenario.stages[stageIndex - 1]?.id
  let stages = scenario.stages
    .filter((stage) => stage.id !== stageId)
    .map((stage) => ({
      ...stage,
      nextStageId: stage.nextStageId === stageId ? successorStageId ?? null : stage.nextStageId,
      branches: stage.branches?.map((branch) => (
        branch.nextStageId === stageId ? { ...branch, nextStageId: successorStageId } : branch
      )),
    }))
  if (deletedStage.status === 'active' && !stages.some((stage) => stage.status === 'active')) {
    stages = stages.map((stage) => stage.id === fallbackStageId ? { ...stage, status: 'active' as const } : stage)
  }
  return {
    scenario: {
      ...scenario,
      stages,
      activeDialogue: scenario.activeDialogue?.stageId === stageId ? undefined : scenario.activeDialogue,
      outcomeId: undefined,
    },
    selectedStageId: fallbackStageId ?? stages[0].id,
  }
}

export const moveWorldScenarioStage = (
  scenario: WorldScenarioRuntime,
  stageId: string,
  direction: -1 | 1,
) => {
  const stageIndex = scenario.stages.findIndex((stage) => stage.id === stageId)
  const nextIndex = stageIndex + direction
  if (stageIndex < 0 || nextIndex < 0 || nextIndex >= scenario.stages.length) return scenario
  const stages = [...scenario.stages]
  const [stage] = stages.splice(stageIndex, 1)
  stages.splice(nextIndex, 0, stage)
  return { ...scenario, stages }
}

export const updateWorldScenarioStageTransition = (
  scenario: WorldScenarioRuntime,
  stageId: string,
  nextStageId: string | null | undefined,
) => ({
  ...scenario,
  stages: scenario.stages.map((stage) => stage.id === stageId ? { ...stage, nextStageId } : stage),
})
