import type { BuildPlan } from '../types/bricks'
import type { WorldDirectorEntry, WorldDirectorEvent, WorldState } from '../types/world'
import {
  executeWorldDirectorPlaybackEvent,
  getWorldDirectorPlaybackOutcomeDetail,
  isBlockingWorldDirectorPlaybackOutcome,
  type WorldDirectorEventPlaybackPhase,
} from './worldDirectorPlayback'

export const getWorldDirectorPlaybackPhaseDetail = (
  phase: WorldDirectorEventPlaybackPhase,
) => phase === 'approaching'
  ? 'WAITING_FOR_PROXIMITY'
  : phase === 'speaking' || phase === 'acting'
    ? 'PLAYING'
    : phase === 'completed'
      ? 'PLAYED'
      : 'PLAYBACK_MISSED'

type SequenceEntryOptions = {
  id: string
  attempt?: number
  finishDialogueWhenVisible?: () => boolean
  onEntry?: (entry: WorldDirectorEntry) => void
}

export const createWorldDirectorSequenceRunner = ({
  getWorld,
  setWorld,
  readPlan,
  signal,
  timeoutMs,
  initialSimulationStarted = false,
  onSimulationStartedChange,
  pollIntervalMs,
  now,
  sleep,
}: {
  getWorld: () => WorldState
  setWorld: (world: WorldState) => void
  readPlan: () => Pick<BuildPlan, 'bricks' | 'structures'>
  signal: AbortSignal
  timeoutMs: number
  initialSimulationStarted?: boolean
  onSimulationStartedChange?: (started: boolean) => void
  pollIntervalMs?: number
  now?: () => number
  sleep?: (delayMs: number) => Promise<void>
}) => {
  let tail: Promise<void> = Promise.resolve()
  let simulationStarted = initialSimulationStarted
  let blocked = false
  const entityIds = new Set<string>()

  const enqueue = (
    event: WorldDirectorEvent,
    options: SequenceEntryOptions,
  ): Promise<WorldDirectorEntry | undefined> => {
    const task = tail.then(async () => {
      if (signal.aborted) return undefined
      const makeEntry = (
        patch: Pick<WorldDirectorEntry, 'status' | 'detail' | 'before' | 'after'> & {
          execution?: WorldDirectorEntry['execution']
        },
      ) => ({ ...event, id: options.id, ...patch }) as WorldDirectorEntry
      const attempt = Math.max(1, options.attempt ?? 1)
      if (blocked) {
        const entry = makeEntry({
          status: 'rejected',
          detail: 'BLOCKED_BY_PREVIOUS_EVENT',
          execution: { phase: 'skipped', attempt, retryable: false },
        })
        options.onEntry?.(entry)
        return entry
      }

      const plan = readPlan()
      const applied = await executeWorldDirectorPlaybackEvent({
        getWorld,
        setWorld,
        event,
        simulationStarted,
        bricks: plan.bricks,
        structures: plan.structures ?? [],
        signal,
        timeoutMs,
        finishDialogueWhenVisible: options.finishDialogueWhenVisible,
        onPhaseChange: (phase) => options.onEntry?.(makeEntry({
          status: 'accepted',
          detail: getWorldDirectorPlaybackPhaseDetail(phase),
          execution: {
            phase: phase === 'completed' ? 'confirmed' : phase === 'missed' ? 'failed' : phase,
            attempt,
            startedAtSeconds: getWorld().elapsedSeconds,
            retryable: phase === 'missed',
          },
        })),
        pollIntervalMs,
        now,
        sleep,
      })
      simulationStarted = applied.simulationStarted
      onSimulationStartedChange?.(simulationStarted)
      applied.entityIds.forEach((entityId) => entityIds.add(entityId))
      const entry = makeEntry({
        status: applied.status,
        detail: applied.outcome
          ? getWorldDirectorPlaybackOutcomeDetail(applied.outcome)
          : applied.detail,
        before: applied.before,
        after: applied.after,
        execution: {
          phase: applied.status === 'rejected' || isBlockingWorldDirectorPlaybackOutcome(applied.outcome)
            ? 'failed'
            : 'confirmed',
          attempt,
          startedAtSeconds: getWorld().elapsedSeconds,
          finishedAtSeconds: getWorld().elapsedSeconds,
          retryable: applied.status === 'rejected' || isBlockingWorldDirectorPlaybackOutcome(applied.outcome),
        },
      })
      options.onEntry?.(entry)
      blocked = applied.status === 'rejected' || isBlockingWorldDirectorPlaybackOutcome(applied.outcome)
      return entry
    })
    tail = task.then(() => undefined)
    return task
  }

  return {
    enqueue,
    drain: () => tail,
    getEntityIds: () => new Set(entityIds),
    isBlocked: () => blocked,
    hasStartedSimulation: () => simulationStarted,
  }
}
