import type { WorldClue, WorldNarrativeState, WorldState } from '../types/world'
import { tokenizeWorldText } from './worldCognition'

const maxCluesPerEntity = 32

const clampConfidence = (value: number) => Math.max(0.05, Math.min(1, value))

const cleanTags = (tags: readonly string[]) => Array.from(new Set(
  tags
    .map((tag) => tag.trim().toLocaleLowerCase().slice(0, 40))
    .filter(Boolean),
)).slice(0, 12)

export const normalizeWorldClue = (
  clue: WorldClue,
): WorldClue => ({
  ...clue,
  id: clue.id.trim().slice(0, 160),
  holderId: clue.holderId.trim().slice(0, 160),
  text: clue.text.trim().replace(/\s+/g, ' ').slice(0, 500),
  confidence: clampConfidence(clue.confidence),
  tags: cleanTags(clue.tags),
  learnedAtSeconds: Math.max(0, clue.learnedAtSeconds),
  ...(clue.sourceEntityId?.trim() ? { sourceEntityId: clue.sourceEntityId.trim().slice(0, 160) } : {}),
  ...(clue.sourceEventId?.trim() ? { sourceEventId: clue.sourceEventId.trim().slice(0, 160) } : {}),
})

export const grantWorldClue = (
  narrative: WorldNarrativeState,
  clue: WorldClue,
): WorldNarrativeState => {
  const normalized = normalizeWorldClue(clue)
  if (!normalized.id || !normalized.holderId || !normalized.text) return narrative
  const current = narrative.cluesByEntityId[normalized.holderId] ?? []
  const existing = current.find((candidate) => candidate.id === normalized.id)
  const merged = existing ? {
    ...existing,
    ...normalized,
    confidence: Math.max(existing.confidence, normalized.confidence),
    tags: cleanTags([...existing.tags, ...normalized.tags]),
    learnedAtSeconds: Math.min(existing.learnedAtSeconds, normalized.learnedAtSeconds),
  } : normalized
  const next = [
    ...current.filter((candidate) => candidate.id !== normalized.id),
    merged,
  ].slice(-maxCluesPerEntity)
  return {
    ...narrative,
    cluesByEntityId: {
      ...narrative.cluesByEntityId,
      [normalized.holderId]: next,
    },
  }
}

const overlapCount = (left: Set<string>, right: Set<string>) => {
  let count = 0
  left.forEach((token) => {
    if (right.has(token)) count += 1
  })
  return count
}

export const findWorldClueSharedByDialogue = (
  world: WorldState,
  speakerId: string,
  listenerId: string,
  text: string,
) => {
  const lineTokens = tokenizeWorldText(text)
  if (lineTokens.size === 0) return undefined
  const relationship = world.narrative.relationshipsByEntityId[speakerId]?.[listenerId]
  const trust = relationship?.trust ?? Math.max(0, relationship?.affinity ?? 0)
  return (world.narrative.cluesByEntityId[speakerId] ?? [])
    .filter((clue) => clue.kind !== 'secret' || trust >= 55)
    .map((clue) => {
      const clueTokens = tokenizeWorldText([clue.text, ...clue.tags].join(' '))
      const shared = overlapCount(lineTokens, clueTokens)
      return {
        clue,
        score: shared + (shared > 0 ? clue.confidence : 0),
      }
    })
    .filter(({ score }) => score >= 1.35)
    .sort((left, right) => right.score - left.score || left.clue.id.localeCompare(right.clue.id))[0]?.clue
}

export const propagateWorldClueFromDialogue = (
  world: WorldState,
  speakerId: string,
  listenerId: string,
  text: string,
): WorldState => {
  if (speakerId === listenerId) return world
  const clue = findWorldClueSharedByDialogue(world, speakerId, listenerId, text)
  if (!clue) return world
  const relationship = world.narrative.relationshipsByEntityId[listenerId]?.[speakerId]
  const trust = relationship?.trust ?? Math.max(0, relationship?.affinity ?? 0)
  const confidenceLoss = clue.kind === 'fact' ? 0.94 : clue.kind === 'secret' ? 0.88 : 0.78
  const trustBoost = Math.min(0.08, trust / 1_250)
  const narrative = grantWorldClue(world.narrative, {
    ...clue,
    holderId: listenerId,
    kind: clue.kind === 'secret' ? 'rumor' : clue.kind,
    confidence: clue.confidence * confidenceLoss + trustBoost,
    learnedAtSeconds: world.elapsedSeconds,
    sourceEntityId: speakerId,
  })
  return narrative === world.narrative ? world : { ...world, narrative }
}
