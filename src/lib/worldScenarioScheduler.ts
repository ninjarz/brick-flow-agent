import type { WorldScenarioRuntime, WorldState } from '../types/world'

export type WorldScenarioPerformanceKind = 'dialogue' | 'timeline' | 'ai'

export type WorldScenarioRuntimeStatus =
  | 'authoring'
  | 'paused'
  | 'queued'
  | 'dialogue'
  | 'timeline'
  | 'ai'
  | 'exploring'
  | 'completed'

export const getWorldScenarioPerformanceKind = (
  scenario: WorldScenarioRuntime,
): WorldScenarioPerformanceKind | undefined => scenario.activeDialogue
  ? 'dialogue'
  : scenario.activeTimeline
    ? 'timeline'
    : scenario.pendingAi
      ? 'ai'
      : undefined

export const getWorldScenarioRuntimeStatus = (
  scenario: WorldScenarioRuntime,
  authoring = false,
): WorldScenarioRuntimeStatus => {
  if (authoring) return 'authoring'
  if (scenario.enabled === false) return 'paused'
  const performance = getWorldScenarioPerformanceKind(scenario)
  if (performance) return performance
  if (scenario.queuedTransition) return 'queued'
  return scenario.stages.some((stage) => stage.status === 'active') ? 'exploring' : 'completed'
}

export const getWorldScenarioPlaybackLane = (world: Pick<WorldState, 'scenarios'>) => {
  const enabled = world.scenarios.filter((scenario) => scenario.enabled !== false)
  const owners = enabled
    .flatMap((scenario, index) => {
      const kind = getWorldScenarioPerformanceKind(scenario)
      return kind ? [{ scenarioId: scenario.id, title: scenario.title, kind, priority: scenario.priority ?? 0, index }] : []
    })
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
  const queued = enabled
    .flatMap((scenario, index) => scenario.queuedTransition ? [{
      scenarioId: scenario.id,
      title: scenario.title,
      eventId: scenario.queuedTransition.eventId,
      queuedAtSeconds: scenario.queuedTransition.queuedAtSeconds,
      priority: scenario.priority ?? 0,
      index,
    }] : [])
    .sort((left, right) => (
      left.queuedAtSeconds - right.queuedAtSeconds
      || right.priority - left.priority
      || left.index - right.index
    ))
  return {
    owner: owners[0],
    owners,
    queued,
  }
}

export const orderWorldScenariosForEvaluation = (
  scenarios: WorldScenarioRuntime[],
) => scenarios
  .map((scenario, index) => ({ scenario, index }))
  .sort((left, right) => {
    const leftOwnsLane = Boolean(getWorldScenarioPerformanceKind(left.scenario))
    const rightOwnsLane = Boolean(getWorldScenarioPerformanceKind(right.scenario))
    if (leftOwnsLane !== rightOwnsLane) return leftOwnsLane ? -1 : 1
    const leftQueuedAt = left.scenario.queuedTransition?.queuedAtSeconds
    const rightQueuedAt = right.scenario.queuedTransition?.queuedAtSeconds
    if (leftQueuedAt !== undefined || rightQueuedAt !== undefined) {
      if (leftQueuedAt === undefined) return 1
      if (rightQueuedAt === undefined) return -1
      if (leftQueuedAt !== rightQueuedAt) return leftQueuedAt - rightQueuedAt
    }
    return (right.scenario.priority ?? 0) - (left.scenario.priority ?? 0) || left.index - right.index
  })
