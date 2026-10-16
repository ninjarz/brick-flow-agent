import type { BuildPlan } from '../types/bricks'
import { visibleScenarioDialogue } from './worldScenarioDialogue'
import type { WorldEvent, WorldScenarioAction, WorldScenarioBranch, WorldScenarioDialogueLine, WorldScenarioRuntime, WorldScenarioStage, WorldScenarioTrigger, WorldState } from '../types/world'
import { issueWorldEntityCommand, joinWorldParty, leaveWorldParty } from './worldEntity'
import { grantWorldClue } from './worldClues'
import { makeScenarioDialogueStoryId } from './worldNarrativeFeed'
import { getWorldScenarioPlaybackLane, orderWorldScenariosForEvaluation } from './worldScenarioScheduler'
import { createWorldHiddenTargetIndex } from './worldVisibility'

type ScenarioPlan = Pick<BuildPlan, 'bricks' | 'structures'>

export const evaluateWorldScenarioConditions = (
  world: WorldState,
  group: NonNullable<WorldScenarioTrigger['conditions']>,
) => {
  const hiddenTargetKeys = new Set(world.hiddenTargets.map((target) => `${target.kind}:${target.id}`))
  const matches = group.conditions.map((condition) => {
    if (condition.type === 'affinity') {
      const affinity = world.narrative.relationshipsByEntityId[condition.actorId]?.[condition.targetId]?.affinity ?? 0
      return condition.comparison === 'gte' ? affinity >= condition.value : affinity <= condition.value
    }
    if (condition.type === 'health-ratio') {
      const entity = world.entities.find((candidate) => candidate.id === condition.entityId)
      if (!entity) return false
      const ratio = entity.health / Math.max(1, entity.maxHealth)
      return condition.comparison === 'gte' ? ratio >= condition.value : ratio <= condition.value
    }
    if (condition.type === 'faction') {
      return world.entities.some((entity) => entity.id === condition.entityId && entity.factionId === condition.factionId)
    }
    if (condition.type === 'party-member') {
      const entity = world.entities.find((candidate) => candidate.id === condition.entityId)
      const party = entity?.partyId ? world.parties.find((candidate) => candidate.id === entity.partyId) : undefined
      const membership = party?.members.find((member) => member.entityId === condition.entityId)
      return Boolean(
        party
        && membership
        && (!condition.leaderId || party.leaderId === condition.leaderId)
        && (!condition.status || membership.status === condition.status),
      )
    }
    if (condition.type === 'clue') {
      return world.narrative.cluesByEntityId[condition.entityId]?.some((clue) => (
        clue.id === condition.clueId
        && clue.confidence >= (condition.minimumConfidence ?? 0)
      )) ?? false
    }
    if (condition.type === 'scenario-outcome') {
      const scenario = world.scenarios.find((candidate) => candidate.id === condition.scenarioId)
      return Boolean(scenario?.outcomeId && (!condition.outcomeId || scenario.outcomeId === condition.outcomeId))
    }
    if (condition.type === 'visibility') {
      return hiddenTargetKeys.has(`${condition.target.kind}:${condition.target.id}`) !== condition.visible
    }
    const entity = world.entities.find((candidate) => candidate.id === condition.entityId)
    return Boolean(entity && (entity.health > 0) === condition.alive)
  })
  const result = group.mode === 'any' ? matches.some(Boolean) : matches.every(Boolean)
  return group.negate ? !result : result
}

const eventMatchesTrigger = (
  world: WorldState,
  event: WorldEvent,
  trigger: WorldScenarioTrigger,
) => {
  if (
    event.type !== trigger.eventType
    || (trigger.actorId && event.actorId !== trigger.actorId)
    || (trigger.targetId && event.targetId !== trigger.targetId)
    || (trigger.commandType && event.commandType !== trigger.commandType)
  ) return false
  if (trigger.minimumAffinity !== undefined) {
    const actorId = trigger.actorId ?? event.actorId
    const targetId = trigger.targetId ?? event.targetId
    if (!targetId) return false
    if ((world.narrative.relationshipsByEntityId[actorId]?.[targetId]?.affinity ?? 0) < trigger.minimumAffinity) return false
  }
  return !trigger.conditions || evaluateWorldScenarioConditions(world, trigger.conditions)
}

const findLatestMatchingEvent = (
  world: WorldState,
  events: WorldEvent[],
  consumedEventIds: Set<string>,
  trigger: WorldScenarioTrigger,
) => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!consumedEventIds.has(event.id) && eventMatchesTrigger(world, event, trigger)) return event
  }
  return undefined
}

const applyScenarioAction = (
  world: WorldState,
  scenario: WorldScenarioRuntime,
  action: WorldScenarioAction,
  event: WorldEvent,
  plan?: ScenarioPlan,
): WorldState => {
  if (action.type === 'set-faction') {
    return {
      ...world,
      entities: world.entities.map((entity) => entity.id === action.entityId
        ? { ...entity, factionId: action.factionId }
        : entity),
    }
  }
  if (action.type === 'join-party') {
    return joinWorldParty(world, action.entityId, action.leaderId, {
      partyName: action.partyName,
      status: action.status,
    })
  }
  if (action.type === 'leave-party') {
    return leaveWorldParty(world, action.entityId)
  }
  if (action.type === 'grant-clue') {
    if (!world.entities.some((entity) => entity.id === action.entityId)) return world
    return {
      ...world,
      narrative: grantWorldClue(world.narrative, {
        ...action.clue,
        holderId: action.entityId,
        learnedAtSeconds: world.elapsedSeconds,
        sourceEventId: event.id,
      }),
    }
  }
  if (action.type === 'issue-command') {
    if (world.hiddenTargets.some((target) => target.kind === 'entity' && target.id === action.entityId)) return world
    const result = issueWorldEntityCommand(
      world,
      action.entityId,
      action.command,
      (target) => {
        if (world.hiddenTargets.some((hidden) => hidden.kind === target.kind && hidden.id === target.id)) return false
        if (target.kind === 'entity') return world.entities.some((entity) => entity.id === target.id)
        if (target.kind === 'brick') return Boolean(plan?.bricks.some((brick) => brick.id === target.id))
        if (target.kind === 'structure') return Boolean(plan?.structures?.some((structure) => structure.id === target.id))
        return false
      },
      'replace',
    )
    if (result.ok) return result.world
    return { ...world, narrative: { ...world.narrative, stories: [...world.narrative.stories, {
      id: `scenario-command-rejected-${scenario.id}-${event.id}-${world.narrative.stories.length}`,
      title: 'Scenario command rejected', body: `${action.entityId}: ${'issue' in result ? result.issue : 'COMMAND_REJECTED'}`,
      createdAtSeconds: world.elapsedSeconds, eventIds: [event.id], source: 'local' as const,
    }].slice(-40) } }
  }
  if (action.type === 'set-visibility') {
    const key = `${action.target.kind}:${action.target.id}`
    const hiddenTargets = action.visible
      ? world.hiddenTargets.filter((target) => `${target.kind}:${target.id}` !== key)
      : world.hiddenTargets.some((target) => `${target.kind}:${target.id}` === key)
        ? world.hiddenTargets
        : [...world.hiddenTargets, action.target]
    if (hiddenTargets === world.hiddenTargets) return world
    return {
      ...world,
      hiddenTargets,
      entities: !action.visible && action.target.kind === 'entity'
        ? world.entities.map((entity) => entity.id === action.target.id ? {
            ...entity,
            activeCommand: undefined,
            commandQueue: [],
            speech: undefined,
            behaviorState: 'idle' as const,
            navigation: { status: 'idle' as const, path: [], pathIndex: 0 },
          } : entity)
        : world.entities,
    }
  }
  if (action.type === 'world-object') {
    if (world.hiddenTargets.some((target) => target.kind === 'brick' && target.id === action.brickId)) return world
    const objectEvent: WorldEvent = {
      id: `scenario-object-${scenario.id}-${action.brickId}-${Math.round(world.elapsedSeconds * 1_000)}-${world.events.length}`,
      timeSeconds: world.elapsedSeconds,
      type: 'object-interaction',
      actorId: action.actorId ?? event.actorId,
      targetId: action.brickId,
      objectAction: action.action,
    }
    return { ...world, events: [...world.events, objectEvent].slice(-500) }
  }
  const storyId = `story-scenario-${scenario.id}-${world.narrative.stories.length + 1}`
  return {
    ...world,
    narrative: {
      ...world.narrative,
      stories: [...world.narrative.stories, {
        id: storyId,
        title: action.title,
        body: action.body,
        createdAtSeconds: world.elapsedSeconds,
        eventIds: [event.id],
        characterIds: action.characterIds,
        source: 'local',
      }],
    },
  }
}

const stopDialogueParticipants = (world: WorldState, scenario: WorldScenarioRuntime, dialogue: WorldScenarioDialogueLine[], lineIndex: number, lineEndsAtSeconds: number) => {
  const currentLine = dialogue[lineIndex]
  const participantIds = new Set([...(scenario.castEntityIds ?? []), ...dialogue.map((line) => line.speakerId)])
  let changed = false
  const entities = world.entities.map((entity) => {
    if (!participantIds.has(entity.id) || entity.health <= 0) return entity
    const speech = entity.id === currentLine?.speakerId ? {
      message: 'scenario-dialogue' as const,
      text: currentLine.text,
      expiresAtSeconds: lineEndsAtSeconds,
    } : entity.speech?.message === 'scenario-dialogue' ? undefined : entity.speech
    const alreadyStopped = !entity.activeCommand && entity.commandQueue.length === 0 &&
      entity.navigation.status === 'idle' && entity.navigation.path.length === 0 &&
      entity.behaviorState === 'idle'
    const sameSpeech = entity.speech?.message === speech?.message && entity.speech?.text === speech?.text &&
      entity.speech?.expiresAtSeconds === speech?.expiresAtSeconds
    if (alreadyStopped && sameSpeech) return entity
    changed = true
    return {
      ...entity,
      activeCommand: undefined,
      commandQueue: [],
      navigation: { status: 'idle' as const, path: [], pathIndex: 0 },
      behaviorState: 'idle' as const,
      speech,
    }
  })
  return changed ? { ...world, entities } : world
}

const clearDialogueSpeech = (
  world: WorldState,
  stage: WorldScenarioStage,
  dialogueOverride?: WorldScenarioDialogueLine[],
) => {
  const participantIds = new Set([
    ...(dialogueOverride ?? []).map((line) => line.speakerId),
    ...(stage.dialogue ?? []).map((line) => line.speakerId),
    ...(stage.branches ?? []).flatMap((branch) => (branch.dialogue ?? []).map((line) => line.speakerId)),
  ])
  let changed = false
  const entities = world.entities.map((entity) => {
    if (!participantIds.has(entity.id) || entity.speech?.message !== 'scenario-dialogue') return entity
    changed = true
    return { ...entity, speech: undefined }
  })
  return changed ? { ...world, entities } : world
}

const persistScenarioDialogue = (
  world: WorldState,
  scenario: WorldScenarioRuntime,
  stage: WorldScenarioStage,
  event: WorldEvent,
  branch?: WorldScenarioBranch,
  dialogueOverride?: WorldScenarioDialogueLine[],
  source: 'authored' | 'ai' = 'authored',
) => {
  const dialogue = dialogueOverride ?? branch?.dialogue ?? stage.dialogue ?? []
  if (dialogue.length === 0) return world
  const storyId = makeScenarioDialogueStoryId(scenario.id, stage.id, event.id, branch?.id)
  if (world.narrative.stories.some((story) => story.id === storyId)) return world
  const entityNameById = new Map(world.entities.map((entity) => [entity.id, entity.name]))
  return {
    ...world,
    narrative: {
      ...world.narrative,
      stories: [...world.narrative.stories, {
        id: storyId,
        title: branch?.title ?? stage.title,
        body: dialogue.map((line) => `${entityNameById.get(line.speakerId) ?? line.speakerId}：“${line.text}”`).join('\n'),
        blocks: dialogue.map((line) => ({ type: 'dialogue' as const, speakerId: line.speakerId, text: line.text })),
        createdAtSeconds: world.elapsedSeconds,
        eventIds: [event.id],
        characterIds: Array.from(new Set(dialogue.map((line) => line.speakerId))),
        source: source === 'ai' ? 'ai' as const : 'local' as const,
      }].slice(-40),
    },
  }
}

const completeStage = (
  world: WorldState,
  scenario: WorldScenarioRuntime,
  activeStageIndex: number,
  event: WorldEvent,
  branch?: WorldScenarioBranch,
  dialogueOverride?: WorldScenarioDialogueLine[],
  source: 'authored' | 'ai' = 'authored',
  applyActions = true,
  plan?: ScenarioPlan,
) => {
  const activeStage = scenario.stages[activeStageIndex]
  const nextStageIndex = branch
    ? branch.nextStageId ? scenario.stages.findIndex((stage) => stage.id === branch.nextStageId) : -1
    : activeStage.nextStageId === null
      ? -1
      : activeStage.nextStageId
        ? scenario.stages.findIndex((stage) => stage.id === activeStage.nextStageId)
        : activeStageIndex + 1
  const stages = scenario.stages.map((stage, index) => {
    if (index === activeStageIndex) return { ...stage, status: 'completed' as const, completedAtSeconds: world.elapsedSeconds }
    if (index === nextStageIndex && stage.status === 'locked') return { ...stage, status: 'active' as const }
    return stage
  })
  const updatedScenario: WorldScenarioRuntime = {
    ...scenario,
    stages,
    pendingAi: undefined,
    activeDialogue: undefined,
    activeTimeline: undefined,
    ...(branch ? { outcomeId: branch.id } : nextStageIndex < 0 || nextStageIndex >= stages.length ? { outcomeId: 'completed' } : {}),
  }
  let nextWorld = persistScenarioDialogue(
    clearDialogueSpeech(world, activeStage, dialogueOverride),
    scenario,
    activeStage,
    event,
    branch,
    dialogueOverride,
    source,
  )
  if (applyActions) {
    for (const action of branch?.actions ?? activeStage.actions ?? []) {
      nextWorld = applyScenarioAction(nextWorld, updatedScenario, action, event, plan)
    }
  }
  return { world: nextWorld, scenario: updatedScenario }
}

const startTimelineOrCompleteStage = (
  world: WorldState,
  scenario: WorldScenarioRuntime,
  activeStageIndex: number,
  event: WorldEvent,
  branch?: WorldScenarioBranch,
  dialogueOverride?: WorldScenarioDialogueLine[],
  source: 'authored' | 'ai' = 'authored',
  plan?: ScenarioPlan,
): { world: WorldState; scenario: WorldScenarioRuntime } => {
  const activeStage = scenario.stages[activeStageIndex]
  const actions = branch?.actions ?? activeStage.actions ?? []
  if (!actions.some((action) => (action.delaySeconds ?? 0) > 0)) {
    return completeStage(world, scenario, activeStageIndex, event, branch, dialogueOverride, source, true, plan)
  }
  const stagedScenario: WorldScenarioRuntime = {
    ...scenario,
    pendingAi: undefined,
    activeDialogue: undefined,
    activeTimeline: {
      stageId: activeStage.id,
      eventId: event.id,
      ...(branch ? { branchId: branch.id } : {}),
      ...(dialogueOverride?.length ? { generatedDialogue: dialogueOverride } : {}),
      source,
      actionIndex: 0,
      nextActionAtSeconds: world.elapsedSeconds + Math.max(0, actions[0]?.delaySeconds ?? 0),
    },
  }
  return advanceScenarioTimeline(
    clearDialogueSpeech(world, activeStage, dialogueOverride),
    stagedScenario,
    activeStageIndex,
    event,
    branch,
    plan,
  )
}

const advanceScenarioTimeline = (
  world: WorldState,
  scenario: WorldScenarioRuntime,
  activeStageIndex: number,
  event: WorldEvent,
  branch?: WorldScenarioBranch,
  plan?: ScenarioPlan,
): { world: WorldState; scenario: WorldScenarioRuntime } => {
  const timeline = scenario.activeTimeline
  const activeStage = scenario.stages[activeStageIndex]
  if (!timeline || timeline.stageId !== activeStage.id) {
    return { world, scenario: { ...scenario, activeTimeline: undefined } }
  }
  const actions = branch?.actions ?? activeStage.actions ?? []
  let nextWorld = world
  let actionIndex = timeline.actionIndex
  let nextActionAtSeconds = timeline.nextActionAtSeconds
  while (actionIndex < actions.length && world.elapsedSeconds >= nextActionAtSeconds) {
    nextWorld = applyScenarioAction(nextWorld, scenario, actions[actionIndex], event, plan)
    actionIndex += 1
    if (actionIndex < actions.length) {
      nextActionAtSeconds += Math.max(0, actions[actionIndex].delaySeconds ?? 0)
    }
  }
  if (actionIndex >= actions.length) {
    return completeStage(
      nextWorld,
      scenario,
      activeStageIndex,
      event,
      branch,
      timeline.generatedDialogue,
      timeline.source,
      false,
      plan,
    )
  }
  return {
    world: nextWorld,
    scenario: {
      ...scenario,
      activeTimeline: {
        ...timeline,
        actionIndex,
        nextActionAtSeconds,
      },
    },
  }
}

export type WorldScenarioAiResolution = {
  branchId?: string
  dialogue?: Array<{
    speakerId: string
    text: string
    durationSeconds?: number
  }>
}

export const resolveWorldScenarioAi = (
  world: WorldState,
  scenarioId: string,
  resolution: WorldScenarioAiResolution,
  plan?: ScenarioPlan,
): WorldState => {
  const scenarioIndex = world.scenarios.findIndex((scenario) => scenario.id === scenarioId)
  const scenario = world.scenarios[scenarioIndex]
  const pending = scenario?.pendingAi
  if (!scenario || !pending) return world
  const activeStageIndex = scenario.stages.findIndex((stage) => stage.id === pending.stageId && stage.status === 'active')
  const activeStage = scenario.stages[activeStageIndex]
  if (!activeStage?.ai) return {
    ...world,
    scenarios: world.scenarios.map((candidate) => candidate.id === scenarioId
      ? { ...candidate, pendingAi: undefined }
      : candidate),
  }
  const event = world.events.find((candidate) => candidate.id === pending.eventId) ?? {
    id: pending.eventId,
    timeSeconds: world.elapsedSeconds,
    type: activeStage.trigger.eventType,
    actorId: activeStage.trigger.actorId ?? 'scenario',
    targetId: activeStage.trigger.targetId,
    commandType: activeStage.trigger.commandType,
  }
  const requestedBranchExists = Boolean(
    resolution.branchId
    && activeStage.branches?.some((candidate) => candidate.id === resolution.branchId),
  )
  const chosenBranchId = activeStage.ai.mode === 'choice'
    ? requestedBranchExists ? resolution.branchId : activeStage.ai.fallbackBranchId
    : pending.branchId
  const branch = chosenBranchId
    ? activeStage.branches?.find((candidate) => candidate.id === chosenBranchId)
    : undefined
  const hiddenEntityIds = createWorldHiddenTargetIndex(world.hiddenTargets, []).hiddenEntityIds
  const visibleLivingEntityIds = new Set(world.entities.filter((entity) => (
    !hiddenEntityIds.has(entity.id)
  )).map((entity) => entity.id))
  const configuredSpeakerIds = new Set(
    activeStage.ai.speakerIds?.length
      ? activeStage.ai.speakerIds
      : scenario.castEntityIds?.length
        ? scenario.castEntityIds
        : world.entities.map((entity) => entity.id),
  )
  const allowedSpeakerIds = new Set([...configuredSpeakerIds].filter((entityId) => (
    visibleLivingEntityIds.has(entityId)
  )))
  const maxLines = Math.max(1, Math.min(6, activeStage.ai.maxDialogueLines ?? 3))
  const generatedDialogue = (resolution.dialogue ?? [])
    .flatMap((line, index): WorldScenarioDialogueLine[] => {
      const text = line.text.trim().slice(0, 500)
      if (!text || !allowedSpeakerIds.has(line.speakerId)) return []
      return [{
        id: `ai-${scenario.id}-${activeStage.id}-${index + 1}`,
        speakerId: line.speakerId,
        text,
        durationSeconds: Math.max(
          1.5,
          Math.min(14, Number.isFinite(line.durationSeconds) ? line.durationSeconds! : text.length / 5),
        ),
      }]
    })
    .slice(0, maxLines)
  const dialogue = generatedDialogue.length
    ? generatedDialogue
    : branch?.dialogue ?? activeStage.dialogue ?? []
  const visibleDialogue = dialogue.filter((line) => visibleLivingEntityIds.has(line.speakerId))
  const source = generatedDialogue.length ? 'ai' as const : 'authored' as const
  const clearedScenario = { ...scenario, pendingAi: undefined }

    if (visibleDialogue.length > 0) {
      const firstLine = visibleDialogue[0]
    const updatedScenario: WorldScenarioRuntime = {
      ...clearedScenario,
      activeDialogue: {
        stageId: activeStage.id,
        eventId: event.id,
        ...(branch ? { branchId: branch.id } : {}),
        ...(generatedDialogue.length ? { generatedDialogue } : {}),
        source,
        lineIndex: 0,
        lineEndsAtSeconds: world.elapsedSeconds + Math.max(0.5, firstLine.durationSeconds),
      },
    }
    const nextWorld = stopDialogueParticipants(world, updatedScenario, visibleDialogue, 0, updatedScenario.activeDialogue!.lineEndsAtSeconds)
    return {
      ...nextWorld,
      scenarios: nextWorld.scenarios.map((candidate, index) => index === scenarioIndex ? updatedScenario : candidate),
    }
  }

  const completed = startTimelineOrCompleteStage(world, clearedScenario, activeStageIndex, event, branch, undefined, source, plan)
  return {
    ...completed.world,
    scenarios: completed.world.scenarios.map((candidate, index) => index === scenarioIndex ? completed.scenario : candidate),
  }
}

export const advanceWorldScenarios = (
  world: WorldState,
  options: { allowNewStages?: boolean; enableAi?: boolean; suspendActivePlayback?: boolean; plan?: ScenarioPlan } = {},
): WorldState => {
  if (options.suspendActivePlayback) return world
  let nextWorld = world
  let scenariosChanged = false
  let dialogueLaneOccupied = getWorldScenarioPlaybackLane(world).owners.length > 0
  const claimedEventIdsByMutexGroup = new Map<string, Set<string>>()
  for (const scenario of world.scenarios) {
    if (!scenario.mutexGroup) continue
    const claimed = claimedEventIdsByMutexGroup.get(scenario.mutexGroup) ?? new Set<string>()
    for (const eventId of scenario.claimedEventIds ?? []) claimed.add(eventId)
    claimedEventIdsByMutexGroup.set(scenario.mutexGroup, claimed)
  }
  const orderedScenarios = orderWorldScenariosForEvaluation(world.scenarios)
  const evaluatedScenarios = orderedScenarios.map(({ scenario }) => {
    if (scenario.enabled === false) return scenario
    if (scenario.pendingAi) {
      if (options.enableAi !== false) return scenario
      scenariosChanged = true
      nextWorld = resolveWorldScenarioAi(nextWorld, scenario.id, {}, options.plan)
      return nextWorld.scenarios.find((candidate) => candidate.id === scenario.id) ?? scenario
    }
    const activeStageIndex = scenario.stages.findIndex((stage) => stage.status === 'active')
    if (activeStageIndex < 0) return scenario
    const activeStage = scenario.stages[activeStageIndex]
    if (scenario.activeTimeline?.stageId === activeStage.id) {
      const activeBranch = scenario.activeTimeline.branchId
        ? activeStage.branches?.find((branch) => branch.id === scenario.activeTimeline?.branchId)
        : undefined
      const event = world.events.find((candidate) => candidate.id === scenario.activeTimeline?.eventId) ?? {
        id: scenario.activeTimeline.eventId,
        timeSeconds: world.elapsedSeconds,
        type: activeStage.trigger.eventType,
        actorId: activeStage.trigger.actorId ?? 'scenario',
        targetId: activeStage.trigger.targetId,
        commandType: activeStage.trigger.commandType,
      }
      const advanced = advanceScenarioTimeline(nextWorld, scenario, activeStageIndex, event, activeBranch, options.plan)
      if (advanced.world !== nextWorld || advanced.scenario !== scenario) scenariosChanged = true
      nextWorld = advanced.world
      return advanced.scenario
    }
    if (scenario.activeDialogue?.stageId === activeStage.id) {
      const activeBranch = scenario.activeDialogue.branchId
        ? activeStage.branches?.find((branch) => branch.id === scenario.activeDialogue?.branchId)
        : undefined
      const visibleDialogue = visibleScenarioDialogue(world, activeStage, scenario.activeDialogue)
      if (visibleDialogue.length === 0) { scenariosChanged = true; return { ...scenario, activeDialogue: undefined } }
      const currentLineIndex = Math.min(scenario.activeDialogue.lineIndex, visibleDialogue.length - 1)
      nextWorld = stopDialogueParticipants(nextWorld, scenario, visibleDialogue, currentLineIndex, scenario.activeDialogue.lineEndsAtSeconds)
      if (world.elapsedSeconds < scenario.activeDialogue.lineEndsAtSeconds) return scenario
      if (currentLineIndex + 1 < visibleDialogue.length) {
        scenariosChanged = true
        const nextLineIndex = currentLineIndex + 1
        const nextLine = visibleDialogue[nextLineIndex]
        const updatedScenario = {
          ...scenario,
          activeDialogue: {
            ...scenario.activeDialogue,
            lineIndex: nextLineIndex,
            lineEndsAtSeconds: world.elapsedSeconds + Math.max(0.5, nextLine.durationSeconds),
          },
        }
        nextWorld = stopDialogueParticipants(nextWorld, updatedScenario, visibleDialogue, nextLineIndex, updatedScenario.activeDialogue.lineEndsAtSeconds)
        return updatedScenario
      }
      scenariosChanged = true
      const event = world.events.find((candidate) => candidate.id === scenario.activeDialogue?.eventId) ?? {
        id: scenario.activeDialogue.eventId,
        timeSeconds: world.elapsedSeconds,
        type: activeStage.trigger.eventType,
        actorId: activeStage.trigger.actorId ?? 'scenario',
        targetId: activeStage.trigger.targetId,
        commandType: activeStage.trigger.commandType,
      }
      const completed = startTimelineOrCompleteStage(
        nextWorld,
        scenario,
        activeStageIndex,
        event,
        activeBranch,
        scenario.activeDialogue.generatedDialogue,
        scenario.activeDialogue.source,
        options.plan,
      )
      nextWorld = completed.world
      return completed.scenario
    }

    const mutexClaimedEventIds = scenario.mutexGroup
      ? claimedEventIdsByMutexGroup.get(scenario.mutexGroup) ?? new Set<string>()
      : new Set<string>()
    const consumedEventIds = new Set([...scenario.processedEventIds, ...mutexClaimedEventIds])
    const transitions = activeStage.ai?.mode === 'choice'
      ? [{ branch: undefined, trigger: activeStage.trigger }]
      : [
          ...(activeStage.branches ?? []).map((branch) => ({ branch, trigger: branch.trigger })),
          { branch: undefined, trigger: activeStage.trigger },
        ]
    const queuedEvent = scenario.queuedTransition?.stageId === activeStage.id
      ? world.events.find((candidate) => candidate.id === scenario.queuedTransition?.eventId)
      : undefined
    const queuedBranch = scenario.queuedTransition?.branchId
      ? activeStage.branches?.find((branch) => branch.id === scenario.queuedTransition?.branchId)
      : undefined
    const matched = queuedEvent
      ? {
          branch: queuedBranch,
          trigger: queuedBranch?.trigger ?? activeStage.trigger,
          event: queuedEvent,
        }
      : transitions
          .map((transition) => ({ ...transition, event: findLatestMatchingEvent(world, world.events, consumedEventIds, transition.trigger) }))
          .filter((transition): transition is typeof transition & { event: WorldEvent } => Boolean(transition.event))
          .sort((left, right) => right.event.timeSeconds - left.event.timeSeconds)[0]
    if (!matched) return scenario
    if (options.allowNewStages === false) return scenario
    const { event } = matched
    const branch = activeStage.ai?.mode === 'choice' && !options.enableAi
      ? activeStage.branches?.find((candidate) => candidate.id === activeStage.ai?.fallbackBranchId)
      : matched.branch

    const dialogue = branch?.dialogue ?? activeStage.dialogue
    const hiddenEntityIds = createWorldHiddenTargetIndex(world.hiddenTargets, []).hiddenEntityIds
    const visibleEntityIds = new Set(world.entities.filter((entity) => (
      !hiddenEntityIds.has(entity.id)
    )).map((entity) => entity.id))
    const visibleDialogue = dialogue?.filter((line) => visibleEntityIds.has(line.speakerId))
    const actions = branch?.actions ?? activeStage.actions ?? []
    const needsDialogueLane = Boolean(
      dialogue?.length
      || (activeStage.ai && options.enableAi)
      || actions.some((action) => (action.delaySeconds ?? 0) > 0),
    )
    if (needsDialogueLane && dialogueLaneOccupied) {
      if (scenario.queuedTransition?.eventId === event.id) return scenario
      scenariosChanged = true
      if (scenario.mutexGroup) mutexClaimedEventIds.add(event.id)
      return {
        ...scenario,
        claimedEventIds: Array.from(new Set([...(scenario.claimedEventIds ?? []), event.id])).slice(-500),
        queuedTransition: {
          stageId: activeStage.id,
          eventId: event.id,
          ...(branch ? { branchId: branch.id } : {}),
          queuedAtSeconds: world.elapsedSeconds,
        },
      }
    }

    scenariosChanged = true
    if (scenario.mutexGroup) mutexClaimedEventIds.add(event.id)
    const consumedScenario = {
      ...scenario,
      queuedTransition: undefined,
      claimedEventIds: Array.from(new Set([...(scenario.claimedEventIds ?? []), event.id])).slice(-500),
      processedEventIds: Array.from(new Set([
        ...scenario.processedEventIds,
        ...world.events.map((candidate) => candidate.id),
      ])).slice(-500),
    }
    if (activeStage.ai && options.enableAi) {
      dialogueLaneOccupied = true
      return {
        ...consumedScenario,
        pendingAi: {
          stageId: activeStage.id,
          eventId: event.id,
          ...(branch ? { branchId: branch.id } : {}),
          requestedAtSeconds: world.elapsedSeconds,
        },
      }
    }
    if (visibleDialogue?.length) {
      dialogueLaneOccupied = true
      const firstLine = visibleDialogue[0]
      const updatedScenario: WorldScenarioRuntime = {
        ...consumedScenario,
        activeDialogue: {
          stageId: activeStage.id,
          eventId: event.id,
          ...(branch ? { branchId: branch.id } : {}),
          lineIndex: 0,
          lineEndsAtSeconds: world.elapsedSeconds + Math.max(0.5, firstLine.durationSeconds),
        },
      }
      nextWorld = stopDialogueParticipants(nextWorld, updatedScenario, visibleDialogue, 0, updatedScenario.activeDialogue!.lineEndsAtSeconds)
      return updatedScenario
    }
    const completed = startTimelineOrCompleteStage(nextWorld, consumedScenario, activeStageIndex, event, branch, undefined, 'authored', options.plan)
    nextWorld = completed.world
    return completed.scenario
  })

  const evaluatedById = new Map(evaluatedScenarios.map((scenario) => [scenario.id, scenario]))
  const nextScenarios = world.scenarios.map((scenario) => evaluatedById.get(scenario.id) ?? scenario)
  const worldChanged = nextWorld !== world
  return scenariosChanged || worldChanged ? { ...nextWorld, scenarios: nextScenarios } : nextWorld
}

export const getActiveWorldScenarioStage = (world: WorldState) => {
  return getActiveWorldScenarioStages(world)[0]
}

export const getActiveWorldScenarioStages = (world: WorldState) => world.scenarios.flatMap((scenario) => {
  if (scenario.enabled === false) return []
  const stage = scenario.stages.find((candidate) => candidate.status === 'active')
  return stage ? [{ scenario, stage }] : []
})
