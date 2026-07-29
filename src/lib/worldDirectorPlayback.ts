import type { BrickStructure, PlacedBrick } from '../types/bricks'
import type { WorldDirectorEvent, WorldEntityCommand, WorldState } from '../types/world'
import { applyTavernDirectorEvent } from './worldTavernDirector'

const isFiniteDirectorCommand = (command: WorldEntityCommand) => (
  command.type === 'move'
  || command.type === 'interact'
  || command.type === 'attack'
  || command.type === 'revive'
)

export const getWorldDirectorPlaybackEntityIds = (event: WorldDirectorEvent) => {
  if (event.type === 'command') {
    return event.command.type === 'stop' ? [] : [event.entityId]
  }
  if (event.type === 'dialogue') {
    return [event.speakerId, ...(event.listenerId ? [event.listenerId] : [])]
  }
  return []
}

export const shouldStartWorldDirectorPlayback = (event: WorldDirectorEvent) => (
  event.type === 'dialogue' || event.type === 'command'
)

export const applyWorldDirectorPlaybackEvent = ({
  world,
  event,
  simulationStarted,
  bricks,
  structures,
}: {
  world: WorldState
  event: WorldDirectorEvent
  simulationStarted: boolean
  bricks: PlacedBrick[]
  structures: BrickStructure[]
}) => {
  const mayStartSimulation = shouldStartWorldDirectorPlayback(event) && !simulationStarted
  const eventWorld = mayStartSimulation ? prepareWorldForDirectorPlayback(world) : world
  const applied = applyTavernDirectorEvent(eventWorld, event, { bricks, structures })
  const accepted = applied.status !== 'rejected'
  const startsSimulation = accepted && mayStartSimulation
  const acceptedWorld = accepted ? applied.world : world
  const nextWorld = startsSimulation && acceptedWorld.paused
    ? { ...acceptedWorld, paused: false }
    : acceptedWorld
  return {
    world: nextWorld,
    simulationStarted: simulationStarted || startsSimulation,
    entityIds: accepted ? getWorldDirectorPlaybackEntityIds(event) : [],
    status: applied.status,
    detail: applied.detail,
    before: applied.before,
    after: applied.after,
  }
}

export const prepareWorldForDirectorPlayback = (world: WorldState): WorldState => {
  let changed = false
  const entities = world.entities.map((entity) => {
    if (
      entity.controller === 'player'
      || (
        !entity.activeCommand
        && entity.commandQueue.length === 0
        && entity.navigation.status === 'idle'
        && entity.navigation.path.length === 0
        && entity.behaviorState === (entity.health > 0 ? 'idle' : 'dead')
        && !entity.combat.attackTargetId
      )
    ) return entity
    changed = true
    return {
      ...entity,
      activeCommand: undefined,
      commandQueue: [],
      behaviorState: entity.health > 0 ? 'idle' as const : 'dead' as const,
      navigation: { status: 'idle' as const, path: [], pathIndex: 0 },
      combat: { ...entity.combat, attackTargetId: undefined },
    }
  })
  return changed ? { ...world, entities } : world
}

export const isWorldDirectorPlaybackSettled = (world: WorldState, entityIds: ReadonlySet<string>) => {
  if (entityIds.size === 0) return true
  return world.entities
    .filter((entity) => entityIds.has(entity.id))
    .every((entity) => {
      const hasPendingCommand = (
        (entity.activeCommand && isFiniteDirectorCommand(entity.activeCommand))
        || entity.commandQueue.some(isFiniteDirectorCommand)
      )
      const isSpeaking = Boolean(entity.speech && entity.speech.expiresAtSeconds > world.elapsedSeconds)
      return !hasPendingCommand && !isSpeaking
    })
}

export const isWorldDirectorDialogueVisible = (
  world: WorldState,
  speakerId: string,
  text: string,
) => {
  const speaker = world.entities.find((entity) => entity.id === speakerId)
  return Boolean(
    speaker?.speech?.message === 'scenario-dialogue'
    && speaker.speech.text === text
    && speaker.speech.expiresAtSeconds > world.elapsedSeconds,
  )
}

export type WorldDirectorDialoguePlaybackPhase = 'approaching' | 'speaking' | 'completed' | 'missed'
export type WorldDirectorDialoguePlaybackOutcome = 'played' | 'missed' | 'timed-out' | 'paused' | 'aborted'

export const getWorldDirectorPlaybackOutcomeDetail = (
  outcome: WorldDirectorDialoguePlaybackOutcome,
) => outcome === 'played'
  ? 'PLAYED'
  : outcome === 'missed'
    ? 'PLAYBACK_MISSED'
    : outcome === 'timed-out'
      ? 'PLAYBACK_TIMEOUT'
      : outcome === 'paused'
        ? 'PLAYBACK_PAUSED'
        : 'PLAYBACK_STOPPED'

export const getWorldDirectorDialoguePlaybackPhase = ({
  world,
  event,
  entityIds,
  dialogueWasVisible,
}: {
  world: WorldState
  event: Extract<WorldDirectorEvent, { type: 'dialogue' }>
  entityIds: ReadonlySet<string>
  dialogueWasVisible: boolean
}): WorldDirectorDialoguePlaybackPhase => {
  if (isWorldDirectorDialogueVisible(world, event.speakerId, event.text)) return 'speaking'
  if (!isWorldDirectorPlaybackSettled(world, entityIds)) return 'approaching'
  return dialogueWasVisible ? 'completed' : 'missed'
}

export const waitForWorldDirectorDialoguePlayback = async ({
  getWorld,
  event,
  entityIds,
  signal,
  timeoutMs,
  finishWhenVisible = () => false,
  onPhaseChange,
  pollIntervalMs = 100,
  now = () => performance.now(),
  sleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
}: {
  getWorld: () => WorldState
  event: Extract<WorldDirectorEvent, { type: 'dialogue' }>
  entityIds: ReadonlySet<string>
  signal: AbortSignal
  timeoutMs: number
  finishWhenVisible?: () => boolean
  onPhaseChange?: (phase: WorldDirectorDialoguePlaybackPhase) => void
  pollIntervalMs?: number
  now?: () => number
  sleep?: (delayMs: number) => Promise<void>
}): Promise<WorldDirectorDialoguePlaybackOutcome> => {
  const deadline = now() + timeoutMs
  let dialogueWasVisible = false
  let previousPhase: WorldDirectorDialoguePlaybackPhase | undefined

  while (true) {
    if (signal.aborted) return 'aborted'
    const world = getWorld()
    const phase = getWorldDirectorDialoguePlaybackPhase({
      world,
      event,
      entityIds,
      dialogueWasVisible,
    })
    if (phase !== previousPhase) {
      previousPhase = phase
      onPhaseChange?.(phase)
    }
    if (phase === 'speaking') {
      dialogueWasVisible = true
      if (finishWhenVisible()) return 'played'
    } else if (phase === 'completed') {
      return 'played'
    } else if (phase === 'missed') {
      return 'missed'
    }
    if (world.paused) return 'paused'
    if (now() >= deadline) return 'timed-out'
    await sleep(pollIntervalMs)
  }
}

export const isWorldDirectorPlaybackSettledIgnoringSpeech = (
  world: WorldState,
  entityIds: ReadonlySet<string>,
  ignoredSpeechEntityIds: ReadonlySet<string>,
) => {
  if (entityIds.size === 0) return true
  return world.entities
    .filter((entity) => entityIds.has(entity.id))
    .every((entity) => {
      const hasPendingCommand = (
        (entity.activeCommand && isFiniteDirectorCommand(entity.activeCommand))
        || entity.commandQueue.some(isFiniteDirectorCommand)
      )
      const isSpeaking = (
        !ignoredSpeechEntityIds.has(entity.id)
        && Boolean(entity.speech && entity.speech.expiresAtSeconds > world.elapsedSeconds)
      )
      return !hasPendingCommand && !isSpeaking
    })
}
