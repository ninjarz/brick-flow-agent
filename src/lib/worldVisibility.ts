import type { BrickStructure, PlacedBrick } from '../types/bricks'
import type { WorldState } from '../types/world'

export type WorldHiddenTargetIndex = {
  hiddenEntityIds: Set<string>
  hiddenStructureIds: Set<string>
  hiddenBrickIds: Set<string>
}

export type WorldVisibilityIndex = WorldHiddenTargetIndex & {
  visibleEntities: WorldState['entities']
  visibleBricks: PlacedBrick[]
  visibleStructures: BrickStructure[]
  visibleEvents: WorldState['events']
  visibleStories: WorldState['narrative']['stories']
}

export const createWorldHiddenTargetIndex = (
  hiddenTargets: WorldState['hiddenTargets'],
  structures: BrickStructure[],
): WorldHiddenTargetIndex => {
  const hiddenEntityIds = new Set<string>()
  const hiddenStructureIds = new Set<string>()
  const hiddenBrickIds = new Set<string>()

  for (const target of hiddenTargets) {
    if (target.kind === 'entity') hiddenEntityIds.add(target.id)
    else if (target.kind === 'structure') hiddenStructureIds.add(target.id)
    else hiddenBrickIds.add(target.id)
  }
  if (hiddenStructureIds.size > 0) {
    for (const structure of structures) {
      if (!hiddenStructureIds.has(structure.id)) continue
      for (const brickId of structure.brickIds) hiddenBrickIds.add(brickId)
    }
  }
  return { hiddenEntityIds, hiddenStructureIds, hiddenBrickIds }
}

export const isWorldEventVisible = (
  event: Pick<WorldState['events'][number], 'actorId' | 'targetId'>,
  hiddenEntityIds: ReadonlySet<string>,
) => !hiddenEntityIds.has(event.actorId)
  && !(event.targetId && hiddenEntityIds.has(event.targetId))

export const isWorldStoryVisible = (
  story: Pick<WorldState['narrative']['stories'][number], 'characterIds' | 'blocks' | 'body'>,
  visibleEntityIds: ReadonlySet<string>,
) => {
  if (story.characterIds?.some((entityId) => !visibleEntityIds.has(entityId))) return false

  if (story.blocks?.length) {
    return story.blocks.every((block) => (
      block.type !== 'dialogue' || visibleEntityIds.has(block.speakerId)
    ))
  }

  return true
}

/**
 * Resolves authoring-only hidden targets once for all runtime consumers.
 * Collection identity is preserved when a target kind has nothing hidden so
 * downstream WeakMap caches remain effective in the normal simulation path.
 */
export const createWorldVisibilityIndex = (
  world: Pick<WorldState, 'entities' | 'events' | 'hiddenTargets' | 'narrative'>,
  bricks: PlacedBrick[],
  structures: BrickStructure[],
): WorldVisibilityIndex => {
  const hidden = createWorldHiddenTargetIndex(world.hiddenTargets, structures)
  const { hiddenEntityIds, hiddenStructureIds, hiddenBrickIds } = hidden

  const visibleEntities = hiddenEntityIds.size === 0
    ? world.entities
    : world.entities.filter((entity) => !hiddenEntityIds.has(entity.id))
  const visibleEntityIdSet = new Set(visibleEntities.map((entity) => entity.id))
  const visibleEvents = hiddenEntityIds.size === 0
    ? world.events
    : world.events.filter((event) => isWorldEventVisible(event, hiddenEntityIds))
  const visibleStories = world.narrative.stories.filter((story) => (
    isWorldStoryVisible(story, visibleEntityIdSet)
  ))

  return {
    ...hidden,
    visibleEntities,
    visibleBricks: hiddenBrickIds.size === 0
      ? bricks
      : bricks.filter((brick) => !hiddenBrickIds.has(brick.id)),
    visibleStructures: hiddenStructureIds.size === 0
      ? structures
      : structures.filter((structure) => !hiddenStructureIds.has(structure.id)),
    visibleEvents,
    visibleStories,
  }
}
