import type { WorldScenarioRuntime, WorldState } from '../types/world'

export type WorldScenarioPlaytest = {
  scenarioId: string
  stageId: string
  checkpoint: WorldState
  startedAtSeconds: number
}

export const beginWorldScenarioPlaytest = (
  world: WorldState,
  scenario: WorldScenarioRuntime,
  stageId: string,
): { world: WorldState; session: WorldScenarioPlaytest } | undefined => {
  const stageIndex = scenario.stages.findIndex((stage) => stage.id === stageId)
  if (stageIndex < 0) return undefined
  const stagedScenario: WorldScenarioRuntime = {
    ...scenario,
    enabled: true,
    stages: scenario.stages.map((stage, index) => ({
      ...stage,
      status: index === stageIndex ? 'active' : 'locked',
      completedAtSeconds: undefined,
    })),
    processedEventIds: world.events.map((event) => event.id).slice(-500),
    claimedEventIds: [],
    pendingAi: undefined,
    activeDialogue: undefined,
    activeTimeline: undefined,
    queuedTransition: undefined,
    outcomeId: undefined,
  }
  return {
    session: { scenarioId: scenario.id, stageId, checkpoint: structuredClone(world), startedAtSeconds: world.elapsedSeconds },
    world: {
      ...world,
      paused: true,
      scenarios: world.scenarios.map((candidate) => candidate.id === scenario.id ? stagedScenario : { ...candidate, enabled: false }),
    },
  }
}

export const finishWorldScenarioPlaytest = (session: WorldScenarioPlaytest) => structuredClone(session.checkpoint)
