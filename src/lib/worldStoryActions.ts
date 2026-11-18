import type { BrickStructure } from '../types/bricks'
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
export const getWorldStoryActions = (world: WorldState, structures: readonly BrickStructure[] = []): WorldStoryAction[] => {
  if (world.scenarios.some(scenario => scenario.enabled !== false && (scenario.activeDialogue || scenario.activeTimeline || scenario.pendingAi))) return []
  const hidden = new Set(world.hiddenTargets.filter(target => target.kind === 'entity').map(target => target.id))
  const actions: WorldStoryAction[] = []
  for (const { scenario } of orderWorldScenariosForEvaluation(world.scenarios)) {
    if (scenario.enabled === false || scenario.queuedTransition) continue
    const stage = scenario.stages.find(candidate => candidate.status === 'active')
    if (!stage) continue
    const choices = [
      { id: stage.id, label: stage.title, trigger: stage.trigger },
      ...(stage.branches ?? []).filter(branch => branch.trigger.eventType === 'command-complete')
        .map(branch => ({ id: branch.id, label: branch.title, trigger: branch.trigger })),
    ]
    for (const { id, label, trigger } of choices) {
      const type = trigger.eventType === 'interaction' ? 'interact'
        : trigger.eventType === 'defeated' || (trigger.eventType === 'command-issued' && trigger.commandType === 'attack') ? 'attack'
          : trigger.eventType === 'command-complete' && trigger.commandType === 'move' ? 'move'
            : undefined
      if (!type) continue
      const actor = world.entities.find(entity => entity.id === trigger.actorId && entity.controller === 'player')
        ?? (trigger.actorId ? undefined : world.entities.find(entity => entity.controller === 'player' && entity.health > 0 && !hidden.has(entity.id)
          && (!scenario.castEntityIds?.length || scenario.castEntityIds.includes(entity.id))))
      if (!actor || actor.health <= 0 || hidden.has(actor.id)) continue
      const entity = world.entities.find(candidate => candidate.id === trigger.targetId)
      const structure = type === 'move' ? structures.find(candidate => candidate.id === trigger.targetId) : undefined
      if (structure && world.hiddenTargets.some(target => target.kind === 'structure' && target.id === structure.id)) continue
      if (!structure && (!entity || actor.id === entity.id || entity.health <= 0 || hidden.has(entity.id))) continue
      if (trigger.conditions && !evaluateWorldScenarioConditions(world, trigger.conditions)) continue
      const target = structure ? { kind: 'structure' as const, id: structure.id } : { kind: 'entity' as const, id: entity!.id }
      const affinity = world.narrative.relationshipsByEntityId[actor.id]?.[target.id]?.affinity ?? 0
      if (trigger.minimumAffinity !== undefined && affinity < trigger.minimumAffinity) continue
      const current = actor.activeCommand ?? actor.commandQueue[0]
      const running = current?.type === type && 'target' in current && current.target.kind === target.kind && current.target.id === target.id
      const command: WorldEntityCommand = type === 'interact'
        ? { type, target: { kind: 'entity', id: target.id } }
        : { type, target }
      actions.push({ id: `${scenario.id}:${id}`, label, actorId: actor.id, actorName: actor.name, targetName: structure?.name ?? entity!.name, command, running })
    }
  }
  return actions.slice(0, 4)
}
