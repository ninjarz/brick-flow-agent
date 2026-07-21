import type { WorldEvent, WorldScenarioAction, WorldScenarioRuntime, WorldScenarioTrigger, WorldState } from '../types/world'
import { issueWorldEntityCommand } from './worldEntity'

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
    const result = issueWorldEntityCommand(
      world,
      action.entityId,
      action.command,
      (target) => target.kind === 'entity' && world.entities.some((entity) => entity.id === target.id),
      'replace',
    )
    return result.ok ? result.world : world
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
        chapterNumber: world.narrative.stories.length + 1,
        source: 'local',
      }],
    },
  }
}

export const advanceWorldScenarios = (world: WorldState): WorldState => {
  let nextWorld = world
  let scenariosChanged = false
  const nextScenarios = world.scenarios.map((scenario) => {
    const activeStageIndex = scenario.stages.findIndex((stage) => stage.status === 'active')
    if (activeStageIndex < 0) return scenario
    const consumedEventIds = new Set(scenario.processedEventIds)
    const activeStage = scenario.stages[activeStageIndex]
    const event = findLatestMatchingEvent(world.events, consumedEventIds, activeStage.trigger)
    if (!event) return scenario

    scenariosChanged = true
    const stages = scenario.stages.map((stage, index) => {
      if (index === activeStageIndex) return { ...stage, status: 'completed' as const, completedAtSeconds: world.elapsedSeconds }
      if (index === activeStageIndex + 1 && stage.status === 'locked') return { ...stage, status: 'active' as const }
      return stage
    })
    const updatedScenario = {
      ...scenario,
      stages,
      processedEventIds: Array.from(new Set([
        ...scenario.processedEventIds,
        ...world.events.map((candidate) => candidate.id),
      ])).slice(-500),
    }
    for (const action of activeStage.actions ?? []) {
      nextWorld = applyScenarioAction(nextWorld, updatedScenario, action, event)
    }
    return updatedScenario
  })

  return scenariosChanged ? { ...nextWorld, scenarios: nextScenarios } : nextWorld
}

export const getActiveWorldScenarioStage = (world: WorldState) => {
  for (const scenario of world.scenarios) {
    const stage = scenario.stages.find((candidate) => candidate.status === 'active')
    if (stage) return { scenario, stage }
  }
  return undefined
}
