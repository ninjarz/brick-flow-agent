import type { WorldEntityCommand, WorldScenarioAction, WorldScenarioRuntime, WorldScenarioTrigger } from '../types/world'

export type WorldScenarioValidationIssueCode =
  | 'duplicate-stage-id'
  | 'duplicate-branch-id'
  | 'missing-stage'
  | 'unreachable-stage'
  | 'cyclic-stage-flow'
  | 'missing-entity'
  | 'missing-structure'
  | 'invalid-dialogue'
  | 'invalid-ai-config'
  | 'missing-ai-fallback'

export type WorldScenarioValidationIssue = {
  code: WorldScenarioValidationIssueCode
  severity: 'error' | 'warning'
  stageIndex?: number
  branchIndex?: number
  referenceId?: string
}

type ValidationContext = {
  entityIds: Iterable<string>
  structureIds: Iterable<string>
}

const commandTarget = (command: WorldEntityCommand) => 'target' in command ? command.target : undefined

export const validateWorldScenario = (
  scenario: WorldScenarioRuntime,
  context: ValidationContext,
): WorldScenarioValidationIssue[] => {
  const issues: WorldScenarioValidationIssue[] = []
  const entityIds = new Set(context.entityIds)
  const structureIds = new Set(context.structureIds)
  const stageIndexesById = new Map<string, number[]>()
  scenario.stages.forEach((stage, stageIndex) => {
    const indexes = stageIndexesById.get(stage.id)
    if (indexes) indexes.push(stageIndex)
    else stageIndexesById.set(stage.id, [stageIndex])
  })
  for (const [referenceId, indexes] of stageIndexesById) {
    if (indexes.length < 2) continue
    for (const stageIndex of indexes) {
      issues.push({ code: 'duplicate-stage-id', severity: 'error', stageIndex, referenceId })
    }
  }

  const addMissingEntity = (referenceId: string | undefined, stageIndex?: number, branchIndex?: number) => {
    if (referenceId && !entityIds.has(referenceId)) {
      issues.push({ code: 'missing-entity', severity: 'error', stageIndex, branchIndex, referenceId })
    }
  }
  const validateTrigger = (trigger: WorldScenarioTrigger, stageIndex: number, branchIndex?: number) => {
    addMissingEntity(trigger.actorId, stageIndex, branchIndex)
    if (trigger.targetId && !entityIds.has(trigger.targetId) && !structureIds.has(trigger.targetId)) {
      issues.push({ code: 'missing-entity', severity: 'error', stageIndex, branchIndex, referenceId: trigger.targetId })
    }
    for (const condition of trigger.conditions?.conditions ?? []) {
      if (condition.type === 'affinity') {
        addMissingEntity(condition.actorId, stageIndex, branchIndex)
        addMissingEntity(condition.targetId, stageIndex, branchIndex)
      } else if (condition.type === 'health-ratio' || condition.type === 'faction' ||
        condition.type === 'party-member' || condition.type === 'entity-alive') {
        addMissingEntity(condition.entityId, stageIndex, branchIndex)
        if (condition.type === 'party-member') addMissingEntity(condition.leaderId, stageIndex, branchIndex)
      } else if (condition.type === 'visibility') {
        if (condition.target.kind === 'entity') addMissingEntity(condition.target.id, stageIndex, branchIndex)
        if (condition.target.kind === 'structure' && !structureIds.has(condition.target.id)) {
          issues.push({ code: 'missing-structure', severity: 'error', stageIndex, branchIndex, referenceId: condition.target.id })
        }
      }
    }
  }
  const validateAction = (action: WorldScenarioAction, stageIndex: number, branchIndex?: number) => {
    if (action.type === 'set-faction' || action.type === 'issue-command' ||
      action.type === 'join-party' || action.type === 'leave-party') {
      addMissingEntity(action.entityId, stageIndex, branchIndex)
    }
    if (action.type === 'join-party') addMissingEntity(action.leaderId, stageIndex, branchIndex)
    if (action.type === 'issue-command') {
      const target = commandTarget(action.command)
      if (target?.kind === 'entity') addMissingEntity(target.id, stageIndex, branchIndex)
      if (target?.kind === 'structure' && !structureIds.has(target.id)) {
        issues.push({ code: 'missing-structure', severity: 'error', stageIndex, branchIndex, referenceId: target.id })
      }
    }
    if (action.type === 'set-visibility') {
      if (action.target.kind === 'entity') addMissingEntity(action.target.id, stageIndex, branchIndex)
      if (action.target.kind === 'structure' && !structureIds.has(action.target.id)) {
        issues.push({ code: 'missing-structure', severity: 'error', stageIndex, branchIndex, referenceId: action.target.id })
      }
    }
    if (action.type === 'add-story') {
      for (const characterId of action.characterIds ?? []) addMissingEntity(characterId, stageIndex, branchIndex)
    }
  }
  const validateDialogue = (
    dialogue: WorldScenarioRuntime['stages'][number]['dialogue'],
    stageIndex: number,
    branchIndex?: number,
  ) => {
    for (const line of dialogue ?? []) {
      addMissingEntity(line.speakerId, stageIndex, branchIndex)
      if (!line.text.trim() || !Number.isFinite(line.durationSeconds) || line.durationSeconds < 0.5) {
        issues.push({ code: 'invalid-dialogue', severity: 'warning', stageIndex, branchIndex, referenceId: line.id })
      }
    }
  }

  for (const castEntityId of scenario.castEntityIds ?? []) addMissingEntity(castEntityId)
  scenario.stages.forEach((stage, stageIndex) => {
    validateTrigger(stage.trigger, stageIndex)
    validateDialogue(stage.dialogue, stageIndex)
    if (stage.ai) {
      if (!stage.ai.instruction.trim() || (stage.ai.maxDialogueLines !== undefined && (
        !Number.isFinite(stage.ai.maxDialogueLines)
        || stage.ai.maxDialogueLines < 1
        || stage.ai.maxDialogueLines > 6
      ))) {
        issues.push({ code: 'invalid-ai-config', severity: 'error', stageIndex })
      }
      for (const speakerId of stage.ai.speakerIds ?? []) addMissingEntity(speakerId, stageIndex)
      if (stage.ai.mode === 'choice' && (
        !stage.ai.fallbackBranchId
        || !stage.branches?.some((branch) => branch.id === stage.ai?.fallbackBranchId)
      )) {
        issues.push({
          code: 'missing-ai-fallback',
          severity: 'error',
          stageIndex,
          referenceId: stage.ai.fallbackBranchId,
        })
      }
    }
    for (const action of stage.actions ?? []) validateAction(action, stageIndex)
    const branchIds = new Set<string>()
    stage.branches?.forEach((branch, branchIndex) => {
      if (branchIds.has(branch.id)) {
        issues.push({ code: 'duplicate-branch-id', severity: 'error', stageIndex, branchIndex, referenceId: branch.id })
      }
      branchIds.add(branch.id)
      validateTrigger(branch.trigger, stageIndex, branchIndex)
      validateDialogue(branch.dialogue, stageIndex, branchIndex)
      for (const action of branch.actions ?? []) validateAction(action, stageIndex, branchIndex)
    })
  })

  const uniqueStageIndexById = new Map(
    [...stageIndexesById].flatMap(([id, indexes]) => indexes.length === 1 ? [[id, indexes[0]] as const] : []),
  )
  const edges = scenario.stages.map((stage, stageIndex) => {
    const targetIds = [
      stage.nextStageId === null
        ? undefined
        : stage.nextStageId ?? (stageIndex + 1 < scenario.stages.length ? scenario.stages[stageIndex + 1].id : undefined),
      ...(stage.branches ?? []).map((branch) => branch.nextStageId),
    ].filter((id): id is string => Boolean(id))
    const targetIndexes: number[] = []
    for (const targetId of targetIds) {
      const targetIndex = uniqueStageIndexById.get(targetId)
      if (targetIndex === undefined) {
        issues.push({ code: 'missing-stage', severity: 'error', stageIndex, referenceId: targetId })
      } else {
        targetIndexes.push(targetIndex)
      }
    }
    return [...new Set(targetIndexes)]
  })

  const reachable = new Set<number>()
  const visitReachable = (stageIndex: number) => {
    if (reachable.has(stageIndex)) return
    reachable.add(stageIndex)
    for (const targetIndex of edges[stageIndex] ?? []) visitReachable(targetIndex)
  }
  if (scenario.stages.length > 0) visitReachable(0)
  scenario.stages.forEach((_, stageIndex) => {
    if (!reachable.has(stageIndex)) issues.push({ code: 'unreachable-stage', severity: 'warning', stageIndex })
  })

  const visiting = new Set<number>()
  const visited = new Set<number>()
  const cyclicIndexes = new Set<number>()
  const visitCycle = (stageIndex: number) => {
    if (visiting.has(stageIndex)) {
      cyclicIndexes.add(stageIndex)
      return true
    }
    if (visited.has(stageIndex)) return false
    visiting.add(stageIndex)
    let cycleFound = false
    for (const targetIndex of edges[stageIndex] ?? []) {
      if (visitCycle(targetIndex)) {
        cyclicIndexes.add(stageIndex)
        cycleFound = true
      }
    }
    visiting.delete(stageIndex)
    visited.add(stageIndex)
    return cycleFound
  }
  if (scenario.stages.length > 0) visitCycle(0)
  for (const stageIndex of cyclicIndexes) {
    issues.push({ code: 'cyclic-stage-flow', severity: 'error', stageIndex })
  }

  return issues
}
