import type { BrickStructure, PlacedBrick } from '../types/bricks'
import type { WorldDirectorEntry, WorldDirectorEvent, WorldEntityCommand, WorldRelationship, WorldState, WorldTargetRef } from '../types/world'
import type { WorldAiSnapshot } from './worldAi'
import { issueWorldEntityCommand } from './worldEntity'
import { getWorldEntityCollisionRadius } from './worldEntityCollision'

export type TavernDirectorEvent = WorldDirectorEvent
export type TavernDirectorEntry = WorldDirectorEntry
export type TavernDirectorStreamPreview = {
  type: 'narration' | 'dialogue' | 'end'
  text: string
  speakerId?: string
}
export type TavernDirectorValidationIssue = {
  lineNumber: number
  code: 'INVALID_JSON' | 'INVALID_EVENT' | 'EVENT_AFTER_END' | 'TOO_MANY_EVENTS' | 'TOO_MANY_COMMANDS' | 'TOO_MANY_DIALOGUE_LINES' | 'MISSING_END'
  raw: string
}

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
  if (value.type === 'dialogue' && exactKeys(value, ['type', 'speakerId', 'listenerId', 'text'])) {
    const speakerId = cleanText(value.speakerId, 160)
    const listenerId = cleanText(value.listenerId, 160)
    const text = cleanText(value.text, 180)
    return speakerId && text
      ? { type: value.type, speakerId, ...(listenerId && listenerId !== speakerId ? { listenerId } : {}), text }
      : undefined
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

const readPartialJsonString = (line: string, field: string) => {
  const match = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`).exec(line)
  if (!match?.[1]) return ''
  let content = match[1]
  const trailingSlashes = content.match(/\\+$/)?.[0].length ?? 0
  if (trailingSlashes % 2 === 1) content = content.slice(0, -1)
  try {
    return JSON.parse(`"${content}"`) as string
  } catch {
    return content
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
}

export const parseTavernDirectorStreamPreview = (line: string): TavernDirectorStreamPreview | undefined => {
  const type = readPartialJsonString(line, 'type')
  if (type === 'narration') {
    const text = readPartialJsonString(line, 'text')
    return text ? { type, text } : undefined
  }
  if (type === 'dialogue') {
    const text = readPartialJsonString(line, 'text')
    const speakerId = readPartialJsonString(line, 'speakerId')
    return text ? { type, text, ...(speakerId ? { speakerId } : {}) } : undefined
  }
  if (type === 'end') {
    const text = readPartialJsonString(line, 'summary')
    return text ? { type, text } : undefined
  }
  return undefined
}

export const createTavernDirectorStreamParser = (
  onEvent: (event: TavernDirectorEvent) => void,
  onPreview?: (preview: TavernDirectorStreamPreview | undefined) => void,
) => {
  let buffer = ''
  let lineNumber = 0
  let eventCount = 0
  let commandCount = 0
  let dialogueCount = 0
  let ended = false
  const issues: TavernDirectorValidationIssue[] = []
  const reject = (code: TavernDirectorValidationIssue['code'], raw: string) => {
    issues.push({ lineNumber, code, raw: raw.trim().slice(0, 500) })
  }
  const parseLine = (line: string) => {
    lineNumber += 1
    const cleanLine = line.trim().replace(/^```(?:jsonl?|ndjson)?$/i, '')
    if (!cleanLine || cleanLine === '```') return
    let value: unknown
    try {
      value = JSON.parse(cleanLine) as unknown
    } catch {
      reject('INVALID_JSON', cleanLine)
      return
    }
    const event = parseTavernDirectorEvent(value)
    if (!event) {
      reject('INVALID_EVENT', cleanLine)
      return
    }
    if (ended) {
      reject('EVENT_AFTER_END', cleanLine)
      return
    }
    if (eventCount >= 10) {
      reject('TOO_MANY_EVENTS', cleanLine)
      return
    }
    if (event.type === 'command' && commandCount >= 3) {
      reject('TOO_MANY_COMMANDS', cleanLine)
      return
    }
    if (event.type === 'dialogue' && dialogueCount >= 3) {
      reject('TOO_MANY_DIALOGUE_LINES', cleanLine)
      return
    }
    eventCount += 1
    if (event.type === 'command') commandCount += 1
    if (event.type === 'dialogue') dialogueCount += 1
    if (event.type === 'end') ended = true
    onEvent(event)
  }
  return {
    push(chunk: string) {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      lines.forEach(parseLine)
      onPreview?.(parseTavernDirectorStreamPreview(buffer))
    },
    finish(): TavernDirectorValidationIssue[] {
      parseLine(buffer)
      buffer = ''
      if (eventCount > 0 && !ended) reject('MISSING_END', '')
      onPreview?.(undefined)
      return [...issues]
    },
  }
}

export const tavernDirectorSystemPrompt = `You are the director of an interactive brick-world tavern.
Return NDJSON only: exactly one compact JSON event per line, with no markdown or commentary.
The simulation owns facts and outcomes. You may express intent, dialogue, and high-level commands, but never coordinates or direct state mutation.
Never invent IDs. Hidden objects are absent from the supplied snapshot and must not be revealed.
Character knowledge is bounded: focusedMemories and knownClues belong only to that character. A rumor is not confirmed truth.`

export const buildTavernDirectorPrompt = (
  snapshot: WorldAiSnapshot,
  playerText: string,
  recentEntries: TavernDirectorEntry[],
  locale: DirectorLocale,
  protagonist?: { id: string; name: string },
) => `${locale === 'zh-CN' ? '玩家对酒馆世界下达了自然语言导演意图' : 'The player gave a natural-language direction to the tavern world'}:
${JSON.stringify(playerText)}

Player identity:
${JSON.stringify(protagonist ?? snapshot.entities.find((entity) => entity.controller === 'player') ?? null)}

Entity reference glossary:
${JSON.stringify(snapshot.entities.map((entity) => ({
  id: entity.id,
  name: entity.name,
  description: entity.description,
})))}

World snapshot:
${JSON.stringify(snapshot)}

${recentEntries.length > 0 ? `Recent director events:
${JSON.stringify(recentEntries.slice(-12))}
` : ''}

Emit 2 to 10 of these NDJSON events:
{"type":"narration","text":"short atmospheric narration"}
{"type":"dialogue","speakerId":"existing visible living entity id","listenerId":"existing visible living listener id","text":"short spoken line"}
{"type":"command","entityId":"existing visible living entity id","command":{"type":"stop|wander"}}
{"type":"command","entityId":"existing visible living entity id","command":{"type":"move|attack|revive|guard|follow|interact","target":{"kind":"entity|brick|structure","id":"existing visible target id"}}}
{"type":"relationship","fromId":"existing entity id","toId":"another existing entity id","delta":-10,"reason":"brief reason"}
{"type":"choice","label":"short option","suggestedInput":"a useful next player instruction"}
{"type":"end","summary":"short turn summary"}

Rules:
- Write all visible text in ${locale === 'zh-CN' ? 'Simplified Chinese' : 'English'}.
- The player-controlled protagonist is the player's identity in the story. Address them by name, not as an unknown "you".
- Resolve indirect references such as "the stranger", roles, titles, and pronouns from the entity reference glossary and recentNarratives. Prefer the entity whose description explicitly matches the wording; never substitute a merely nearby entity.
- Keep characterization stable: use each speaker's motive and temperament to decide what they attempt, and their voice to phrase dialogue.
- speakerCandidates is a soft turn-taking suggestion based on mention, distance, relationship, initiative, and current speech occupancy. Prefer it when several replies are equally valid; it never overrides the player's named addressee.
- A speaker may only assert facts found in their own focusedMemories, knownClues, or directly visible current events. Other characters' clues remain private until spoken or granted by a scenario.
- reflections summarize repeated personal experience. Use them for attitude and priorities, never as evidence that a new event occurred.
- Follow the player's requested intent instead of defaulting every turn to a conversation. Use dialogue only when somebody actually speaks; use commands for requested movement, combat, following, guarding, revival, or wandering.
- Dialogue text must be the words the character actually says. Never use dialogue merely to announce an upcoming command such as "I will go talk to X".
- Every dialogue event must identify who is listening. A dialogue is itself a completed conversation fact; do not also emit an interact command for the same exchange.
- Dialogue should come before a command that interrupts the speaker.
- Commands start actions; never claim that movement, attacks, revival, or interaction already succeeded.
- Put any narration that depends on an action after its command. The runtime may suppress that narration when the command cannot be confirmed.
- Narration before a command may describe only atmosphere and already supplied world facts, never the command's result.
- Relationship delta must be between -10 and 10 and grounded in dialogue or an existing event.
- Never return health, damage, faction, visibility, coordinates, transforms, new entities, or new object IDs.
- Use at most 3 commands, at most 3 dialogue lines, and finish with exactly one end event.`

const clampAffinity = (value: number) => Math.max(-100, Math.min(100, value))

const resolveDialogueInteraction = (
  world: WorldState,
  speakerId: string,
  listenerId: string | undefined,
  isAvailable: (id: string) => boolean,
) => {
  const activeInteraction = world.scenarios
    .filter((scenario) => !scenario.activeDialogue)
    .flatMap((scenario) => scenario.stages)
    .find((stage) => (
      stage.status === 'active'
      && stage.trigger.eventType === 'interaction'
      && stage.trigger.actorId
      && stage.trigger.targetId
      && (
        (speakerId === stage.trigger.targetId && (!listenerId || listenerId === stage.trigger.actorId))
        || (speakerId === stage.trigger.actorId && listenerId === stage.trigger.targetId)
      )
    ))
  const expectedActorId = activeInteraction?.trigger.actorId
  const expectedTargetId = activeInteraction?.trigger.targetId

  if (
    expectedActorId
    && expectedTargetId
    && isAvailable(expectedActorId)
    && isAvailable(expectedTargetId)
  ) {
    return { actorId: expectedActorId, targetId: expectedTargetId }
  }
  return undefined
}

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
    const listener = event.listenerId ? livingVisibleEntity(event.listenerId) : undefined
    if (event.listenerId && !listener) {
      return { world, status: 'rejected', detail: 'LISTENER_NOT_AVAILABLE' }
    }
    const listenerDistance = listener
      ? Math.hypot(
          speaker.transform.x - listener.transform.x,
          speaker.transform.z - listener.transform.z,
        ) - getWorldEntityCollisionRadius(speaker) - getWorldEntityCollisionRadius(listener)
      : 0
    if (listener && listenerDistance > 0.35) {
      const queued = issueWorldEntityCommand(world, speaker.id, {
        type: 'interact',
        target: { kind: 'entity', id: listener.id },
        speechText: event.text,
      }, (target) => target.kind === 'entity' && Boolean(livingVisibleEntity(target.id)), 'append')
      if (queued.ok === false) return { world, status: 'rejected', detail: queued.issue }
      return { world: queued.world, status: 'accepted', detail: 'WAITING_FOR_PROXIMITY' }
    }
    const expiresAtSeconds = world.elapsedSeconds + Math.min(14, Math.max(5, event.text.length / 5))
    const interaction = resolveDialogueInteraction(
      world,
      speaker.id,
      event.listenerId,
      (id) => Boolean(livingVisibleEntity(id)),
    )
    const actor = interaction ? world.entities.find((entity) => entity.id === interaction.actorId) : undefined
    const target = interaction ? world.entities.find((entity) => entity.id === interaction.targetId) : undefined
    return {
      world: {
        ...world,
        events: listener && !world.scenarios.some((scenario) => scenario.activeDialogue) ? [...world.events, {
          id: `director-dialogue-${world.events.length}-${Math.round(world.elapsedSeconds * 1000)}`,
          timeSeconds: world.elapsedSeconds,
          type: 'interaction' as const,
          actorId: interaction?.actorId ?? speaker.id,
          actorName: actor?.name ?? speaker.name,
          targetId: interaction?.targetId ?? listener.id,
          targetName: target?.name ?? listener.name,
          commandType: 'interact' as const,
          commandSource: 'player' as const,
          dialogueText: event.text,
          dialogueSpeakerId: speaker.id,
          dialogueListenerId: listener.id,
        }] : world.events,
        entities: world.entities.map((entity) => entity.id === speaker.id ? {
          ...entity,
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
      trust: Math.max(0, Math.min(100, (current?.trust ?? Math.max(0, before)) + Math.max(0, event.delta))),
      hostility: Math.max(0, Math.min(100, (current?.hostility ?? Math.max(0, -before)) + Math.max(0, -event.delta))),
      fear: current?.fear ?? 0,
      repeatedInteractionCount: 0,
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
