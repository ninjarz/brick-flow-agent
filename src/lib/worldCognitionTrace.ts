import type { WorldState } from '../types/world'
import { rankWorldCognitionCandidates, rankWorldSpeakers, type WorldCognitionCandidate } from './worldCognition'

export type WorldCognitionTraceCandidate = {
  entityId: string
  name: string
  score: number
  reasons: WorldCognitionCandidate['reasons']
  selected: boolean
  deltaScore?: number
}

export type WorldCognitionTraceSpeaker = {
  entityId: string
  name: string
  score: number
  selected: boolean
}

export type WorldCognitionTraceEntry = {
  id: string
  timeSeconds: number
  cadenceMs?: number
  candidates: WorldCognitionTraceCandidate[]
  speakers: WorldCognitionTraceSpeaker[]
}

const speakerTraceLimit = 3

/**
 * Ranks every eligible character (not just the top slice) so the debug trace
 * can also explain why a character stayed silent. `selectedLimit` must match
 * the limit used when the AI snapshot is built (worldAi.ts default of 4).
 * Speaker candidates mirror the snapshot's listener/context so the trace
 * answers both "who reconsiders" and "who would speak".
 */
export const buildWorldCognitionTraceEntry = (
  world: WorldState,
  selectedLimit = 4,
  cadenceMs?: number,
): WorldCognitionTraceEntry => {
  const nameById = new Map(world.entities.map((entity) => [entity.id, entity.name]))
  const ranked = rankWorldCognitionCandidates(world, Math.max(selectedLimit, world.entities.length))
  const protagonist = world.entities.find((entity) => entity.controller === 'player' && entity.health > 0)
  const speakerContext = [
    ...world.narrative.stories.slice(-2).map((story) => story.body),
    ...world.events.slice(-4).flatMap((event) => [event.actorName, event.targetName, event.dialogueText].filter(Boolean) as string[]),
  ].join(' ')
  const speakers = protagonist
    ? rankWorldSpeakers(world, protagonist, speakerContext, Math.max(speakerTraceLimit, world.entities.length))
    : []
  return {
    id: `cognition-trace-${world.elapsedSeconds.toFixed(2)}-${ranked.length}`,
    timeSeconds: Number(world.elapsedSeconds.toFixed(2)),
    ...(cadenceMs === undefined ? {} : { cadenceMs }),
    candidates: ranked.map((candidate, index) => ({
      entityId: candidate.entityId,
      name: nameById.get(candidate.entityId) ?? candidate.entityId,
      score: candidate.score,
      reasons: candidate.reasons,
      selected: index < selectedLimit,
    })),
    speakers: speakers.map((speaker, index) => ({
      entityId: speaker.entityId,
      name: nameById.get(speaker.entityId) ?? speaker.entityId,
      score: speaker.score,
      selected: index < speakerTraceLimit,
    })),
  }
}

export type WorldCognitionTraceStore = {
  record: (entry: WorldCognitionTraceEntry) => WorldCognitionTraceEntry
  entries: () => WorldCognitionTraceEntry[]
  clear: () => void
}

/**
 * Bounded ring buffer of cognition evaluations. Each recorded entry is
 * annotated with per-entity score deltas against the previous entry so score
 * drift is visible without manual comparison.
 */
export const createWorldCognitionTraceStore = (limit = 24): WorldCognitionTraceStore => {
  const capacity = Math.max(1, Math.floor(limit))
  const buffer: WorldCognitionTraceEntry[] = []
  let sequence = 0
  return {
    record: (entry) => {
      const previous = buffer.at(-1)
      const previousScoreById = new Map(previous?.candidates.map((candidate) => [candidate.entityId, candidate.score]) ?? [])
      const annotated: WorldCognitionTraceEntry = {
        ...entry,
        id: `${entry.id}-${(sequence += 1).toString(36)}`,
        candidates: entry.candidates.map((candidate) => {
          const previousScore = previousScoreById.get(candidate.entityId)
          return previousScore === undefined
            ? candidate
            : { ...candidate, deltaScore: Number((candidate.score - previousScore).toFixed(3)) }
        }),
      }
      buffer.push(annotated)
      if (buffer.length > capacity) buffer.splice(0, buffer.length - capacity)
      return annotated
    },
    entries: () => [...buffer],
    clear: () => {
      buffer.splice(0, buffer.length)
    },
  }
}
