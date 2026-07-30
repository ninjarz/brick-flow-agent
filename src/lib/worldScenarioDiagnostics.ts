import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import type { WorldEvent, WorldState } from '../types/world'
import { advanceWorldScenarios } from './worldScenarioRuntime'

export type WorldScenarioRuntimeIssue = {
  scenarioId: string
  code:
    | 'MULTIPLE_ACTIVE_STAGES'
    | 'DIALOGUE_STAGE_MISSING'
    | 'TIMELINE_STAGE_MISSING'
    | 'TIMELINE_ACTION_MISSING'
    | 'QUEUED_EVENT_MISSING'
  detail: string
}

export const inspectWorldScenarioRuntime = (world: WorldState): WorldScenarioRuntimeIssue[] => (
  world.scenarios.flatMap((scenario) => {
    const issues: WorldScenarioRuntimeIssue[] = []
    const activeStages = scenario.stages.filter((stage) => stage.status === 'active')
    if (activeStages.length > 1) {
      issues.push({
        scenarioId: scenario.id,
        code: 'MULTIPLE_ACTIVE_STAGES',
        detail: activeStages.map((stage) => stage.id).join(','),
      })
    }
    const dialogueStage = scenario.activeDialogue
      ? scenario.stages.find((stage) => stage.id === scenario.activeDialogue?.stageId && stage.status === 'active')
      : undefined
    if (scenario.activeDialogue && !dialogueStage) {
      issues.push({
        scenarioId: scenario.id,
        code: 'DIALOGUE_STAGE_MISSING',
        detail: scenario.activeDialogue.stageId,
      })
    }
    const timelineStage = scenario.activeTimeline
      ? scenario.stages.find((stage) => stage.id === scenario.activeTimeline?.stageId && stage.status === 'active')
      : undefined
    if (scenario.activeTimeline && !timelineStage) {
      issues.push({
        scenarioId: scenario.id,
        code: 'TIMELINE_STAGE_MISSING',
        detail: scenario.activeTimeline.stageId,
      })
    } else if (scenario.activeTimeline && timelineStage) {
      const branch = scenario.activeTimeline.branchId
        ? timelineStage.branches?.find((candidate) => candidate.id === scenario.activeTimeline?.branchId)
        : undefined
      const actions = branch?.actions ?? timelineStage.actions ?? []
      if (scenario.activeTimeline.actionIndex >= actions.length) {
        issues.push({
          scenarioId: scenario.id,
          code: 'TIMELINE_ACTION_MISSING',
          detail: `${timelineStage.id}:${scenario.activeTimeline.actionIndex}/${actions.length}`,
        })
      }
    }
    if (
      scenario.queuedTransition
      && !world.events.some((event) => event.id === scenario.queuedTransition?.eventId)
    ) {
      issues.push({
        scenarioId: scenario.id,
        code: 'QUEUED_EVENT_MISSING',
        detail: scenario.queuedTransition.eventId,
      })
    }
    return issues
  })
)

export type WorldScenarioSimulationResult = {
  world: WorldState
  steps: number
  stalled: boolean
  issues: WorldScenarioRuntimeIssue[]
}

const hasActivePerformance = (world: WorldState) => world.scenarios.some((scenario) => (
  scenario.activeDialogue || scenario.activeTimeline || scenario.pendingAi
))

const nextPerformanceTime = (world: WorldState) => Math.min(
  ...world.scenarios.flatMap((scenario) => [
    scenario.activeDialogue?.lineEndsAtSeconds,
    scenario.activeTimeline?.nextActionAtSeconds,
  ].filter((value): value is number => Number.isFinite(value))),
)

export const settleWorldScenarioPerformance = (
  initialWorld: WorldState,
  options: { maxSteps?: number; enableAi?: boolean } = {},
): WorldScenarioSimulationResult => {
  const maxSteps = Math.max(1, options.maxSteps ?? 200)
  let world = initialWorld
  let steps = 0
  while (hasActivePerformance(world) && steps < maxSteps) {
    const nextTime = nextPerformanceTime(world)
    const elapsedSeconds = Number.isFinite(nextTime)
      ? Math.max(world.elapsedSeconds, nextTime)
      : world.elapsedSeconds
    const next = advanceWorldScenarios(
      elapsedSeconds === world.elapsedSeconds ? world : { ...world, elapsedSeconds },
      { enableAi: options.enableAi ?? false },
    )
    steps += 1
    if (next === world) break
    world = next
  }
  return {
    world,
    steps,
    stalled: hasActivePerformance(world),
    issues: inspectWorldScenarioRuntime(world),
  }
}

export const runWorldScenarioScript = (
  initialWorld: WorldState,
  events: WorldEvent[],
  options: { maxStepsPerEvent?: number; enableAi?: boolean } = {},
): WorldScenarioSimulationResult => {
  let world = initialWorld
  let steps = 0
  for (const event of events) {
    world = advanceWorldScenarios({
      ...world,
      elapsedSeconds: Math.max(world.elapsedSeconds, event.timeSeconds),
      events: [...world.events, event].slice(-500),
    }, { enableAi: options.enableAi ?? false })
    const settled = settleWorldScenarioPerformance(world, {
      maxSteps: options.maxStepsPerEvent,
      enableAi: options.enableAi,
    })
    world = settled.world
    steps += settled.steps + 1
    if (settled.stalled) return { ...settled, steps }
  }
  return {
    world,
    steps,
    stalled: hasActivePerformance(world),
    issues: inspectWorldScenarioRuntime(world),
  }
}

export type WorldEncounterBalance = {
  partyEntityIds: string[]
  enemyEntityId: string
  partyDamagePerSecond: number
  enemyDamagePerSecond: number
  secondsToDefeatEnemy: number
  secondsForEnemyToDefeatParty: number
  advantageRatio: number
  rating: 'lethal' | 'hard' | 'fair' | 'favorable'
}

const entityDamagePerSecond = (world: WorldState, entityId: string) => {
  const entity = world.entities.find((candidate) => candidate.id === entityId)
  const definition = entity ? worldEntityDefinitionById.get(entity.definitionId) : undefined
  if (!entity || !definition || entity.health <= 0) return 0
  const rangedAccuracy = definition.combat.projectileKind ? 0.82 : 0.92
  return definition.combat.damage / Math.max(0.1, definition.combat.cooldownSeconds) * rangedAccuracy
}

export const analyzeWorldEncounterBalance = (
  world: WorldState,
  leaderId: string,
  enemyId: string,
): WorldEncounterBalance | undefined => {
  const leader = world.entities.find((entity) => entity.id === leaderId && entity.health > 0)
  const enemy = world.entities.find((entity) => entity.id === enemyId && entity.health > 0)
  if (!leader || !enemy) return undefined
  const party = leader.partyId
    ? world.parties.find((candidate) => candidate.id === leader.partyId)
    : undefined
  const partyEntityIds = party
    ? party.members
        .filter((member) => member.status === 'active')
        .map((member) => member.entityId)
        .filter((entityId) => world.entities.some((entity) => entity.id === entityId && entity.health > 0))
    : [leader.id]
  const partyDamagePerSecond = partyEntityIds.reduce(
    (total, entityId) => total + entityDamagePerSecond(world, entityId),
    0,
  )
  const enemyDamagePerSecond = entityDamagePerSecond(world, enemy.id)
  if (partyDamagePerSecond <= 0 || enemyDamagePerSecond <= 0) return undefined
  const partyHealth = partyEntityIds.reduce(
    (total, entityId) => total + (world.entities.find((entity) => entity.id === entityId)?.health ?? 0),
    0,
  )
  const secondsToDefeatEnemy = enemy.health / partyDamagePerSecond
  const secondsForEnemyToDefeatParty = partyHealth / enemyDamagePerSecond
  const advantageRatio = secondsForEnemyToDefeatParty / secondsToDefeatEnemy
  return {
    partyEntityIds,
    enemyEntityId: enemy.id,
    partyDamagePerSecond,
    enemyDamagePerSecond,
    secondsToDefeatEnemy,
    secondsForEnemyToDefeatParty,
    advantageRatio,
    rating: advantageRatio < 0.65
      ? 'lethal'
      : advantageRatio < 1
        ? 'hard'
        : advantageRatio < 1.75
          ? 'fair'
          : 'favorable',
  }
}
