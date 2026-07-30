import type { LlmConfig } from '../types/bricks'
import type { WorldState } from '../types/world'
import { requestLlmJsonContent } from './llmGenerator'
import type { TavernActivityKind, TavernActivityResult } from './worldTavernActivities'

type TavernAiLocale = 'zh-CN' | 'en-US'

export type TavernAiResponse = {
  title: string
  narration: string
  lines: Array<{ speakerId: string; text: string }>
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]) => (
  Object.keys(value).every((key) => keys.includes(key))
)

const cleanText = (value: unknown, maxLength: number) => (
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : ''
)

export const parseTavernAiResponse = (value: unknown, participantIds: string[]): TavernAiResponse | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['title', 'narration', 'lines']) || !Array.isArray(value.lines)) return undefined
  const allowedIds = new Set(participantIds)
  const usedIds = new Set<string>()
  const lines = value.lines.flatMap((line) => {
    if (!isRecord(line) || !hasOnlyKeys(line, ['speakerId', 'text'])) return []
    const speakerId = cleanText(line.speakerId, 160)
    const text = cleanText(line.text, 72)
    if (!allowedIds.has(speakerId) || usedIds.has(speakerId) || !text) return []
    usedIds.add(speakerId)
    return [{ speakerId, text }]
  }).slice(0, participantIds.length)
  const title = cleanText(value.title, 48)
  const narration = cleanText(value.narration, 240)
  if (!title && !narration && lines.length === 0) return undefined
  return { title, narration, lines }
}

const extractJsonObject = (content: string) => {
  const trimmed = content.trim()
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonText = fencedMatch?.[1] ?? trimmed
  const objectMatch = jsonText.match(/\{[\s\S]*\}/)
  return JSON.parse(objectMatch?.[0] ?? jsonText) as unknown
}

const activityLabel = (activity: TavernActivityKind, locale: TavernAiLocale) => {
  if (locale === 'zh-CN') return activity === 'toast' ? '碰杯' : activity === 'dice' ? '骰局' : '交换传闻'
  return activity === 'toast' ? 'raising a mug' : activity === 'dice' ? 'a dice game' : 'sharing a rumor'
}

export const buildTavernAiPrompt = (
  world: WorldState,
  activity: TavernActivityKind,
  base: TavernActivityResult,
  locale: TavernAiLocale,
) => {
  const participants = base.participantIds.flatMap((id) => {
    const entity = world.entities.find((candidate) => candidate.id === id)
    if (!entity) return []
    return [{
      id: entity.id,
      name: entity.name,
      description: entity.description,
      factionId: entity.factionId,
      health: `${entity.health}/${entity.maxHealth}`,
      memories: (world.narrative.memoriesByEntityId[entity.id] ?? []).slice(-4).map((memory) => ({
        type: memory.type,
        otherName: memory.otherName,
        importance: memory.importance,
      })),
      relationships: Object.values(world.narrative.relationshipsByEntityId[entity.id] ?? {})
        .filter((relationship) => base.participantIds.includes(relationship.targetEntityId))
        .map((relationship) => ({
          targetEntityId: relationship.targetEntityId,
          affinity: relationship.affinity,
          trust: relationship.trust ?? Math.max(0, relationship.affinity),
          hostility: relationship.hostility ?? Math.max(0, -relationship.affinity),
          fear: relationship.fear ?? 0,
          encounters: relationship.encounters,
        })),
    }]
  })
  const activeObjective = world.scenarios.flatMap((scenario) => scenario.stages)
    .find((stage) => stage.status === 'active')
  const context = {
    activity: activityLabel(activity, locale),
    immutableResult: base.body,
    participants,
    activeObjective: activeObjective ? { title: activeObjective.title, description: activeObjective.description } : undefined,
    recentStoryTitles: world.narrative.stories.slice(-5).map((story) => story.title),
  }
  return `${locale === 'zh-CN' ? '用以下事实导演一个轻松、简短、有角色感的酒馆片段。' : 'Direct a short, playful, characterful tavern scene from these facts.'}
${JSON.stringify(context)}

Return exactly:
{
  "title": "short scene title",
  "narration": "one short paragraph that adds atmosphere without changing the immutable result",
  "lines": [
    { "speakerId": "one participant id", "text": "one short spoken line" }
  ]
}

Rules:
- The immutableResult already happened. Never contradict dice rolls, survival, identities, factions, or the current objective.
- Use only participant IDs listed above. At most one line per participant.
- Keep each line under 36 Chinese characters or 72 English characters.
- Do not create commands, coordinates, health changes, faction changes, combat, rewards, or new characters.
- A rumor may be uncertain; never present an unverified rumor as established fact.
- Avoid repeating recent story titles and avoid generic greetings.
- Output JSON only and no extra fields.`
}

export const tavernAiSystemPrompt = `You are a restrained tavern scene director for a persistent brick world.
Rules and simulation own all facts. You only add concise narration and dialogue to an event that already happened.
Return one compact JSON object and never emit commands or direct state mutations.`

export const applyTavernAiResponse = (
  currentWorld: WorldState,
  base: TavernActivityResult,
  response: TavernAiResponse,
): TavernActivityResult => {
  const title = response.title || base.title
  const body = response.narration ? `${base.body}\n${response.narration}` : base.body
  const speechById = new Map(response.lines.map((line) => [line.speakerId, line.text]))
  const maxLineLength = Math.max(0, ...response.lines.map((line) => line.text.length))
  const expiresAtSeconds = currentWorld.elapsedSeconds + Math.min(14, Math.max(9, 4 + maxLineLength / 7))
  const localSpeechById = new Map(base.world.entities.flatMap((entity) => (
    base.participantIds.includes(entity.id) && entity.speech ? [[entity.id, entity.speech] as const] : []
  )))
  const world: WorldState = {
    ...currentWorld,
    entities: currentWorld.entities.map((entity) => {
      if (!base.participantIds.includes(entity.id)) return entity
      const aiText = speechById.get(entity.id)
      const localSpeech = localSpeechById.get(entity.id)
      if (!aiText && !localSpeech) return entity
      return {
        ...entity,
        activeCommand: undefined,
        commandQueue: [],
        behaviorState: 'idle',
        navigation: { status: 'idle', path: [], pathIndex: 0 },
        speech: aiText
          ? { message: 'scenario-dialogue', text: aiText, expiresAtSeconds }
          : { ...localSpeech!, expiresAtSeconds },
        autonomy: { ...entity.autonomy, nextDecisionAtSeconds: expiresAtSeconds },
      }
    }),
    narrative: {
      ...currentWorld.narrative,
      stories: currentWorld.narrative.stories.map((story) => story.id === base.storyId ? {
        ...story,
        title,
        body,
        blocks: [
          { type: 'narration' as const, text: base.body },
          ...(response.narration ? [{ type: 'narration' as const, text: response.narration }] : []),
          ...response.lines.map((line) => ({ type: 'dialogue' as const, speakerId: line.speakerId, text: line.text })),
        ],
        source: 'ai',
      } : story),
    },
  }
  return { ...base, world, title, body, source: 'ai' }
}

export const requestTavernAiActivity = async (input: {
  world: WorldState
  activity: TavernActivityKind
  base: TavernActivityResult
  config: LlmConfig
  locale: TavernAiLocale
  signal?: AbortSignal
}) => {
  const content = await requestLlmJsonContent({
    config: input.config,
    systemPrompt: tavernAiSystemPrompt,
    userPrompt: buildTavernAiPrompt(input.world, input.activity, input.base, input.locale),
    locale: input.locale,
    signal: input.signal,
    temperature: 0.7,
    maxTokens: 800,
  })
  const parsed = parseTavernAiResponse(extractJsonObject(content), input.base.participantIds)
  if (!parsed) throw new Error(input.locale === 'zh-CN' ? 'AI 酒馆对白格式无效' : 'Invalid AI tavern dialogue format')
  return parsed
}
