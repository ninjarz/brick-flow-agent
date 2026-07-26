import type { BrickStructure, PlacedBrick } from '../types/bricks'
import type { WorldDirectorEntry, WorldDirectorEvent, WorldEntityCommand, WorldRelationship, WorldState, WorldTargetRef } from '../types/world'
import type { WorldAiSnapshot } from './worldAi'
import { issueWorldEntityCommand } from './worldEntity'

export type TavernDirectorEvent = WorldDirectorEvent
export type TavernDirectorEntry = WorldDirectorEntry

type DirectorLocale = 'zh-CN' | 'en-US'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const exactKeys = (value: Record<string, unknown>, allowed: string[]) => (
  Object.keys(value).every((key) => allowed.includes(key))
)

const cleanText = (value: unknown, maxLength: number) => (
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : ''
)

const parseTarget = (value: unknown): WorldTargetRef | undefined => {
  if (!isRecord(value) || !exactKeys(value, ['kind', 'id'])) return undefined
  const kind = cleanText(value.kind, 20)
  const id = cleanText(value.id, 160)
  if (!id || !['entity', 'brick', 'structure'].includes(kind)) return undefined
  return { kind, id } as WorldTargetRef
}

const parseCommand = (value: unknown): WorldEntityCommand | undefined => {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'stop' && exactKeys(value, ['type'])) return { type: 'stop' }
  if (value.type === 'wander' && exactKeys(value, ['type'])) return { type: 'wander' }
  if (!exactKeys(value, ['type', 'target'])) return undefined
  const target = parseTarget(value.target)
  if (!target || !['move', 'attack', 'revive', 'guard', 'follow', 'interact'].includes(value.type)) return undefined
  if (value.type === 'attack' && !['entity', 'brick', 'structure'].includes(target.kind)) return undefined
  if ((value.type === 'revive' || value.type === 'follow') && target.kind !== 'entity') return undefined
  return { type: value.type, target } as WorldEntityCommand
}

export const parseTavernDirectorEvent = (value: unknown): TavernDirectorEvent | undefined => {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'narration' && exactKeys(value, ['type', 'text'])) {
    const text = cleanText(value.text, 500)
    return text ? { type: value.type, text } : undefined
  }
  if (value.type === 'dialogue' && exactKeys(value, ['type', 'speakerId', 'text'])) {
    const speakerId = cleanText(value.speakerId, 160)
    const text = cleanText(value.text, 180)
    return speakerId && text ? { type: value.type, speakerId, text } : undefined
  }
  if (value.type === 'command' && exactKeys(value, ['type', 'entityId', 'command'])) {
    const entityId = cleanText(value.entityId, 160)
    const command = parseCommand(value.command)
    return entityId && command ? { type: value.type, entityId, command } : undefined
  }
  if (value.type === 'relationship' && exactKeys(value, ['type', 'fromId', 'toId', 'delta', 'reason'])) {
    const fromId = cleanText(value.fromId, 160)
    const toId = cleanText(value.toId, 160)
    const delta = Math.max(-10, Math.min(10, Math.round(Number(value.delta))))
    const reason = cleanText(value.reason, 120)
    return fromId && toId && fromId !== toId && Number.isFinite(delta) && delta !== 0
      ? { type: value.type, fromId, toId, delta, reason }
      : undefined
  }
  if (value.type === 'choice' && exactKeys(value, ['type', 'label', 'suggestedInput'])) {
    const label = cleanText(value.label, 48)
    const suggestedInput = cleanText(value.suggestedInput, 240)
    return label && suggestedInput ? { type: value.type, label, suggestedInput } : undefined
  }
  if (value.type === 'end' && exactKeys(value, ['type', 'summary'])) {
    const summary = cleanText(value.summary, 300)
    return summary ? { type: value.type, summary } : undefined
  }
  return undefined
}

export const createTavernDirectorStreamParser = (onEvent: (event: TavernDirectorEvent) => void) => {
  let buffer = ''
  const parseLine = (line: string) => {
    const cleanLine = line.trim().replace(/^```(?:jsonl?|ndjson)?$/i, '')
    if (!cleanLine || cleanLine === '```') return
    try {
      const event = parseTavernDirectorEvent(JSON.parse(cleanLine) as unknown)
      if (event) onEvent(event)
    } catch {
      // Incomplete or explanatory lines are ignored; only complete validated events can affect the world.
    }
  }
  return {
    push(chunk: string) {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      lines.forEach(parseLine)
    },
    finish() {
      parseLine(buffer)
      buffer = ''
    },
  }
}

export const tavernDirectorSystemPrompt = `You are the director of an interactive brick-world tavern.
Return NDJSON only: exactly one compact JSON event per line, with no markdown or commentary.
The simulation owns facts and outcomes. You may express intent, dialogue, and high-level commands, but never coordinates or direct state mutation.
Never invent IDs. Hidden objects are absent from the supplied snapshot and must not be revealed.`

export const buildTavernDirectorPrompt = (
  snapshot: WorldAiSnapshot,
  playerText: string,
  recentEntries: TavernDirectorEntry[],
  locale: DirectorLocale,
) => `${locale === 'zh-CN' ? '玩家对酒馆世界下达了自然语言导演意图' : 'The player gave a natural-language direction to the tavern world'}:
${JSON.stringify(playerText)}

World snapshot:
${JSON.stringify(snapshot)}

Recent director events:
${JSON.stringify(recentEntries.slice(-12))}

Emit 2 to 10 of these NDJSON events:
{"type":"narration","text":"short atmospheric narration"}
{"type":"dialogue","speakerId":"existing visible living entity id","text":"short spoken line"}
{"type":"command","entityId":"existing visible living entity id","command":{"type":"stop|wander"}}
{"type":"command","entityId":"existing visible living entity id","command":{"type":"move|attack|revive|guard|follow|interact","target":{"kind":"entity|brick|structure","id":"existing visible target id"}}}
{"type":"relationship","fromId":"existing entity id","toId":"another existing entity id","delta":-10,"reason":"brief reason"}
{"type":"choice","label":"short option","suggestedInput":"a useful next player instruction"}
{"type":"end","summary":"short turn summary"}

Rules:
- Write all visible text in ${locale === 'zh-CN' ? 'Simplified Chinese' : 'English'}.
- Dialogue should come before a command that interrupts the speaker.
- Commands start actions; never claim that movement, attacks, revival, or interaction already succeeded.
- Relationship delta must be between -10 and 10 and grounded in dialogue or an existing event.
- Never return health, damage, faction, visibility, coordinates, transforms, new entities, or new object IDs.
- Use at most 3 commands, at most 3 dialogue lines, and finish with exactly one end event.`

const clampAffinity = (value: number) => Math.max(-100, Math.min(100, value))

export const applyTavernDirectorEvent = (
  world: WorldState,
  event: TavernDirectorEvent,
  options: { bricks: PlacedBrick[]; structures: BrickStructure[] },
): { world: WorldState; status?: 'accepted' | 'rejected'; detail?: string; before?: number; after?: number } => {
  const hiddenKeys = new Set(world.hiddenTargets.map((target) => `${target.kind}:${target.id}`))
  const livingVisibleEntity = (id: string) => world.entities.find((entity) => (
    entity.id === id && entity.health > 0 && !hiddenKeys.has(`entity:${id}`)
  ))
  if (event.type === 'dialogue') {
    const speaker = livingVisibleEntity(event.speakerId)
    if (!speaker) return { world, status: 'rejected', detail: 'SPEAKER_NOT_AVAILABLE' }
    const expiresAtSeconds = world.elapsedSeconds + Math.min(14, Math.max(5, event.text.length / 5))
    return {
      world: {
        ...world,
        entities: world.entities.map((entity) => entity.id === speaker.id ? {
          ...entity,
          activeCommand: undefined,
          commandQueue: [],
          behaviorState: 'idle' as const,
          navigation: { status: 'idle' as const, path: [], pathIndex: 0 },
          speech: { message: 'scenario-dialogue' as const, text: event.text, expiresAtSeconds },
          autonomy: { ...entity.autonomy, nextDecisionAtSeconds: expiresAtSeconds },
        } : entity),
      },
      status: 'accepted',
    }
  }
  if (event.type === 'command') {
    if (!livingVisibleEntity(event.entityId)) return { world, status: 'rejected', detail: 'ENTITY_NOT_AVAILABLE' }
    const targetExists = (target: WorldTargetRef) => {
      if (hiddenKeys.has(`${target.kind}:${target.id}`)) return false
      if (target.kind === 'entity') {
        const targetEntity = world.entities.find((entity) => entity.id === target.id)
        return Boolean(targetEntity && (event.command.type === 'revive' ? targetEntity.health <= 0 : targetEntity.health > 0))
      }
      if (target.kind === 'brick') return options.bricks.some((brick) => brick.id === target.id)
      if (target.kind === 'structure') return options.structures.some((structure) => structure.id === target.id)
      return false
    }
    const result = issueWorldEntityCommand(world, event.entityId, event.command, targetExists, 'replace')
    if (result.ok === false) return { world, status: 'rejected', detail: result.issue }
    return {
      world: {
        ...result.world,
        events: result.world.events.map((candidate, index) => index === result.world.events.length - 1
          ? { ...candidate, commandSource: 'player' as const }
          : candidate),
      },
      status: 'accepted',
    }
  }
  if (event.type === 'relationship') {
    const from = livingVisibleEntity(event.fromId)
    const to = world.entities.find((entity) => entity.id === event.toId && !hiddenKeys.has(`entity:${entity.id}`))
    if (!from || !to) return { world, status: 'rejected', detail: 'RELATIONSHIP_TARGET_NOT_AVAILABLE' }
    const current = world.narrative.relationshipsByEntityId[from.id]?.[to.id]
    const before = current?.affinity ?? 0
    const after = clampAffinity(before + event.delta)
    const next: WorldRelationship = {
      targetEntityId: to.id,
      affinity: after,
      encounters: (current?.encounters ?? 0) + 1,
      lastEventType: 'interaction',
      updatedAtSeconds: world.elapsedSeconds,
    }
    return {
      world: {
        ...world,
        narrative: {
          ...world.narrative,
          relationshipsByEntityId: {
            ...world.narrative.relationshipsByEntityId,
            [from.id]: {
              ...(world.narrative.relationshipsByEntityId[from.id] ?? {}),
              [to.id]: next,
            },
          },
        },
      },
      status: 'accepted',
      before,
      after,
    }
  }
  return { world }
}
