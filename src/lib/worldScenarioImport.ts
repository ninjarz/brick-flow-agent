import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import type { BuildPlan } from '../types/bricks'
import type { WorldEntity, WorldEntityCommand, WorldRelationship, WorldScenarioAction, WorldScenarioStage, WorldState, WorldStoryBlock, WorldTargetRef } from '../types/world'
import type { WorldScenarioAsset, WorldScenarioLoadResult } from '../types/worldScenario'
import { importAssetPlanIncrementally } from './incrementalAssetImport'
import { createId } from './planUtils'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'
import { findNearestAvailableWorldEntityPoint } from './worldEntityCollision'
import { isWorldEntityGroundPointBlockedByBricks } from './worldSimulation'

type IdFactory = (prefix: string) => string

const makeUniqueId = (prefix: string, usedIds: Set<string>, idFactory: IdFactory) => {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const id = idFactory(prefix)
    if (usedIds.has(id)) continue
    usedIds.add(id)
    return id
  }
  throw new Error(`Unable to create unique ${prefix} id`)
}

const remapTarget = (
  target: WorldTargetRef,
  entityIdMap: Record<string, string>,
  brickIdMap: Record<string, string>,
  structureIdMap: Record<string, string>,
): WorldTargetRef | undefined => {
  if (target.kind === 'entity') {
    const id = entityIdMap[target.id]
    return id ? { ...target, id } : undefined
  }
  if (target.kind === 'brick') {
    const id = brickIdMap[target.id]
    return id ? { ...target, id } : undefined
  }
  if (target.kind === 'structure') {
    const id = structureIdMap[target.id]
    return id ? { ...target, id } : undefined
  }
  return undefined
}

const remapCommand = (
  command: WorldEntityCommand,
  entityIdMap: Record<string, string>,
  brickIdMap: Record<string, string>,
  structureIdMap: Record<string, string>,
): WorldEntityCommand | undefined => {
  if (command.type === 'stop' || command.type === 'wander') return { ...command }
  if (command.type === 'patrol') return undefined
  const target = remapTarget(command.target, entityIdMap, brickIdMap, structureIdMap)
  if (!target) return undefined
  if (command.type === 'attack' && target.kind !== 'entity' && target.kind !== 'brick' && target.kind !== 'structure') return undefined
  if ((command.type === 'follow' || command.type === 'revive') && target.kind !== 'entity') return undefined
  return { ...command, target } as WorldEntityCommand
}

const remapScenarioWorld = (
  currentWorld: WorldState,
  nextPlan: BuildPlan,
  asset: WorldScenarioAsset,
  maps: {
    brickIdMap: Record<string, string>
    structureIdMap: Record<string, string>
    placementOffset: { x: number; y: number; z: number }
  },
  idFactory: IdFactory,
) => {
  const importedScenarioId = asset.scenario
    ? makeUniqueId('scenario', new Set(currentWorld.scenarios.map((scenario) => scenario.id)), idFactory)
    : undefined
  const usedEntityIds = new Set(currentWorld.entities.map((entity) => entity.id))
  const entityIdMap = Object.fromEntries(asset.world.entities.map((entity) => [
    entity.id,
    makeUniqueId('entity', usedEntityIds, idFactory),
  ]))
  const existingNames = new Set(currentWorld.entities.map((entity) => entity.name))
  const importedEntities: WorldEntity[] = []

  for (const template of asset.world.entities) {
    const definition = worldEntityDefinitionById.get(template.definitionId)
    if (!definition) continue
    const preferredPoint = {
      x: template.transform.x + maps.placementOffset.x,
      z: template.transform.z + maps.placementOffset.z,
    }
    const entity = createWorldEntity(definition, {
      id: entityIdMap[template.id],
      name: template.name,
      description: template.description,
      factionId: template.factionId,
      controller: template.controller,
      existingNames,
      transform: {
        x: preferredPoint.x,
        y: template.transform.y + maps.placementOffset.y,
        z: preferredPoint.z,
        rotationRadians: template.transform.rotationRadians,
      },
    })
    existingNames.add(entity.name)
    const availablePoint = findNearestAvailableWorldEntityPoint(
      entity,
      preferredPoint,
      [...currentWorld.entities, ...importedEntities],
      { isBlocked: (point) => isWorldEntityGroundPointBlockedByBricks(entity, point, nextPlan.bricks) },
    )
    if (!availablePoint) continue
    importedEntities.push({
      ...entity,
      ...(importedScenarioId ? { storylineId: importedScenarioId } : {}),
      transform: { ...entity.transform, ...availablePoint },
      commandQueue: template.commandQueue
        .map((command) => remapCommand(command, entityIdMap, maps.brickIdMap, maps.structureIdMap))
        .filter((command): command is WorldEntityCommand => Boolean(command)),
      autonomy: {
        ...entity.autonomy,
        home: {
          x: template.autonomy.home.x + maps.placementOffset.x,
          z: template.autonomy.home.z + maps.placementOffset.z,
        },
      },
    })
  }
  const importedEntityIdSet = new Set(importedEntities.map((entity) => entity.id))
  const safeImportedEntities = importedEntities.map((entity) => ({
    ...entity,
    commandQueue: entity.commandQueue.filter((command) => (
      !('target' in command) || command.target.kind !== 'entity' || importedEntityIdSet.has(command.target.id)
    )),
  }))

  const usedStoryIds = new Set(currentWorld.narrative.stories.map((story) => story.id))
  const importedStories = asset.world.narrative.stories.map((story) => ({
    ...story,
    id: makeUniqueId('story', usedStoryIds, idFactory),
    createdAtSeconds: currentWorld.elapsedSeconds,
    eventIds: [],
    characterIds: story.characterIds
      ?.map((id) => entityIdMap[id])
      .filter((id): id is string => Boolean(id) && importedEntityIdSet.has(id)),
    blocks: story.blocks?.reduce<WorldStoryBlock[]>((blocks, block) => {
      if (block.type === 'narration') return [...blocks, block]
      const speakerId = entityIdMap[block.speakerId]
      return speakerId ? [...blocks, { ...block, speakerId }] : blocks
    }, []),
    chapterNumber: undefined,
  }))
  const relationshipsByEntityId = { ...currentWorld.narrative.relationshipsByEntityId }
  for (const [sourceId, relationships] of Object.entries(asset.world.narrative.relationshipsByEntityId)) {
    const remappedSourceId = entityIdMap[sourceId]
    if (!remappedSourceId || !importedEntityIdSet.has(remappedSourceId)) continue
    relationshipsByEntityId[remappedSourceId] = Object.fromEntries(
      Object.entries(relationships).flatMap(([targetId, relationship]) => {
        const remappedTargetId = entityIdMap[targetId]
        if (!remappedTargetId || !importedEntityIdSet.has(remappedTargetId)) return []
        const remappedRelationship: WorldRelationship = {
          ...relationship,
          targetEntityId: remappedTargetId,
          updatedAtSeconds: currentWorld.elapsedSeconds,
        }
        return [[remappedTargetId, remappedRelationship]]
      }),
    )
  }

  const remapKnownId = (id: string) => entityIdMap[id] ?? maps.brickIdMap[id] ?? maps.structureIdMap[id]
  const importedHiddenTargets = asset.world.hiddenTargets.flatMap((target) => {
    const remapped = remapTarget(target, entityIdMap, maps.brickIdMap, maps.structureIdMap)
    return remapped && remapped.kind !== 'waypoint' ? [remapped] : []
  })
  const importedScenario = asset.scenario ? {
    ...asset.scenario,
    id: importedScenarioId!,
    castEntityIds: [...importedEntityIdSet],
    stages: asset.scenario.stages.flatMap((stage): WorldScenarioStage[] => {
      const actorId = stage.trigger.actorId ? entityIdMap[stage.trigger.actorId] : undefined
      const targetId = stage.trigger.targetId ? remapKnownId(stage.trigger.targetId) : undefined
      if ((stage.trigger.actorId && !actorId) || (stage.trigger.targetId && !targetId)) return []
      const actions = (stage.actions ?? []).flatMap((action): WorldScenarioAction[] => {
        if (action.type === 'set-faction') {
          const entityId = entityIdMap[action.entityId]
          return entityId ? [{ ...action, entityId }] : []
        }
        if (action.type === 'issue-command') {
          const entityId = entityIdMap[action.entityId]
          const command = remapCommand(action.command, entityIdMap, maps.brickIdMap, maps.structureIdMap)
          return entityId && command ? [{ ...action, entityId, command }] : []
        }
        if (action.type === 'set-visibility') {
          const target = remapTarget(action.target, entityIdMap, maps.brickIdMap, maps.structureIdMap)
          return target && target.kind !== 'waypoint' ? [{ ...action, target }] : []
        }
        return [{
          ...action,
          characterIds: action.characterIds
            ?.map((id) => entityIdMap[id])
            .filter((id): id is string => Boolean(id) && importedEntityIdSet.has(id)),
        }]
      })
      const dialogue = (stage.dialogue ?? []).flatMap((line) => {
        const speakerId = entityIdMap[line.speakerId]
        return speakerId ? [{ ...line, speakerId }] : []
      })
      const branches = (stage.branches ?? []).flatMap((branch) => {
        const branchActorId = branch.trigger.actorId ? entityIdMap[branch.trigger.actorId] : undefined
        const branchTargetId = branch.trigger.targetId ? remapKnownId(branch.trigger.targetId) : undefined
        if ((branch.trigger.actorId && !branchActorId) || (branch.trigger.targetId && !branchTargetId)) return []
        const branchActions = (branch.actions ?? []).flatMap((action): WorldScenarioAction[] => {
          if (action.type === 'set-faction') {
            const entityId = entityIdMap[action.entityId]
            return entityId ? [{ ...action, entityId }] : []
          }
          if (action.type === 'issue-command') {
            const entityId = entityIdMap[action.entityId]
            const command = remapCommand(action.command, entityIdMap, maps.brickIdMap, maps.structureIdMap)
            return entityId && command ? [{ ...action, entityId, command }] : []
          }
          if (action.type === 'set-visibility') {
            const target = remapTarget(action.target, entityIdMap, maps.brickIdMap, maps.structureIdMap)
            return target && target.kind !== 'waypoint' ? [{ ...action, target }] : []
          }
          return [{
            ...action,
            characterIds: action.characterIds?.map((id) => entityIdMap[id]).filter((id): id is string => Boolean(id) && importedEntityIdSet.has(id)),
          }]
        })
        return [{
          ...branch,
          trigger: { ...branch.trigger, ...(branchActorId ? { actorId: branchActorId } : {}), ...(branchTargetId ? { targetId: branchTargetId } : {}) },
          dialogue: (branch.dialogue ?? []).flatMap((line) => {
            const speakerId = entityIdMap[line.speakerId]
            return speakerId ? [{ ...line, speakerId }] : []
          }),
          actions: branchActions,
        }]
      })
      return [{
        ...stage,
        trigger: { ...stage.trigger, ...(actorId ? { actorId } : {}), ...(targetId ? { targetId } : {}) },
        ai: stage.ai ? {
          ...stage.ai,
          speakerIds: stage.ai.speakerIds
            ?.map((id) => entityIdMap[id])
            .filter((id): id is string => Boolean(id)),
        } : undefined,
        dialogue,
        branches,
        actions,
      }]
    }),
    processedEventIds: [],
    pendingAi: undefined,
    activeDialogue: undefined,
  } : undefined

  return {
    ...currentWorld,
    planId: nextPlan.id,
    entities: [...currentWorld.entities, ...safeImportedEntities],
    hiddenTargets: [...currentWorld.hiddenTargets, ...importedHiddenTargets],
    scenarios: importedScenario?.stages.length
      ? [...currentWorld.scenarios, importedScenario]
      : currentWorld.scenarios,
    narrative: {
      ...currentWorld.narrative,
      relationshipsByEntityId,
      stories: [...currentWorld.narrative.stories, ...importedStories],
    },
  } satisfies WorldState
}

export const addWorldScenario = (
  currentPlan: BuildPlan,
  currentWorld: WorldState,
  asset: WorldScenarioAsset,
  idFactory: IdFactory = createId,
): WorldScenarioLoadResult | undefined => {
  const imported = importAssetPlanIncrementally(currentPlan, asset.plan, idFactory)
  if (!imported) return undefined
  const world = remapScenarioWorld(currentWorld, imported.plan, asset, imported, idFactory)
  return {
    plan: imported.plan,
    world,
    importedBrickIds: imported.importedBrickIds,
    importedEntityIds: world.entities.slice(currentWorld.entities.length).map((entity) => entity.id),
  }
}

export const startWorldScenario = (
  asset: WorldScenarioAsset,
  idFactory: IdFactory = createId,
): WorldScenarioLoadResult | undefined => {
  const planId = idFactory('plan')
  const emptyPlan: BuildPlan = {
    ...asset.plan,
    id: planId,
    bricks: [],
    steps: [],
    structures: [],
  }
  const result = addWorldScenario(emptyPlan, createEmptyWorldState(planId), asset, idFactory)
  if (!result) return undefined
  return {
    ...result,
    plan: {
      ...result.plan,
      title: asset.plan.title,
      prompt: asset.plan.prompt,
      source: asset.plan.source,
    },
    world: {
      ...result.world,
      randomSeed: asset.world.randomSeed,
      paused: asset.world.paused,
    },
  }
}
