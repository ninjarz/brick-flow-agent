import type { WorldDirectorCheckpoint, WorldDirectorEntry, WorldDirectorTurn, WorldState } from '../types/world'

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

export const getWorldDirectorReplayEntries = (
  turn: WorldDirectorTurn,
  targetEntryId?: string,
) => {
  const targetIndex = targetEntryId
    ? turn.entries.findIndex((entry) => entry.id === targetEntryId)
    : turn.entries.length - 1
  if (targetIndex < 0) return []
  return turn.entries
    .slice(0, targetIndex + 1)
    .filter((entry) => entry.status !== 'rejected' || entry.id === targetEntryId)
}

export const replaceWorldDirectorTurnEntry = (
  world: WorldState,
  turnId: string,
  entry: WorldDirectorEntry,
): WorldState => ({
  ...world,
  narrative: {
    ...world.narrative,
    directorTurns: world.narrative.directorTurns.map((turn) => turn.id === turnId
      ? {
          ...turn,
          entries: turn.entries.map((candidate) => candidate.id === entry.id ? entry : candidate),
        }
      : turn),
  },
})
