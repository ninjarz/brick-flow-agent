import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import type { BuildPlan } from '../types/bricks'
import type { WorldEntity, WorldEntityCommand, WorldRelationship, WorldState, WorldTargetRef } from '../types/world'
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

  const usedStoryIds = new Set(currentWorld.narrative.stories.map((story) => story.id))
  const importedStories = asset.world.narrative.stories.map((story) => ({
    ...story,
    id: makeUniqueId('story', usedStoryIds, idFactory),
    createdAtSeconds: currentWorld.elapsedSeconds,
    eventIds: [],
    characterIds: story.characterIds
      ?.map((id) => entityIdMap[id])
      .filter((id): id is string => Boolean(id)),
    chapterNumber: currentWorld.narrative.stories.length + (story.chapterNumber ?? 1),
  }))
  const relationshipsByEntityId = { ...currentWorld.narrative.relationshipsByEntityId }
  for (const [sourceId, relationships] of Object.entries(asset.world.narrative.relationshipsByEntityId)) {
    const remappedSourceId = entityIdMap[sourceId]
    if (!remappedSourceId) continue
    relationshipsByEntityId[remappedSourceId] = Object.fromEntries(
      Object.entries(relationships).flatMap(([targetId, relationship]) => {
        const remappedTargetId = entityIdMap[targetId]
        if (!remappedTargetId) return []
        const remappedRelationship: WorldRelationship = {
          ...relationship,
          targetEntityId: remappedTargetId,
          updatedAtSeconds: currentWorld.elapsedSeconds,
        }
        return [[remappedTargetId, remappedRelationship]]
      }),
    )
  }

  return {
    ...currentWorld,
    planId: nextPlan.id,
    entities: [...currentWorld.entities, ...importedEntities],
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
