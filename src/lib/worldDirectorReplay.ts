import type { WorldDirectorCheckpoint, WorldState } from '../types/world'

const clone = <T,>(value: T): T => structuredClone(value)

export const createWorldDirectorCheckpoint = (world: WorldState): WorldDirectorCheckpoint => {
  const { directorTurns, ...narrative } = world.narrative
  return clone({
    ...world,
    narrative,
    directorTurnIds: directorTurns.map((turn) => turn.id),
  })
}

export const restoreWorldDirectorCheckpoint = (
  current: WorldState,
  checkpoint: WorldDirectorCheckpoint,
): WorldState => {
  const retainedTurnIds = new Set(checkpoint.directorTurnIds)
  const directorTurns = current.narrative.directorTurns.filter((turn) => retainedTurnIds.has(turn.id))
  const { directorTurnIds: _directorTurnIds, ...scene } = checkpoint
  void _directorTurnIds
  return clone({
    ...scene,
    narrative: {
      ...checkpoint.narrative,
      directorTurns,
    },
  })
}
