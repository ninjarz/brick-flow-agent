import type { WorldEntityCommand, WorldState } from '../types/world'
import { evaluateWorldScenarioConditions } from './worldScenarioRuntime'
import { orderWorldScenariosForEvaluation } from './worldScenarioScheduler'

export type WorldStoryAction = {
  id: string
  label: string
  actorId: string
  actorName: string
  targetName: string
  command: WorldEntityCommand
  running: boolean
}

/** Suggest only currently available authored objectives, using the runtime's conditions. */
export const getWorldStoryActions = (world: WorldState): WorldStoryAction[] => {
  if (world.scenarios.some(scenario => scenario.enabled !== false && (scenario.activeDialogue || scenario.activeTimeline || scenario.pendingAi))) return []
  const hidden = new Set(world.hiddenTargets.filter(target => target.kind === 'entity').map(target => target.id))
  const actions: WorldStoryAction[] = []
  for (const { scenario } of orderWorldScenariosForEvaluation(world.scenarios)) {
    if (scenario.enabled === false || scenario.queuedTransition) continue
    const stage = scenario.stages.find(candidate => candidate.status === 'active')
    if (!stage) continue
    const trigger = stage.trigger
    if (trigger.eventType !== 'interaction' && trigger.eventType !== 'defeated') continue
    const actor = world.entities.find(entity => entity.id === trigger.actorId && entity.controller === 'player')
      ?? (trigger.actorId ? undefined : world.entities.find(entity => entity.controller === 'player' && entity.health > 0 && !hidden.has(entity.id)
        && (!scenario.castEntityIds?.length || scenario.castEntityIds.includes(entity.id))))
    const target = world.entities.find(entity => entity.id === trigger.targetId)
    if (!actor || !target || actor.id === target.id || actor.health <= 0 || target.health <= 0 || hidden.has(actor.id) || hidden.has(target.id)) continue
    if (trigger.conditions && !evaluateWorldScenarioConditions(world, trigger.conditions)) continue
    const affinity = world.narrative.relationshipsByEntityId[actor.id]?.[target.id]?.affinity ?? 0
    if (trigger.minimumAffinity !== undefined && affinity < trigger.minimumAffinity) continue
    const type = trigger.eventType === 'interaction' ? 'interact' : 'attack'
    const current = actor.activeCommand ?? actor.commandQueue[0]
    const running = current?.type === type && 'target' in current && current.target.kind === 'entity' && current.target.id === target.id
    actions.push({ id: `${scenario.id}:${stage.id}`, label: stage.title, actorId: actor.id, actorName: actor.name, targetName: target.name, command: { type, target: { kind: 'entity', id: target.id } }, running })
  }
  return actions.slice(0, 4)
}
