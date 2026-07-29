import type { WorldEvent, WorldScenarioAction, WorldScenarioBranch, WorldScenarioDialogueLine, WorldScenarioRuntime, WorldScenarioStage, WorldScenarioTrigger, WorldState } from '../types/world'
import { issueWorldEntityCommand } from './worldEntity'
import { makeScenarioDialogueStoryId } from './worldNarrativeFeed'

const eventMatchesTrigger = (event: WorldEvent, trigger: WorldScenarioTrigger) => (
  event.type === trigger.eventType &&
  (!trigger.actorId || event.actorId === trigger.actorId) &&
  (!trigger.targetId || event.targetId === trigger.targetId) &&
  (!trigger.commandType || event.commandType === trigger.commandType)
)

const findLatestMatchingEvent = (
  events: WorldEvent[],
  consumedEventIds: Set<string>,
  trigger: WorldScenarioTrigger,
) => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!consumedEventIds.has(event.id) && eventMatchesTrigger(event, trigger)) return event
  }
  return undefined
}

const applyScenarioAction = (
  world: WorldState,
  scenario: WorldScenarioRuntime,
  action: WorldScenarioAction,
  event: WorldEvent,
): WorldState => {
  if (action.type === 'set-faction') {
    return {
      ...world,
      entities: world.entities.map((entity) => entity.id === action.entityId
        ? { ...entity, factionId: action.factionId }
        : entity),
    }
  }
  if (action.type === 'issue-command') {
    if (world.hiddenTargets.some((target) => target.kind === 'entity' && target.id === action.entityId)) return world
    const result = issueWorldEntityCommand(
      world,
      action.entityId,
      action.command,
      (target) => target.kind === 'entity' && world.entities.some((entity) => entity.id === target.id),
      'replace',
    )
    return result.ok ? result.world : world
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
  for (const action of branch?.actions ?? activeStage.actions ?? []) {
    nextWorld = applyScenarioAction(nextWorld, updatedScenario, action, event)
  }
  return { world: nextWorld, scenario: updatedScenario }
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
  const allowedSpeakerIds = new Set(
    activeStage.ai.speakerIds?.length
      ? activeStage.ai.speakerIds
      : scenario.castEntityIds?.length
        ? scenario.castEntityIds
        : world.entities.map((entity) => entity.id),
  )
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
  const source = generatedDialogue.length ? 'ai' as const : 'authored' as const
  const clearedScenario = { ...scenario, pendingAi: undefined }

  if (dialogue.length > 0) {
    const firstLine = dialogue[0]
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
    const nextWorld = stopDialogueParticipants(world, updatedScenario, dialogue, 0, updatedScenario.activeDialogue!.lineEndsAtSeconds)
    return {
      ...nextWorld,
      scenarios: nextWorld.scenarios.map((candidate, index) => index === scenarioIndex ? updatedScenario : candidate),
    }
  }

  const completed = completeStage(world, clearedScenario, activeStageIndex, event, branch, undefined, source)
  return {
    ...completed.world,
    scenarios: completed.world.scenarios.map((candidate, index) => index === scenarioIndex ? completed.scenario : candidate),
  }
}

export const advanceWorldScenarios = (
  world: WorldState,
  options: { allowNewStages?: boolean; enableAi?: boolean } = {},
): WorldState => {
  let nextWorld = world
  let scenariosChanged = false
  let dialogueLaneOccupied = world.scenarios.some((scenario) => Boolean(scenario.activeDialogue || scenario.pendingAi))
  const claimedEventIds = new Set(world.scenarios.flatMap((scenario) => scenario.claimedEventIds ?? []))
  const nextScenarios = world.scenarios.map((scenario) => {
    if (scenario.enabled === false) return scenario
    if (scenario.pendingAi) {
      if (options.enableAi !== false) return scenario
      scenariosChanged = true
      nextWorld = resolveWorldScenarioAi(nextWorld, scenario.id, {})
      return nextWorld.scenarios.find((candidate) => candidate.id === scenario.id) ?? scenario
    }
    const activeStageIndex = scenario.stages.findIndex((stage) => stage.status === 'active')
    if (activeStageIndex < 0) return scenario
    const activeStage = scenario.stages[activeStageIndex]
    if (scenario.activeDialogue?.stageId === activeStage.id) {
      const activeBranch = scenario.activeDialogue.branchId
        ? activeStage.branches?.find((branch) => branch.id === scenario.activeDialogue?.branchId)
        : undefined
      const dialogue = scenario.activeDialogue.generatedDialogue ?? activeBranch?.dialogue ?? activeStage.dialogue ?? []
      if (dialogue.length === 0) return { ...scenario, activeDialogue: undefined }
      const currentLineIndex = Math.min(scenario.activeDialogue.lineIndex, dialogue.length - 1)
      nextWorld = stopDialogueParticipants(nextWorld, scenario, dialogue, currentLineIndex, scenario.activeDialogue.lineEndsAtSeconds)
      if (world.elapsedSeconds < scenario.activeDialogue.lineEndsAtSeconds) return scenario
      if (currentLineIndex + 1 < dialogue.length) {
        scenariosChanged = true
        const nextLineIndex = currentLineIndex + 1
        const nextLine = dialogue[nextLineIndex]
        const updatedScenario = {
          ...scenario,
          activeDialogue: {
            ...scenario.activeDialogue,
            lineIndex: nextLineIndex,
            lineEndsAtSeconds: world.elapsedSeconds + Math.max(0.5, nextLine.durationSeconds),
          },
        }
        nextWorld = stopDialogueParticipants(nextWorld, updatedScenario, dialogue, nextLineIndex, updatedScenario.activeDialogue.lineEndsAtSeconds)
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
      const completed = completeStage(
        nextWorld,
        scenario,
        activeStageIndex,
        event,
        activeBranch,
        scenario.activeDialogue.generatedDialogue,
        scenario.activeDialogue.source,
      )
      nextWorld = completed.world
      return completed.scenario
    }

    const consumedEventIds = new Set([...scenario.processedEventIds, ...claimedEventIds])
    const transitions = activeStage.ai?.mode === 'choice'
      ? [{ branch: undefined, trigger: activeStage.trigger }]
      : [
          ...(activeStage.branches ?? []).map((branch) => ({ branch, trigger: branch.trigger })),
          { branch: undefined, trigger: activeStage.trigger },
        ]
    const matched = transitions
      .map((transition) => ({ ...transition, event: findLatestMatchingEvent(world.events, consumedEventIds, transition.trigger) }))
      .filter((transition): transition is typeof transition & { event: WorldEvent } => Boolean(transition.event))
      .sort((left, right) => right.event.timeSeconds - left.event.timeSeconds)[0]
    if (!matched) return scenario
    if (options.allowNewStages === false) return scenario
    const { event } = matched
    const branch = activeStage.ai?.mode === 'choice' && !options.enableAi
      ? activeStage.branches?.find((candidate) => candidate.id === activeStage.ai?.fallbackBranchId)
      : matched.branch

    const dialogue = branch?.dialogue ?? activeStage.dialogue
    if (dialogue?.length && dialogueLaneOccupied) return scenario

    scenariosChanged = true
    claimedEventIds.add(event.id)
    const consumedScenario = {
      ...scenario,
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
    if (dialogue?.length) {
      dialogueLaneOccupied = true
      const firstLine = dialogue[0]
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
      nextWorld = stopDialogueParticipants(nextWorld, updatedScenario, dialogue, 0, updatedScenario.activeDialogue!.lineEndsAtSeconds)
      return updatedScenario
    }
    const completed = completeStage(nextWorld, consumedScenario, activeStageIndex, event, branch)
    nextWorld = completed.world
    return completed.scenario
  })

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
