import type {
  WorldDirectorEntry,
  WorldDirectorTurn,
  WorldState,
  WorldStory,
  WorldStoryBlock,
} from '../types/world'
import type { TavernDirectorStreamPreview } from './worldTavernDirector'

export type WorldNarrativeFeedBlock =
  | (WorldStoryBlock & { id: string })
  | WorldDirectorEntry

export type WorldNarrativeFeedItem = {
  id: string
  kind: 'story' | 'director-turn' | 'active-dialogue'
  createdAtSeconds: number
  blocks: WorldNarrativeFeedBlock[]
  title?: string
  playerText?: string
  source?: WorldStory['source']
  status?: WorldDirectorTurn['status'] | 'streaming'
  error?: string
  reasoning?: string
  requestMessage?: string
  responseMessage?: string
  contextStats?: WorldDirectorTurn['contextStats']
  streamPreview?: TavernDirectorStreamPreview
}

export type ActiveWorldDirectorTurn = Omit<WorldDirectorTurn, 'status'> & {
  status: WorldDirectorTurn['status'] | 'streaming'
  streamPreview?: TavernDirectorStreamPreview
}

export const makeScenarioDialogueStoryId = (
  scenarioId: string,
  stageId: string,
  eventId: string,
  branchId?: string,
) => `story-scenario-dialogue-${scenarioId}-${stageId}-${eventId}-${branchId ?? 'main'}`

const storyBlocks = (story: WorldStory): WorldNarrativeFeedBlock[] => {
  if (story.blocks !== undefined) {
    return story.blocks.map((block, index) => ({
      ...block,
      id: `${story.id}:block:${index}`,
    }))
  }

  return story.body
    .split(/\r?\n+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: `${story.id}:legacy:${index}`,
      type: 'narration' as const,
      text,
    }))
}

const storyFeedItem = (story: WorldStory): WorldNarrativeFeedItem => ({
  id: story.id,
  kind: 'story',
  createdAtSeconds: story.createdAtSeconds,
  blocks: storyBlocks(story),
  title: story.title,
  source: story.source,
})

const directorFeedItem = (turn: ActiveWorldDirectorTurn): WorldNarrativeFeedItem => ({
  id: turn.id,
  kind: 'director-turn',
  createdAtSeconds: turn.createdAtSeconds,
  blocks: turn.entries,
  playerText: turn.playerText,
  status: turn.status,
  error: turn.error,
  reasoning: turn.reasoning,
  requestMessage: turn.requestMessage,
  responseMessage: turn.responseMessage,
  contextStats: turn.contextStats,
  streamPreview: turn.streamPreview,
})

const activeDialogueFeedItems = (
  world: WorldState,
  persistedStoryIds: ReadonlySet<string>,
): WorldNarrativeFeedItem[] => world.scenarios.flatMap((scenario) => {
  const active = scenario.activeDialogue
  if (!active) return []

  const storyId = makeScenarioDialogueStoryId(
    scenario.id,
    active.stageId,
    active.eventId,
    active.branchId,
  )
  if (persistedStoryIds.has(storyId)) return []

  const stage = scenario.stages.find((candidate) => candidate.id === active.stageId)
  if (!stage) return []
  const branch = active.branchId
    ? stage.branches?.find((candidate) => candidate.id === active.branchId)
    : undefined
  const dialogue = branch?.dialogue ?? stage.dialogue ?? []
  const visibleDialogue = dialogue.slice(0, Math.min(dialogue.length, active.lineIndex + 1))
  if (visibleDialogue.length === 0) return []

  const triggerEvent = world.events.find((event) => event.id === active.eventId)
  return [{
    id: `active:${storyId}`,
    kind: 'active-dialogue' as const,
    createdAtSeconds: triggerEvent?.timeSeconds ?? world.elapsedSeconds,
    title: stage.title,
    blocks: visibleDialogue.map((line) => ({
      id: `${storyId}:line:${line.id}`,
      type: 'dialogue' as const,
      speakerId: line.speakerId,
      text: line.text,
    })),
    status: 'streaming' as const,
  }]
})

export const buildWorldNarrativeFeed = (
  world: WorldState,
  activeTurn?: ActiveWorldDirectorTurn,
): WorldNarrativeFeedItem[] => {
  const persistedStoryIds = new Set(world.narrative.stories.map((story) => story.id))
  const items = [
    ...world.narrative.stories.map(storyFeedItem),
    ...world.narrative.directorTurns
      .filter((turn) => turn.id !== activeTurn?.id)
      .map(directorFeedItem),
    ...(activeTurn ? [directorFeedItem(activeTurn)] : []),
    ...activeDialogueFeedItems(world, persistedStoryIds),
  ]

  return items
    .map((item, order) => ({ item, order }))
    .sort((left, right) => (
      left.item.createdAtSeconds - right.item.createdAtSeconds ||
      left.order - right.order
    ))
    .map(({ item }) => item)
}
