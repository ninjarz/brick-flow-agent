import type { WorldDirectorEvent, WorldEntityCommand, WorldState } from '../types/world'

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
