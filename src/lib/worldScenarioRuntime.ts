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

const clearDialogueSpeech = (world: WorldState, stage: WorldScenarioStage) => {
  const participantIds = new Set([
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
) => {
  const dialogue = branch?.dialogue ?? stage.dialogue ?? []
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
        source: 'local' as const,
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
    activeDialogue: undefined,
    ...(branch ? { outcomeId: branch.id } : nextStageIndex < 0 || nextStageIndex >= stages.length ? { outcomeId: 'completed' } : {}),
  }
  let nextWorld = persistScenarioDialogue(clearDialogueSpeech(world, activeStage), scenario, activeStage, event, branch)
  for (const action of branch?.actions ?? activeStage.actions ?? []) {
    nextWorld = applyScenarioAction(nextWorld, updatedScenario, action, event)
  }
  return { world: nextWorld, scenario: updatedScenario }
}

export const advanceWorldScenarios = (world: WorldState): WorldState => {
  let nextWorld = world
  let scenariosChanged = false
  const nextScenarios = world.scenarios.map((scenario) => {
    if (scenario.enabled === false) return scenario
    const activeStageIndex = scenario.stages.findIndex((stage) => stage.status === 'active')
    if (activeStageIndex < 0) return scenario
    const activeStage = scenario.stages[activeStageIndex]
    if (scenario.activeDialogue?.stageId === activeStage.id) {
      const activeBranch = scenario.activeDialogue.branchId
        ? activeStage.branches?.find((branch) => branch.id === scenario.activeDialogue?.branchId)
        : undefined
      const dialogue = activeBranch?.dialogue ?? activeStage.dialogue ?? []
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
      const completed = completeStage(nextWorld, scenario, activeStageIndex, event, activeBranch)
      nextWorld = completed.world
      return completed.scenario
    }

    const consumedEventIds = new Set(scenario.processedEventIds)
    const transitions = [
      ...(activeStage.branches ?? []).map((branch) => ({ branch, trigger: branch.trigger })),
      { branch: undefined, trigger: activeStage.trigger },
    ]
    const matched = transitions
      .map((transition) => ({ ...transition, event: findLatestMatchingEvent(world.events, consumedEventIds, transition.trigger) }))
      .filter((transition): transition is typeof transition & { event: WorldEvent } => Boolean(transition.event))
      .sort((left, right) => right.event.timeSeconds - left.event.timeSeconds)[0]
    if (!matched) return scenario
    const { event, branch } = matched

    scenariosChanged = true
    const consumedScenario = {
      ...scenario,
      processedEventIds: Array.from(new Set([
        ...scenario.processedEventIds,
        ...world.events.map((candidate) => candidate.id),
      ])).slice(-500),
    }
    const dialogue = branch?.dialogue ?? activeStage.dialogue
    if (dialogue?.length) {
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
