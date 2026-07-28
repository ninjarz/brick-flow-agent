import type { BrickStructure, LlmConfig, PlacedBrick } from '../types/bricks'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import type {
  WorldEntityCommand,
  WorldState,
  WorldStory,
  WorldTargetKind,
  WorldTargetRef,
} from '../types/world'
import { issueWorldEntityCommand } from './worldEntity'
import { requestLlmJsonContent } from './llmGenerator'

type WorldAiLocale = 'zh-CN' | 'en-US'

export type WorldAiSnapshot = {
  worldId: string
  elapsedSeconds: number
  brickCount: number
  brickSnapshotTruncated: boolean
  entities: Array<{
    id: string
    name: string
    description: string
    definitionId: string
    factionId: string
    controller: 'rule' | 'player' | 'ai'
    health: number
    maxHealth: number
    role?: string
    combat?: {
      attackRangeStuds: number
      minimumRangeStuds: number
      damage: number
      windupSeconds: number
      cooldownSeconds: number
    }
    support?: {
      reviveRangeStuds: number
      reviveHealthRatio: number
      reviveCooldownSeconds: number
    }
    position: { x: number; y: number; z: number }
    behaviorState: string
    activeOrder?: { type: string; target?: WorldTargetRef }
    queuedOrderCount: number
    nearbyHostileIds: string[]
    nearbyFriendlyIds: string[]
    recentMemories: Array<{ type: string; otherId?: string; otherName?: string; importance: number }>
    relationships: Array<{ targetEntityId: string; affinity: number; encounters: number }>
  }>
  bricks: Array<{ id: string; brickId: string; position: { x: number; y: number; z: number } }>
  structures: Array<{
    id: string
    name: string
    description: string
    brickCount: number
    position?: { x: number; y: number; z: number }
  }>
  recentNarratives: Array<{
    title: string
    text: string
  }>
  recentEvents: Array<{
    type: string
    actorId: string
    actorName?: string
    targetId?: string
    targetName?: string
    amount?: number
  }>
}

export type WorldAiCommandRejection =
  | 'INVALID_COMMAND'
  | 'DIRECT_STATE_MUTATION'
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_NOT_AI_CONTROLLED'
  | 'INVALID_TARGET'
  | 'TARGET_NOT_FOUND'
  | 'SELF_TARGET'
  | 'EMPTY_PATROL_ROUTE'

export type WorldAiTurnResult = {
  world: WorldState
  accepted: number
  rejected: Array<{ index: number; issue: WorldAiCommandRejection }>
  story?: WorldStory
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const exactKeys = (value: Record<string, unknown>, allowedKeys: string[]) =>
  Object.keys(value).every((key) => allowedKeys.includes(key))

const asCleanString = (value: unknown, maxLength = 120) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''

const maxSnapshotBricks = 240

const selectRelevantBricks = (world: WorldState, bricks: PlacedBrick[]) => {
  if (bricks.length <= maxSnapshotBricks) return bricks
  const observers = world.entities.filter((entity) => entity.controller === 'ai' && entity.health > 0)
  const anchors = observers.length > 0 ? observers : world.entities.filter((entity) => entity.health > 0)
  if (anchors.length === 0) return bricks.slice(0, maxSnapshotBricks)
  return [...bricks]
    .sort((a, b) => {
      const distanceA = Math.min(...anchors.map((entity) => Math.hypot(
        a.pose.xStud - entity.transform.x,
        a.pose.zStud - entity.transform.z,
      )))
      const distanceB = Math.min(...anchors.map((entity) => Math.hypot(
        b.pose.xStud - entity.transform.x,
        b.pose.zStud - entity.transform.z,
      )))
      return distanceA - distanceB || a.id.localeCompare(b.id)
    })
    .slice(0, maxSnapshotBricks)
}

export const createWorldAiSnapshot = (
  world: WorldState,
  bricks: PlacedBrick[],
  structures: BrickStructure[] = [],
): WorldAiSnapshot => {
  const hiddenEntityIds = new Set(world.hiddenTargets.filter((target) => target.kind === 'entity').map((target) => target.id))
  const hiddenStructureIds = new Set(world.hiddenTargets.filter((target) => target.kind === 'structure').map((target) => target.id))
  const hiddenBrickIds = new Set([
    ...world.hiddenTargets.filter((target) => target.kind === 'brick').map((target) => target.id),
    ...structures.filter((structure) => hiddenStructureIds.has(structure.id)).flatMap((structure) => structure.brickIds),
  ])
  const visibleEntities = world.entities.filter((entity) => !hiddenEntityIds.has(entity.id))
  const visibleBricks = bricks.filter((brick) => !hiddenBrickIds.has(brick.id))
  const visibleStructures = structures.filter((structure) => !hiddenStructureIds.has(structure.id))
  const selectedBricks = selectRelevantBricks({ ...world, entities: visibleEntities }, visibleBricks)
  const bricksById = new Map(visibleBricks.map((brick) => [brick.id, brick]))
  const visibleEntityNameById = new Map(visibleEntities.map((entity) => [entity.id, entity.name]))
  return {
  worldId: world.id,
  elapsedSeconds: Number(world.elapsedSeconds.toFixed(2)),
  brickCount: visibleBricks.length,
  brickSnapshotTruncated: selectedBricks.length < visibleBricks.length,
  entities: visibleEntities.map((entity) => {
    const definition = worldEntityDefinitionById.get(entity.definitionId)
    const nearbyEntities = visibleEntities.filter((candidate) => (
      candidate.id !== entity.id
      && candidate.health > 0
      && Math.hypot(candidate.transform.x - entity.transform.x, candidate.transform.z - entity.transform.z)
        <= (definition?.perception.detectionRangeStuds ?? 0)
    ))
    const activeTarget = entity.activeCommand && 'target' in entity.activeCommand ? entity.activeCommand.target : undefined
    return ({
    id: entity.id,
    name: entity.name,
    description: entity.description,
    definitionId: entity.definitionId,
    factionId: entity.factionId,
    controller: entity.controller,
    health: entity.health,
    maxHealth: entity.maxHealth,
    role: definition?.role,
    combat: definition ? {
      attackRangeStuds: definition.combat.attackRangeStuds,
      minimumRangeStuds: definition.combat.minimumRangeStuds ?? 0,
      damage: definition.combat.damage,
      windupSeconds: definition.combat.windupSeconds,
      cooldownSeconds: definition.combat.cooldownSeconds,
    } : undefined,
    support: definition?.support ? {
      reviveRangeStuds: definition.support.reviveRangeStuds,
      reviveHealthRatio: definition.support.reviveHealthRatio,
      reviveCooldownSeconds: definition.support.reviveCooldownSeconds,
    } : undefined,
    position: {
      x: Number(entity.transform.x.toFixed(2)),
      y: Number(entity.transform.y.toFixed(2)),
      z: Number(entity.transform.z.toFixed(2)),
    },
    behaviorState: entity.behaviorState,
    activeOrder: entity.activeCommand ? { type: entity.activeCommand.type, target: activeTarget } : undefined,
    queuedOrderCount: entity.commandQueue.length,
    nearbyHostileIds: nearbyEntities
      .filter((candidate) => entity.factionId !== 'neutral' && candidate.factionId !== 'neutral' && candidate.factionId !== entity.factionId)
      .map((candidate) => candidate.id),
    nearbyFriendlyIds: nearbyEntities
      .filter((candidate) => entity.factionId === 'neutral' || candidate.factionId === 'neutral' || candidate.factionId === entity.factionId)
      .map((candidate) => candidate.id),
    recentMemories: (world.narrative.memoriesByEntityId[entity.id] ?? []).slice(-8).map((memory) => ({
      type: memory.type,
      otherId: memory.otherId,
      otherName: memory.otherName,
      importance: memory.importance,
    })),
    relationships: Object.values(world.narrative.relationshipsByEntityId[entity.id] ?? {}).map((relationship) => ({
      targetEntityId: relationship.targetEntityId,
      affinity: relationship.affinity,
      encounters: relationship.encounters,
    })),
  })}),
  bricks: selectedBricks.map((brick) => ({
    id: brick.id,
    brickId: brick.brickId,
    position: { x: brick.pose.xStud, y: brick.pose.yStud, z: brick.pose.zStud },
  })),
  structures: visibleStructures.map((structure) => {
    const members = structure.brickIds.map((id) => bricksById.get(id)).filter((brick): brick is PlacedBrick => Boolean(brick))
    return {
      id: structure.id,
      name: structure.name,
      description: structure.description,
      brickCount: structure.brickIds.length,
      position: members.length > 0 ? {
        x: Number((members.reduce((sum, brick) => sum + brick.pose.xStud, 0) / members.length).toFixed(2)),
        y: Number((members.reduce((sum, brick) => sum + brick.pose.yStud, 0) / members.length).toFixed(2)),
        z: Number((members.reduce((sum, brick) => sum + brick.pose.zStud, 0) / members.length).toFixed(2)),
      } : undefined,
    }
  }),
  recentNarratives: world.narrative.stories.slice(-4).map((story) => ({
    title: story.title,
    text: (
      story.blocks?.map((block) => (
        block.type === 'dialogue'
          ? `${visibleEntityNameById.get(block.speakerId) ?? block.speakerId}: ${block.text}`
          : block.text
      )).join('\n')
      || story.body
    ).trim().slice(0, 1_200),
  })).filter((story) => Boolean(story.text)),
  recentEvents: world.events.slice(-16).map((event) => ({
    type: event.type,
    actorId: event.actorId,
    actorName: event.actorName,
    targetId: event.targetId,
    targetName: event.targetName,
    amount: event.amount,
  })),
}}

export const worldAiSystemPrompt = `You direct AI-controlled characters in a brick world. Return one compact JSON object only.
You may only issue high-level commands using IDs from the supplied snapshot. Never invent IDs.
Never return coordinates, transforms, health, damage, cooldowns, or any other direct state mutation.
Only entities whose controller is "ai" may receive commands.`

export const buildWorldAiTurnPrompt = (snapshot: WorldAiSnapshot) => `World snapshot:
${JSON.stringify(snapshot)}

Return this exact shape:
{
  "commands": [
    { "entityId": "existing AI-controlled entity id", "type": "stop" },
    { "entityId": "existing AI-controlled entity id", "type": "wander" },
    { "entityId": "existing AI-controlled entity id", "type": "move|attack|guard|follow|interact", "target": { "kind": "entity|brick|structure", "id": "existing target id" } },
    { "entityId": "existing AI-controlled priest id", "type": "revive", "target": { "kind": "entity", "id": "existing defeated entity id" } }
  ],
  "story": { "title": "optional short title", "body": "optional grounded account of the decision" }
}

Rules:
- Return at most one command per AI-controlled entity and at most 12 commands total.
- AI-controlled units already use local combat and social behavior between model turns. Issue a command only when it improves their current plan.
- Respect role and range: melee units close distance, ranged units preserve minimum range, and siege units prefer valuable distant targets.
- Protect threatened allies and prioritize enemies already attacking the unit or its faction.
- Priests should revive defeated allies before taking ordinary social or combat actions.
- Avoid replacing an active order with an identical order.
- The bricks array may contain only the nearest relevant subset; brickCount is the total scene count.
- Attack may target only an entity, brick, or structure. Follow may target only an entity.
- A unit may not target itself.
- Coordinates in the snapshot are read-only context. Never return coordinates or direct state fields.
- Omit story unless there is something meaningful to narrate.
- Do not add any fields outside the documented shape.`

const parseTarget = (value: unknown): WorldTargetRef | undefined => {
  if (!isRecord(value) || !exactKeys(value, ['kind', 'id'])) return undefined
  const kind = value.kind
  const id = asCleanString(value.id, 160)
  if (!id || !['entity', 'brick', 'structure', 'waypoint'].includes(String(kind))) return undefined
  return { kind: kind as WorldTargetKind, id } as WorldTargetRef
}

const parseCommand = (value: unknown): { entityId: string; command: WorldEntityCommand } | undefined => {
  if (!isRecord(value)) return undefined
  const entityId = asCleanString(value.entityId, 160)
  const type = value.type
  if (!entityId || typeof type !== 'string') return undefined
  if (type === 'stop' && exactKeys(value, ['entityId', 'type'])) return { entityId, command: { type } }
  if (type === 'wander' && exactKeys(value, ['entityId', 'type'])) return { entityId, command: { type } }
  if (type === 'patrol' && exactKeys(value, ['entityId', 'type', 'waypointIds']) && Array.isArray(value.waypointIds)) {
    const waypointIds = value.waypointIds.map((id) => asCleanString(id, 160)).filter(Boolean).slice(0, 16)
    return { entityId, command: { type, waypointIds } }
  }
  if (!['move', 'attack', 'revive', 'guard', 'follow', 'interact'].includes(type) || !exactKeys(value, ['entityId', 'type', 'target'])) return undefined
  const target = parseTarget(value.target)
  if (!target) return undefined
  if (type === 'attack' && !['entity', 'brick', 'structure'].includes(target.kind)) return undefined
  if (type === 'revive' && target.kind !== 'entity') return undefined
  if (type === 'follow' && target.kind !== 'entity') return undefined
  return { entityId, command: { type, target } as WorldEntityCommand }
}

const containsDirectMutation = (value: unknown) => {
  if (!isRecord(value)) return false
  return Object.keys(value).some((key) => [
    'x', 'y', 'z', 'position', 'transform', 'health', 'maxHealth', 'damage', 'cooldown', 'rotationRadians',
  ].includes(key)) || Object.values(value).some((child) => containsDirectMutation(child))
}

const sameTarget = (left?: WorldTargetRef, right?: WorldTargetRef) => (
  (!left && !right) || (left?.kind === right?.kind && left?.id === right?.id)
)

const sameCommand = (left: WorldEntityCommand | undefined, right: WorldEntityCommand) => {
  if (!left || left.type !== right.type) return false
  if (left.type === 'patrol' && right.type === 'patrol') {
    return left.waypointIds.length === right.waypointIds.length
      && left.waypointIds.every((id, index) => id === right.waypointIds[index])
  }
  const leftTarget = 'target' in left ? left.target : undefined
  const rightTarget = 'target' in right ? right.target : undefined
  return sameTarget(leftTarget, rightTarget)
}

const parseAiStory = (value: unknown, world: WorldState): WorldStory | undefined => {
  if (!isRecord(value) || !exactKeys(value, ['title', 'body'])) return undefined
  const title = asCleanString(value.title, 100)
  const body = asCleanString(value.body, 2_000)
  if (!title || !body) return undefined
  return {
    id: `story-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    body,
    createdAtSeconds: world.elapsedSeconds,
    eventIds: world.events.slice(-8).map((event) => event.id),
    source: 'ai',
  }
}

export const applyWorldAiTurn = (
  world: WorldState,
  response: unknown,
  options: { bricks?: PlacedBrick[]; structures?: BrickStructure[] } = {},
): WorldAiTurnResult => {
  if (!isRecord(response) || !exactKeys(response, ['commands', 'story']) || !Array.isArray(response.commands)) {
    return { world, accepted: 0, rejected: [{ index: -1, issue: 'INVALID_COMMAND' }] }
  }

  const bricks = options.bricks ?? []
  const structures = options.structures ?? []
  const targetExists = (target: WorldTargetRef) => {
    if (target.kind === 'entity') return world.entities.some((entity) => entity.id === target.id)
    if (target.kind === 'brick') return bricks.some((brick) => brick.id === target.id)
    if (target.kind === 'structure') return structures.some((structure) => structure.id === target.id)
    return false
  }
  let nextWorld = world
  let accepted = 0
  const rejected: WorldAiTurnResult['rejected'] = []
  const commandedEntityIds = new Set<string>()

  response.commands.slice(0, 12).forEach((rawCommand, index) => {
    if (containsDirectMutation(rawCommand)) {
      rejected.push({ index, issue: 'DIRECT_STATE_MUTATION' })
      return
    }
    const parsed = parseCommand(rawCommand)
    if (!parsed || commandedEntityIds.has(parsed.entityId)) {
      rejected.push({ index, issue: 'INVALID_COMMAND' })
      return
    }
    const entity = nextWorld.entities.find((candidate) => candidate.id === parsed.entityId)
    if (!entity) {
      rejected.push({ index, issue: 'ENTITY_NOT_FOUND' })
      return
    }
    if (entity.controller !== 'ai') {
      rejected.push({ index, issue: 'ENTITY_NOT_AI_CONTROLLED' })
      return
    }
    commandedEntityIds.add(parsed.entityId)
    if (sameCommand(entity.activeCommand ?? entity.commandQueue[0], parsed.command)) {
      accepted += 1
      return
    }
    const result = issueWorldEntityCommand(nextWorld, parsed.entityId, parsed.command, targetExists, 'replace')
    if (result.ok === false) {
      const issue: WorldAiCommandRejection = result.issue === 'SELF_TARGET'
        ? 'SELF_TARGET'
        : result.issue === 'EMPTY_PATROL_ROUTE'
          ? 'EMPTY_PATROL_ROUTE'
          : result.issue === 'TARGET_NOT_FOUND'
            ? 'TARGET_NOT_FOUND'
            : result.issue === 'ENTITY_NOT_FOUND'
              ? 'ENTITY_NOT_FOUND'
              : 'INVALID_TARGET'
      rejected.push({ index, issue })
      return
    }
    nextWorld = result.world
    accepted += 1
  })

  return {
    world: nextWorld,
    accepted,
    rejected,
    story: parseAiStory(response.story, nextWorld),
  }
}

export const parseWorldAiJson = (content: string) => {
  const trimmed = content.trim()
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonText = fencedMatch?.[1] ?? trimmed
  const objectMatch = jsonText.match(/\{[\s\S]*\}/)
  return JSON.parse(objectMatch?.[0] ?? jsonText) as unknown
}

export const requestWorldAiTurn = async (input: {
  world: WorldState
  bricks: PlacedBrick[]
  structures?: BrickStructure[]
  config: LlmConfig
  locale?: WorldAiLocale
  signal?: AbortSignal
}) => {
  const snapshot = createWorldAiSnapshot(input.world, input.bricks, input.structures)
  const content = await requestLlmJsonContent({
    config: input.config,
    systemPrompt: worldAiSystemPrompt,
    userPrompt: buildWorldAiTurnPrompt(snapshot),
    locale: input.locale,
    signal: input.signal,
    temperature: 0.35,
    maxTokens: 3_000,
  })
  return parseWorldAiJson(content)
}

export const formatWorldAiTurnSummary = (
  result: Pick<WorldAiTurnResult, 'accepted' | 'rejected'>,
  locale: WorldAiLocale,
) => locale === 'zh-CN'
  ? `已接受 ${result.accepted} 条命令，拒绝 ${result.rejected.length} 条。`
  : `Accepted ${result.accepted} command(s) and rejected ${result.rejected.length}.`
