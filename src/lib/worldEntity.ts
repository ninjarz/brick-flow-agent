import type {
  WorldEntity,
  WorldEntityCommand,
  WorldEntityControllerKind,
  WorldEntityDefinition,
  WorldEntityTransform,
  WorldDirectorEntry,
  WorldDirectorEvent,
  WorldDirectorCheckpoint,
  WorldScenarioAction,
  WorldScenarioStage,
  WorldState,
  WorldTargetRef,
} from '../types/world'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { resolveOverlappingWorldEntities } from './worldEntityCollision'

const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ')
const comparableName = (value: string) => normalizeName(value).toLocaleLowerCase()

const upgradeGrayRavenScenarioStages = (
  stages: WorldScenarioStage[],
  title: string,
  authoringVersion: number,
) => {
  const investigate = stages.find((stage) => stage.id.endsWith('investigate'))
  const confront = stages.find((stage) => stage.id.endsWith('confront'))
  const rolandId = investigate?.trigger.actorId ?? confront?.trigger.actorId
  const eileenId = investigate?.trigger.targetId
  const envoyId = confront?.trigger.targetId
  if (!rolandId || !eileenId || !envoyId) return stages
  const zh = /[\u3400-\u9fff]/.test(title)
  let upgraded = stages
  if (authoringVersion < 1) upgraded = upgraded.map((stage) => {
    if (stage.id.endsWith('investigate')) return {
      ...stage,
      trigger: { ...stage.trigger, eventType: 'interaction' as const, commandType: undefined },
      dialogue: stage.dialogue?.length ? stage.dialogue : [
        { id: 'investigate-roland', speakerId: rolandId, durationSeconds: 3.8, text: zh ? '艾琳，把你在北路找到的东西再说一遍。' : 'Eileen, tell me again what you found on the northern road.' },
        { id: 'investigate-eileen', speakerId: eileenId, durationSeconds: 5.2, text: zh ? '断箭上有黑岩纹章，还有旧采石场独有的灰白石粉。那个使者的靴边也沾着同样的粉末。' : 'The broken arrow bears the Blackrock crest and pale dust unique to the old quarry. The envoy has the same dust on his boots.' },
        { id: 'investigate-roland-answer', speakerId: rolandId, durationSeconds: 3.8, text: zh ? '明白了。我去问问他，失踪的商队究竟去了哪里。' : 'Understood. I will ask him where the missing caravan really went.' },
      ],
    }
    if (stage.id.endsWith('confront')) return {
      ...stage,
      trigger: { ...stage.trigger, eventType: 'interaction' as const, commandType: undefined },
      dialogue: stage.dialogue?.length ? stage.dialogue : [
        { id: 'confront-roland', speakerId: rolandId, durationSeconds: 5, text: zh ? '北路商队在哪里？你靴上的石粉来自旧采石场。' : 'Where is the northern caravan? The dust on your boots came from the old quarry.' },
        { id: 'confront-envoy-denial', speakerId: envoyId, durationSeconds: 4.5, text: zh ? '一支断箭和一点尘土，也敢当作证据？' : 'A broken arrow and a little dust—you call that evidence?' },
        { id: 'confront-eileen', speakerId: eileenId, durationSeconds: 5.2, text: zh ? '箭尾的切口是黑岩军用制式。你骗不了我们。' : 'The cut on the shaft is Blackrock military issue. You cannot deceive us.' },
        { id: 'confront-envoy-threat', speakerId: envoyId, durationSeconds: 5, text: zh ? '既然你们已经知道，那就都别想活着离开。' : 'Since you already know, none of you will leave here alive.' },
      ],
    }
    return stage
  })
  if (authoringVersion < 2) upgraded = upgraded.map((stage) => stage.id.endsWith('defend') && !(stage.branches?.length)
    ? {
        ...stage,
        branches: [{
          id: 'gray-raven-retreat',
          title: zh ? '罗兰倒下 · 停战撤退' : 'Roland Falls · Retreat',
          trigger: { eventType: 'defeated' as const, targetId: rolandId },
          actions: [
            { type: 'set-faction' as const, entityId: envoyId, factionId: 'neutral' },
            { type: 'issue-command' as const, entityId: envoyId, command: { type: 'stop' as const } },
            { type: 'set-visibility' as const, target: { kind: 'entity' as const, id: envoyId }, visible: false },
            {
              type: 'add-story' as const,
              title: zh ? '败局 · 灰鸦暂熄' : 'Defeat · The Gray Raven Dims',
              body: zh ? '罗兰倒下后，玛拉举起白布换来短暂停战。黑岩使者带伤撤退，酒馆保住了性命，却失去了追查商队的最佳时机。' : 'When Roland falls, Mara raises a white cloth and wins a brief truce. The wounded envoy retreats; the tavern survives, but the best chance to find the caravan is lost.',
              characterIds: [rolandId, eileenId, envoyId],
            },
          ],
        }],
      }
    : stage)
  if (authoringVersion < 4) upgraded = upgraded.map((stage) => stage.id.endsWith('defend')
    ? {
        ...stage,
        branches: stage.branches?.map((branch) => branch.id === 'gray-raven-retreat'
          && !branch.actions?.some((action) => (
            action.type === 'set-visibility'
            && action.target.kind === 'entity'
            && action.target.id === envoyId
            && !action.visible
          ))
          ? {
              ...branch,
              actions: [
                ...(branch.actions ?? []).filter((action) => action.type !== 'add-story'),
                { type: 'set-visibility' as const, target: { kind: 'entity' as const, id: envoyId }, visible: false },
                ...(branch.actions ?? []).filter((action) => action.type === 'add-story'),
              ],
            }
          : branch),
      }
    : stage)
  return upgraded.map((stage) => ({
    ...stage,
    description: stage.description
      .replace(/向(.+?)下达[“"]交互[”"]命令/g, '与$1交谈')
      .replace(/与(.+?)交互/g, '与$1交谈')
      .replace(/\binteract with\b/gi, 'talk with'),
  }))
}

const createGrayRavenEileenCompanionScenario = (
  primaryScenarioId: string,
  existingScenarioIds: Set<string>,
  rolandId: string,
  eileenId: string,
  zh: boolean,
): WorldState['scenarios'][number] => {
  let id = `${primaryScenarioId}-eileen-companion`
  for (let suffix = 2; existingScenarioIds.has(id); suffix += 1) {
    id = `${primaryScenarioId}-eileen-companion-${suffix}`
  }
  return {
    id,
    assetId: 'scenario-border-tavern-eileen-companion',
    title: zh ? '北路同行者' : 'Companion of the Northern Road',
    description: zh
      ? '可选剧情：与艾琳建立足够信任后再次交谈，邀请她作为同伴加入调查。忽略这条流程不会阻碍主线。'
      : 'Optional story: earn Eileen’s trust, then talk again and invite her to join the investigation. Ignoring this flow never blocks the main story.',
    castEntityIds: [rolandId, eileenId],
    processedEventIds: [],
    claimedEventIds: [],
    authoringVersion: 1,
    stages: [{
      id: 'scenario-border-tavern-recruit-eileen',
      title: zh ? '邀请艾琳同行' : 'Invite Eileen to Join',
      description: zh
        ? '罗兰对艾琳的好感达到 45 后，再与她交谈。'
        : 'Talk to Eileen again after Roland’s affinity toward her reaches 45.',
      status: 'active',
      trigger: {
        eventType: 'interaction',
        actorId: rolandId,
        targetId: eileenId,
        minimumAffinity: 45,
      },
      dialogue: [
        {
          id: 'recruit-eileen-roland',
          speakerId: rolandId,
          durationSeconds: 4.8,
          text: zh
            ? '北路不会太平。你愿意和我一起查下去吗？不是作为向导，是作为能把后背交给彼此的同伴。'
            : 'The northern road will not be quiet. Will you investigate it with me—not as a guide, but as a companion I can trust at my back?',
        },
        {
          id: 'recruit-eileen-reason',
          speakerId: eileenId,
          durationSeconds: 5.2,
          text: zh
            ? '失踪商队里有教我认路的人。我本来就没打算袖手旁观，只是不想把命交给一个还不信任的人。'
            : 'Someone in that caravan taught me these roads. I never meant to stand aside; I simply would not trust my life to a stranger.',
        },
        {
          id: 'recruit-eileen-promise',
          speakerId: rolandId,
          durationSeconds: 3.8,
          text: zh
            ? '那就一起把他们带回来。我走在前面，你替我看住身后。'
            : 'Then we bring them home together. I will take the front; you watch my back.',
        },
        {
          id: 'recruit-eileen-accept',
          speakerId: eileenId,
          durationSeconds: 3.6,
          text: zh ? '说定了。从现在起，我的箭和你走同一条路。' : 'Agreed. From now on, my arrows travel the same road as you.',
        },
      ],
      actions: [
        { type: 'set-faction', entityId: eileenId, factionId: 'blue' },
        { type: 'issue-command', entityId: eileenId, command: { type: 'stop' } },
        {
          type: 'add-story',
          title: zh ? '同伴 · 北路的约定' : 'Companion · A Promise on the Northern Road',
          body: zh
            ? '几次交谈后，艾琳确认罗兰愿意倾听，也不会把同伴当作棋子。她系紧箭囊，正式加入调查；若战斗爆发，她会从后方以弓箭掩护罗兰。'
            : 'After several conversations, Eileen sees that Roland listens and does not treat companions as pieces on a board. She tightens her quiver and joins the investigation, ready to cover Roland with her bow.',
          characterIds: [rolandId, eileenId],
        },
      ],
      nextStageId: null,
    }],
  }
}

const makeUniqueName = (baseName: string, existingNames: Iterable<string>) => {
  const normalizedBase = normalizeName(baseName) || '未命名单位'
  const usedNames = new Set([...existingNames].map(comparableName))
  if (!usedNames.has(comparableName(normalizedBase))) return normalizedBase

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${normalizedBase} ${suffix}`
    if (!usedNames.has(comparableName(candidate))) return candidate
  }

  return `${normalizedBase} ${Date.now().toString(36)}`
}

export const generateWorldEntityName = (
  definition: WorldEntityDefinition,
  existingNames: Iterable<string> = [],
  random: () => number = Math.random,
) => {
  const candidates = definition.nameCandidates.map(normalizeName).filter(Boolean)
  const fallbackCandidates = candidates.length > 0 ? candidates : [definition.displayName]
  const randomValue = Math.min(0.999999, Math.max(0, random()))
  const startIndex = Math.floor(randomValue * fallbackCandidates.length)
  const usedNames = new Set([...existingNames].map(comparableName))

  for (let offset = 0; offset < fallbackCandidates.length; offset += 1) {
    const candidate = fallbackCandidates[(startIndex + offset) % fallbackCandidates.length]
    if (!usedNames.has(comparableName(candidate))) return candidate
  }

  return makeUniqueName(fallbackCandidates[startIndex], existingNames)
}

const createWorldEntityId = () => `entity-${Math.random().toString(36).slice(2, 9)}`

const stableEntityNumber = (value: string) => [...value].reduce((hash, character) => (
  Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0
), 2166136261)

export const createWorldEntity = (
  definition: WorldEntityDefinition,
  options: {
    id?: string
    name?: string
    description?: string
    factionId?: string
    controller?: WorldEntity['controller']
    transform?: Partial<WorldEntityTransform>
    existingNames?: Iterable<string>
    random?: () => number
  } = {},
): WorldEntity => {
  const generatedName = options.name
    ? makeUniqueName(options.name, options.existingNames ?? [])
    : generateWorldEntityName(definition, options.existingNames, options.random)

  const id = options.id ?? createWorldEntityId()
  return {
    id,
    definitionId: definition.id,
    kind: definition.kind,
    name: generatedName,
    description: normalizeName(options.description ?? definition.description),
    factionId: normalizeName(options.factionId ?? 'neutral'),
    controller: options.controller ?? 'rule',
    health: definition.combat.maxHealth,
    maxHealth: definition.combat.maxHealth,
    transform: {
      x: options.transform?.x ?? 0,
      y: options.transform?.y ?? 0,
      z: options.transform?.z ?? 0,
      rotationRadians: options.transform?.rotationRadians ?? 0,
    },
    commandQueue: [],
    navigation: {
      status: 'idle',
      path: [],
      pathIndex: 0,
    },
    behaviorState: 'idle',
    combat: { cooldownRemainingSeconds: 0 },
    autonomy: {
      nextDecisionAtSeconds: 2 + (stableEntityNumber(id) % 5),
      home: {
        x: options.transform?.x ?? 0,
        z: options.transform?.z ?? 0,
      },
    },
  }
}

export const createEmptyWorldState = (planId: string): WorldState => ({
  id: `world-${Math.random().toString(36).slice(2, 9)}`,
  planId,
  randomSeed: Math.floor(Math.random() * 0x7fffffff),
  elapsedSeconds: 0,
  paused: false,
  entities: [],
  events: [],
  pendingImpacts: [],
  scenarios: [],
  hiddenTargets: [],
  narrative: {
    processedEventIds: [],
    memoriesByEntityId: {},
    relationshipsByEntityId: {},
    stories: [],
    directorTurns: [],
  },
})

export const changeWorldEntityController = (
  entity: WorldEntity,
  controller: WorldEntityControllerKind,
): WorldEntity => entity.controller === controller ? entity : {
  ...entity,
  controller,
  commandQueue: [],
  activeCommand: undefined,
  behaviorState: entity.health > 0 ? 'idle' : 'dead',
  navigation: { status: 'idle', path: [], pathIndex: 0 },
  autonomy: {
    ...entity.autonomy,
    home: { x: entity.transform.x, z: entity.transform.z },
  },
}

export const changeAllWorldEntityControllers = (
  world: WorldState,
  controller: WorldEntityControllerKind,
): WorldState => {
  let changed = false
  const entities = world.entities.map((entity) => {
    const nextEntity = changeWorldEntityController(entity, controller)
    if (nextEntity !== entity) changed = true
    return nextEntity
  })
  return changed ? { ...world, entities } : world
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isController = (value: unknown): value is WorldEntityControllerKind =>
  value === 'rule' || value === 'player' || value === 'ai'

const parseTargetRef = (value: unknown): WorldTargetRef | undefined => {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return undefined
  if (!['entity', 'brick', 'structure', 'waypoint'].includes(String(value.kind))) return undefined
  return { kind: value.kind as WorldTargetRef['kind'], id: value.id.trim() } as WorldTargetRef
}

const parseStoredCommand = (value: unknown): WorldEntityCommand | undefined => {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  if (value.type === 'stop') return { type: 'stop' }
  if (value.type === 'wander') {
    return isFiniteNumber(value.seed) ? { type: 'wander', seed: value.seed } : { type: 'wander' }
  }
  if (value.type === 'patrol' && Array.isArray(value.waypointIds)) {
    const waypointIds = value.waypointIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map((id) => id.trim()).slice(0, 32)
    return waypointIds.length > 0 ? { type: 'patrol', waypointIds } : undefined
  }
  const target = parseTargetRef(value.target)
  if (!target || !['move', 'attack', 'revive', 'guard', 'follow', 'interact'].includes(value.type)) return undefined
  if (value.type === 'attack' && !['entity', 'brick', 'structure'].includes(target.kind)) return undefined
  if (value.type === 'revive' && target.kind !== 'entity') return undefined
  if (value.type === 'follow' && target.kind !== 'entity') return undefined
  if (value.type === 'interact') {
    const speechText = typeof value.speechText === 'string' ? value.speechText.trim().slice(0, 180) : ''
    return { type: value.type, target, ...(speechText ? { speechText } : {}) }
  }
  return { type: value.type, target } as WorldEntityCommand
}

const parseStoredEntity = (value: unknown): WorldEntity | undefined => {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return undefined
  if (typeof value.definitionId !== 'string' || typeof value.name !== 'string' || !value.name.trim()) return undefined
  const definition = worldEntityDefinitionById.get(value.definitionId)
  if (!definition || !isRecord(value.transform)) return undefined
  if (!isFiniteNumber(value.transform.x) || !isFiniteNumber(value.transform.y) || !isFiniteNumber(value.transform.z)) return undefined
  if (!isFiniteNumber(value.transform.rotationRadians)) return undefined
  const entity = createWorldEntity(definition, {
    id: value.id.trim(),
    name: value.name,
    description: typeof value.description === 'string' ? value.description : definition.description,
    factionId: typeof value.factionId === 'string' ? value.factionId.slice(0, 80) : 'neutral',
    controller: isController(value.controller) && value.controller !== 'ai' ? value.controller : 'rule',
    transform: value.transform,
  })
  const health = isFiniteNumber(value.health) ? Math.max(0, Math.min(definition.combat.maxHealth, value.health)) : definition.combat.maxHealth
  const behaviorStates: WorldEntity['behaviorState'][] = ['idle', 'moving', 'following', 'guarding', 'attacking', 'reviving', 'blocked', 'dead']
  const behaviorState = health <= 0
    ? 'dead'
    : behaviorStates.includes(value.behaviorState as WorldEntity['behaviorState']) ? value.behaviorState as WorldEntity['behaviorState'] : 'idle'
  const commandQueue = Array.isArray(value.commandQueue)
    ? value.commandQueue.map(parseStoredCommand).filter((command): command is WorldEntityCommand => Boolean(command)).slice(0, 20)
    : []
  const activeCommand = parseStoredCommand(value.activeCommand)
  return {
    ...entity,
    ...(typeof value.storylineId === 'string' && value.storylineId.trim() ? { storylineId: value.storylineId.slice(0, 160) } : {}),
    health,
    commandQueue,
    ...(activeCommand ? { activeCommand } : {}),
    navigation: { status: 'idle', path: [], pathIndex: 0 },
    behaviorState,
    combat: {
      cooldownRemainingSeconds: isRecord(value.combat) && isFiniteNumber(value.combat.cooldownRemainingSeconds)
        ? Math.max(0, value.combat.cooldownRemainingSeconds)
        : 0,
      ...(isRecord(value.combat) && typeof value.combat.attackTargetId === 'string'
        ? { attackTargetId: value.combat.attackTargetId }
        : {}),
      ...(isRecord(value.combat) && typeof value.combat.lastAttackerId === 'string'
        ? { lastAttackerId: value.combat.lastAttackerId }
        : {}),
      ...(isRecord(value.combat) && isFiniteNumber(value.combat.lastDamagedAtSeconds)
        ? { lastDamagedAtSeconds: Math.max(0, value.combat.lastDamagedAtSeconds) }
        : {}),
      ...(isRecord(value.combat) && isFiniteNumber(value.combat.lastDamageAmount)
        ? { lastDamageAmount: Math.max(0, value.combat.lastDamageAmount) }
        : {}),
      ...(isRecord(value.combat) && isFiniteNumber(value.combat.damageIndicatorExpiresAtSeconds)
        ? { damageIndicatorExpiresAtSeconds: Math.max(0, value.combat.damageIndicatorExpiresAtSeconds) }
        : {}),
    },
    autonomy: {
      nextDecisionAtSeconds: isRecord(value.autonomy) && isFiniteNumber(value.autonomy.nextDecisionAtSeconds)
        ? Math.max(0, value.autonomy.nextDecisionAtSeconds)
        : 2 + (stableEntityNumber(entity.id) % 5),
      home: isRecord(value.autonomy) && isRecord(value.autonomy.home)
        && isFiniteNumber(value.autonomy.home.x) && isFiniteNumber(value.autonomy.home.z)
        ? { x: value.autonomy.home.x, z: value.autonomy.home.z }
        : { x: entity.transform.x, z: entity.transform.z },
    },
  }
}

const eventTypes = new Set<WorldState['events'][number]['type']>([
  'attack', 'damage', 'miss', 'defeated', 'revive', 'brick-hit', 'structure-hit', 'interaction', 'command-issued', 'command-complete',
])

const parseStoredEvents = (value: unknown): WorldState['events'] => Array.isArray(value)
  ? value.filter((event): event is WorldState['events'][number] => (
      isRecord(event) && typeof event.id === 'string' && isFiniteNumber(event.timeSeconds) &&
      eventTypes.has(event.type as WorldState['events'][number]['type']) && typeof event.actorId === 'string'
    )).slice(-500)
  : []

const normalizeArrayRecord = <T>(value: unknown, predicate: (item: unknown) => item is T) => {
  if (!isRecord(value)) return {} as Record<string, T[]>
  return Object.fromEntries(Object.entries(value).map(([key, items]) => [
    key,
    Array.isArray(items) ? items.filter(predicate).slice(-80) : [],
  ]))
}

const isStoredMemory = (value: unknown): value is WorldState['narrative']['memoriesByEntityId'][string][number] =>
  isRecord(value) && typeof value.id === 'string' && typeof value.eventId === 'string' &&
  typeof value.entityId === 'string' && isFiniteNumber(value.timeSeconds) && eventTypes.has(value.type as never) &&
  [1, 2, 3].includes(Number(value.importance))

const isStoredStory = (value: unknown): value is WorldState['narrative']['stories'][number] =>
  isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string' && typeof value.body === 'string' &&
  isFiniteNumber(value.createdAtSeconds) && Array.isArray(value.eventIds) && value.eventIds.every((id) => typeof id === 'string') &&
  (value.characterIds === undefined || (Array.isArray(value.characterIds) && value.characterIds.every((id) => typeof id === 'string'))) &&
  (value.blocks === undefined || (Array.isArray(value.blocks) && value.blocks.every((block) => (
    isRecord(block) && (
      (block.type === 'narration' && typeof block.text === 'string') ||
      (block.type === 'dialogue' && typeof block.speakerId === 'string' && typeof block.text === 'string')
    )
  )))) &&
  (value.chapterNumber === undefined || (isFiniteNumber(value.chapterNumber) && value.chapterNumber >= 1)) &&
  (value.source === 'local' || value.source === 'ai')

const normalizeRelationships = (value: unknown): WorldState['narrative']['relationshipsByEntityId'] => {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([observerId, targets]) => {
    if (!isRecord(targets)) return [observerId, {}]
    const normalizedTargets = Object.fromEntries(Object.entries(targets).flatMap(([targetId, relationship]) => {
      if (!isRecord(relationship) || !isFiniteNumber(relationship.affinity) || !isFiniteNumber(relationship.encounters)) return []
      if (!eventTypes.has(relationship.lastEventType as WorldState['events'][number]['type'])) return []
      return [[targetId, {
        targetEntityId: typeof relationship.targetEntityId === 'string' ? relationship.targetEntityId : targetId,
        affinity: Math.max(-100, Math.min(100, relationship.affinity)),
        encounters: Math.max(0, Math.floor(relationship.encounters)),
        lastEventType: relationship.lastEventType as WorldState['events'][number]['type'],
        updatedAtSeconds: isFiniteNumber(relationship.updatedAtSeconds) ? Math.max(0, relationship.updatedAtSeconds) : 0,
      }]]
    }))
    return [observerId, normalizedTargets]
  }))
}

const cleanStoredText = (value: unknown, maxLength: number) => (
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : ''
)

const parseStoredDirectorEvent = (value: Record<string, unknown>): WorldDirectorEvent | undefined => {
  if (value.type === 'narration') {
    const text = cleanStoredText(value.text, 500)
    return text ? { type: value.type, text } : undefined
  }
  if (value.type === 'dialogue') {
    const speakerId = cleanStoredText(value.speakerId, 160)
    const listenerId = cleanStoredText(value.listenerId, 160)
    const text = cleanStoredText(value.text, 180)
    return speakerId && text
      ? { type: value.type, speakerId, ...(listenerId && listenerId !== speakerId ? { listenerId } : {}), text }
      : undefined
  }
  if (value.type === 'command') {
    const entityId = cleanStoredText(value.entityId, 160)
    const command = parseStoredCommand(value.command)
    const directorCommand = command && command.type !== 'patrol'
      && (!('target' in command) || command.target.kind !== 'waypoint')
      ? command
      : undefined
    return entityId && directorCommand ? { type: value.type, entityId, command: directorCommand } : undefined
  }
  if (value.type === 'relationship') {
    const fromId = cleanStoredText(value.fromId, 160)
    const toId = cleanStoredText(value.toId, 160)
    const delta = isFiniteNumber(value.delta) ? Math.max(-10, Math.min(10, Math.round(value.delta))) : 0
    const reason = cleanStoredText(value.reason, 120)
    return fromId && toId && fromId !== toId && delta !== 0
      ? { type: value.type, fromId, toId, delta, reason }
      : undefined
  }
  if (value.type === 'choice') {
    const label = cleanStoredText(value.label, 48)
    const suggestedInput = cleanStoredText(value.suggestedInput, 240)
    return label && suggestedInput ? { type: value.type, label, suggestedInput } : undefined
  }
  if (value.type === 'end') {
    const summary = cleanStoredText(value.summary, 300)
    return summary ? { type: value.type, summary } : undefined
  }
  return undefined
}

const parseStoredDirectorEntry = (value: unknown): WorldDirectorEntry | undefined => {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined
  const event = parseStoredDirectorEvent(value)
  if (!event) return undefined
  return {
    ...event,
    id: value.id.slice(0, 180),
    ...(['accepted', 'rejected'].includes(String(value.status)) ? { status: value.status as 'accepted' | 'rejected' } : {}),
    ...(typeof value.detail === 'string' ? { detail: value.detail.slice(0, 160) } : {}),
    ...(isFiniteNumber(value.before) ? { before: Math.max(-100, Math.min(100, value.before)) } : {}),
    ...(isFiniteNumber(value.after) ? { after: Math.max(-100, Math.min(100, value.after)) } : {}),
  } as WorldDirectorEntry
}

const parseStoredDirectorTurns = (value: unknown, planId: string): WorldState['narrative']['directorTurns'] => (
  Array.isArray(value) ? value.flatMap((turn) => {
    if (!isRecord(turn) || typeof turn.id !== 'string' || !isFiniteNumber(turn.createdAtSeconds)) return []
    const playerText = cleanStoredText(turn.playerText, 800)
    if (!playerText || !['completed', 'stopped', 'failed'].includes(String(turn.status))) return []
    const storedContextStats = isRecord(turn.contextStats) ? turn.contextStats : undefined
    const contextStats = storedContextStats
      && isFiniteNumber(storedContextStats.messageCount)
      && isFiniteNumber(storedContextStats.estimatedInputTokens)
      && isFiniteNumber(storedContextStats.rawTurnCount)
      && isFiniteNumber(storedContextStats.memoryTurnCount)
      ? {
          messageCount: Math.max(0, Math.floor(storedContextStats.messageCount)),
          estimatedInputTokens: Math.max(0, Math.floor(storedContextStats.estimatedInputTokens)),
          rawTurnCount: Math.max(0, Math.floor(storedContextStats.rawTurnCount)),
          memoryTurnCount: Math.max(0, Math.floor(storedContextStats.memoryTurnCount)),
          ...(typeof storedContextStats.compactionTriggered === 'boolean'
            ? { compactionTriggered: storedContextStats.compactionTriggered }
            : {}),
          ...(isFiniteNumber(storedContextStats.inputTokens) ? { inputTokens: Math.max(0, Math.floor(storedContextStats.inputTokens)) } : {}),
          ...(isFiniteNumber(storedContextStats.outputTokens) ? { outputTokens: Math.max(0, Math.floor(storedContextStats.outputTokens)) } : {}),
          ...(isFiniteNumber(storedContextStats.cachedTokens) ? { cachedTokens: Math.max(0, Math.floor(storedContextStats.cachedTokens)) } : {}),
          ...(isFiniteNumber(storedContextStats.totalTokens) ? { totalTokens: Math.max(0, Math.floor(storedContextStats.totalTokens)) } : {}),
        }
      : undefined
    const checkpoint = parseStoredDirectorCheckpoint(turn.checkpoint, planId)
    return [{
      id: turn.id.slice(0, 180),
      playerText,
      entries: Array.isArray(turn.entries)
        ? turn.entries.flatMap((entry) => {
            const parsed = parseStoredDirectorEntry(entry)
            return parsed ? [parsed] : []
          }).slice(-20)
        : [],
      createdAtSeconds: Math.max(0, turn.createdAtSeconds),
      status: turn.status as 'completed' | 'stopped' | 'failed',
      ...(typeof turn.reasoning === 'string' ? { reasoning: turn.reasoning.slice(0, 20_000) } : {}),
      ...(typeof turn.requestMessage === 'string' ? { requestMessage: turn.requestMessage.slice(0, 60_000) } : {}),
      ...(typeof turn.responseMessage === 'string' ? { responseMessage: turn.responseMessage.slice(0, 30_000) } : {}),
      ...(contextStats ? { contextStats } : {}),
      ...(typeof turn.error === 'string' ? { error: turn.error.slice(0, 300) } : {}),
      ...(checkpoint ? { checkpoint } : {}),
    }]
  }).slice(-100) : []
)

export const parseStoredWorldState = (value: unknown, planId: string) => {
  if (!isRecord(value) || value.planId !== planId || !Array.isArray(value.entities)) return undefined
  const entities = value.entities.map(parseStoredEntity)
  if (entities.some((entity) => !entity)) return undefined
  const safeEntities = resolveOverlappingWorldEntities(entities as WorldEntity[])
  const entityIds = new Set(safeEntities.map((entity) => entity.id))
  const events = parseStoredEvents(value.events)
  const pendingImpacts = Array.isArray(value.pendingImpacts) ? value.pendingImpacts.filter((impact): impact is WorldState['pendingImpacts'][number] => (
    isRecord(impact) && typeof impact.id === 'string' && typeof impact.actorId === 'string' && entityIds.has(impact.actorId) &&
    Boolean(parseTargetRef(impact.target)) && isRecord(impact.target) && ['entity', 'brick', 'structure'].includes(String(impact.target.kind)) &&
    isFiniteNumber(impact.damage) && impact.damage > 0 &&
    (impact.projectileKind === 'arrow' || impact.projectileKind === 'stone') && isFiniteNumber(impact.impactAtSeconds) &&
    isRecord(impact.impactPoint) && isFiniteNumber(impact.impactPoint.x) &&
    isFiniteNumber(impact.impactPoint.y) && isFiniteNumber(impact.impactPoint.z)
  )).slice(-100) : []
  const narrative = isRecord(value.narrative) ? value.narrative : {}

  let scenarios: WorldState['scenarios'] = Array.isArray(value.scenarios)
    ? value.scenarios.flatMap((scenario) => {
        if (!isRecord(scenario) || typeof scenario.id !== 'string' || typeof scenario.assetId !== 'string' ||
          typeof scenario.title !== 'string' || typeof scenario.description !== 'string' || !Array.isArray(scenario.stages)) return []
        const stages = scenario.stages.flatMap((stage) => {
          if (!isRecord(stage) || typeof stage.id !== 'string' || typeof stage.title !== 'string' ||
            typeof stage.description !== 'string' || !['locked', 'active', 'completed'].includes(String(stage.status)) ||
            !isRecord(stage.trigger) || !eventTypes.has(stage.trigger.eventType as WorldState['events'][number]['type'])) return []
          const actions = Array.isArray(stage.actions) ? stage.actions.flatMap((action): WorldScenarioAction[] => {
            if (!isRecord(action) || typeof action.type !== 'string') return []
            if (action.type === 'set-faction' && typeof action.entityId === 'string' && typeof action.factionId === 'string') {
              return [{ type: 'set-faction' as const, entityId: action.entityId, factionId: action.factionId }]
            }
            if (action.type === 'issue-command' && typeof action.entityId === 'string') {
              const command = parseStoredCommand(action.command)
              return command ? [{ type: 'issue-command' as const, entityId: action.entityId, command }] : []
            }
            if (action.type === 'set-visibility' && typeof action.visible === 'boolean') {
              const target = parseTargetRef(action.target)
              return target && target.kind !== 'waypoint' ? [{ type: 'set-visibility' as const, target, visible: action.visible }] : []
            }
            if (action.type === 'add-story' && typeof action.title === 'string' && typeof action.body === 'string') {
              return [{
                type: 'add-story' as const,
                title: action.title,
                body: action.body,
                characterIds: Array.isArray(action.characterIds)
                  ? action.characterIds.filter((id): id is string => typeof id === 'string')
                  : undefined,
              }]
            }
            return []
          }) : undefined
          const dialogue = Array.isArray(stage.dialogue) ? stage.dialogue.flatMap((line) => {
            if (!isRecord(line) || typeof line.id !== 'string' || typeof line.speakerId !== 'string' ||
              typeof line.text !== 'string' || !line.text.trim() || !isFiniteNumber(line.durationSeconds)) return []
            return [{
              id: line.id,
              speakerId: line.speakerId,
              text: line.text.slice(0, 500),
              durationSeconds: Math.max(0.5, Math.min(30, line.durationSeconds)),
            }]
          }) : undefined
          const branches = Array.isArray(stage.branches) ? stage.branches.flatMap((branch) => {
            if (!isRecord(branch) || typeof branch.id !== 'string' || typeof branch.title !== 'string' ||
              !isRecord(branch.trigger) || !eventTypes.has(branch.trigger.eventType as WorldState['events'][number]['type'])) return []
            const branchActions = Array.isArray(branch.actions) ? branch.actions.flatMap((action): WorldScenarioAction[] => {
              if (!isRecord(action) || typeof action.type !== 'string') return []
              if (action.type === 'set-faction' && typeof action.entityId === 'string' && typeof action.factionId === 'string') return [{ type: 'set-faction', entityId: action.entityId, factionId: action.factionId }]
              if (action.type === 'issue-command' && typeof action.entityId === 'string') {
                const command = parseStoredCommand(action.command)
                return command ? [{ type: 'issue-command', entityId: action.entityId, command }] : []
              }
              if (action.type === 'set-visibility' && typeof action.visible === 'boolean') {
                const target = parseTargetRef(action.target)
                return target && target.kind !== 'waypoint' ? [{ type: 'set-visibility', target, visible: action.visible }] : []
              }
              if (action.type === 'add-story' && typeof action.title === 'string' && typeof action.body === 'string') return [{
                type: 'add-story', title: action.title, body: action.body,
                characterIds: Array.isArray(action.characterIds) ? action.characterIds.filter((id): id is string => typeof id === 'string') : undefined,
              }]
              return []
            }) : undefined
            const branchDialogue = Array.isArray(branch.dialogue) ? branch.dialogue.flatMap((line) => {
              if (!isRecord(line) || typeof line.id !== 'string' || typeof line.speakerId !== 'string' ||
                typeof line.text !== 'string' || !line.text.trim() || !isFiniteNumber(line.durationSeconds)) return []
              return [{ id: line.id, speakerId: line.speakerId, text: line.text.slice(0, 500), durationSeconds: Math.max(0.5, Math.min(30, line.durationSeconds)) }]
            }) : undefined
            return [{
              id: branch.id,
              title: branch.title,
              ...(typeof branch.aiGuidance === 'string' && branch.aiGuidance.trim()
                ? { aiGuidance: branch.aiGuidance.trim().slice(0, 1_000) }
                : {}),
              trigger: {
                eventType: branch.trigger.eventType as WorldState['events'][number]['type'],
                ...(typeof branch.trigger.actorId === 'string' ? { actorId: branch.trigger.actorId } : {}),
                ...(typeof branch.trigger.targetId === 'string' ? { targetId: branch.trigger.targetId } : {}),
                ...(typeof branch.trigger.commandType === 'string' ? { commandType: branch.trigger.commandType as WorldEntityCommand['type'] } : {}),
                ...(isFiniteNumber(branch.trigger.minimumAffinity)
                  ? { minimumAffinity: Math.max(-100, Math.min(100, branch.trigger.minimumAffinity)) }
                  : {}),
              },
              ...(typeof branch.nextStageId === 'string' ? { nextStageId: branch.nextStageId } : {}),
              ...(branchDialogue?.length ? { dialogue: branchDialogue } : {}),
              ...(branchActions ? { actions: branchActions } : {}),
            }]
          }) : undefined
          const ai = isRecord(stage.ai)
            && (stage.ai.mode === 'dialogue' || stage.ai.mode === 'choice')
            && typeof stage.ai.instruction === 'string'
            ? {
                mode: stage.ai.mode as 'dialogue' | 'choice',
                instruction: stage.ai.instruction.trim().slice(0, 2_000),
                ...(Array.isArray(stage.ai.speakerIds)
                  ? {
                      speakerIds: stage.ai.speakerIds
                        .filter((id): id is string => typeof id === 'string' && entityIds.has(id))
                        .slice(0, 20),
                    }
                  : {}),
                ...(isFiniteNumber(stage.ai.maxDialogueLines)
                  ? { maxDialogueLines: Math.max(1, Math.min(6, Math.floor(stage.ai.maxDialogueLines))) }
                  : {}),
                ...(typeof stage.ai.fallbackBranchId === 'string'
                  ? { fallbackBranchId: stage.ai.fallbackBranchId.slice(0, 180) }
                  : {}),
              }
            : undefined
          return [{
            id: stage.id,
            title: stage.title,
            description: stage.description,
            status: stage.status as 'locked' | 'active' | 'completed',
            trigger: {
              eventType: stage.trigger.eventType as WorldState['events'][number]['type'],
              ...(typeof stage.trigger.actorId === 'string' ? { actorId: stage.trigger.actorId } : {}),
              ...(typeof stage.trigger.targetId === 'string' ? { targetId: stage.trigger.targetId } : {}),
              ...(typeof stage.trigger.commandType === 'string' ? { commandType: stage.trigger.commandType as WorldEntityCommand['type'] } : {}),
              ...(isFiniteNumber(stage.trigger.minimumAffinity)
                ? { minimumAffinity: Math.max(-100, Math.min(100, stage.trigger.minimumAffinity)) }
                : {}),
            },
            ...(ai ? { ai } : {}),
            ...(dialogue?.length ? { dialogue } : {}),
            ...(actions ? { actions } : {}),
            ...(stage.nextStageId === null
              ? { nextStageId: null }
              : typeof stage.nextStageId === 'string' ? { nextStageId: stage.nextStageId } : {}),
            ...(branches?.length ? { branches } : {}),
            ...(isFiniteNumber(stage.completedAtSeconds) ? { completedAtSeconds: Math.max(0, stage.completedAtSeconds) } : {}),
          }]
        })
        if (stages.length === 0) return []
        const authoringVersion = isFiniteNumber(scenario.authoringVersion) ? Math.max(0, Math.floor(scenario.authoringVersion)) : 0
        const upgradedStages = scenario.assetId === 'scenario-border-tavern'
          ? upgradeGrayRavenScenarioStages(stages, scenario.title, authoringVersion)
          : stages
        const activeDialogue = isRecord(scenario.activeDialogue) &&
          typeof scenario.activeDialogue.stageId === 'string' &&
          typeof scenario.activeDialogue.eventId === 'string' &&
          isFiniteNumber(scenario.activeDialogue.lineIndex) &&
          isFiniteNumber(scenario.activeDialogue.lineEndsAtSeconds)
          ? {
              stageId: scenario.activeDialogue.stageId,
              eventId: scenario.activeDialogue.eventId,
              ...(typeof scenario.activeDialogue.branchId === 'string' ? { branchId: scenario.activeDialogue.branchId } : {}),
              ...(Array.isArray(scenario.activeDialogue.generatedDialogue)
                ? {
                    generatedDialogue: scenario.activeDialogue.generatedDialogue.flatMap((line) => {
                      if (!isRecord(line) || typeof line.id !== 'string' || typeof line.speakerId !== 'string' ||
                        typeof line.text !== 'string' || !line.text.trim() || !isFiniteNumber(line.durationSeconds)) return []
                      return [{
                        id: line.id.slice(0, 180),
                        speakerId: line.speakerId.slice(0, 180),
                        text: line.text.trim().slice(0, 500),
                        durationSeconds: Math.max(0.5, Math.min(30, line.durationSeconds)),
                      }]
                    }).slice(0, 6),
                  }
                : {}),
              ...(scenario.activeDialogue.source === 'ai' || scenario.activeDialogue.source === 'authored'
                ? { source: scenario.activeDialogue.source as 'ai' | 'authored' }
                : {}),
              lineIndex: Math.max(0, Math.floor(scenario.activeDialogue.lineIndex)),
              lineEndsAtSeconds: Math.max(0, scenario.activeDialogue.lineEndsAtSeconds),
            }
          : undefined
        const pendingAi = isRecord(scenario.pendingAi)
          && typeof scenario.pendingAi.stageId === 'string'
          && typeof scenario.pendingAi.eventId === 'string'
          && isFiniteNumber(scenario.pendingAi.requestedAtSeconds)
          ? {
              stageId: scenario.pendingAi.stageId.slice(0, 180),
              eventId: scenario.pendingAi.eventId.slice(0, 180),
              ...(typeof scenario.pendingAi.branchId === 'string'
                ? { branchId: scenario.pendingAi.branchId.slice(0, 180) }
                : {}),
              requestedAtSeconds: Math.max(0, scenario.pendingAi.requestedAtSeconds),
            }
          : undefined
        const inferredCastEntityIds = Array.from(new Set(upgradedStages.flatMap((stage) => [
          stage.trigger.actorId,
          stage.trigger.targetId,
          ...(stage.dialogue ?? []).map((line) => line.speakerId),
          ...(stage.actions ?? []).flatMap((action) => action.type === 'add-story'
            ? action.characterIds ?? []
            : action.type === 'set-visibility'
              ? action.target.kind === 'entity' ? [action.target.id] : []
              : [action.entityId]),
          ...(stage.branches ?? []).flatMap((branch) => [
            branch.trigger.actorId,
            branch.trigger.targetId,
            ...(branch.dialogue ?? []).map((line) => line.speakerId),
            ...(branch.actions ?? []).flatMap((action) => action.type === 'add-story'
              ? action.characterIds ?? []
              : action.type === 'set-visibility'
                ? action.target.kind === 'entity' ? [action.target.id] : []
                : [action.entityId]),
          ]),
        ].filter((id): id is string => Boolean(id) && entityIds.has(id)))))
        const castEntityIds = Array.isArray(scenario.castEntityIds)
          ? scenario.castEntityIds.filter((id): id is string => typeof id === 'string' && entityIds.has(id))
          : inferredCastEntityIds
        return [{
          id: scenario.id,
          assetId: scenario.assetId,
          title: scenario.title,
          description: scenario.description,
          ...(typeof scenario.enabled === 'boolean' ? { enabled: scenario.enabled } : {}),
          ...(castEntityIds.length ? { castEntityIds } : {}),
          stages: upgradedStages,
          processedEventIds: Array.isArray(scenario.processedEventIds)
            ? scenario.processedEventIds.filter((id): id is string => typeof id === 'string').slice(-500)
            : [],
          ...(Array.isArray(scenario.claimedEventIds) ? {
            claimedEventIds: scenario.claimedEventIds
              .filter((id): id is string => typeof id === 'string')
              .slice(-500),
          } : {}),
          ...(pendingAi ? { pendingAi } : {}),
          ...(activeDialogue ? { activeDialogue } : {}),
          ...(typeof scenario.outcomeId === 'string' ? { outcomeId: scenario.outcomeId } : {}),
          ...(scenario.assetId === 'scenario-border-tavern'
            ? { authoringVersion: Math.max(4, authoringVersion) }
            : authoringVersion ? { authoringVersion } : {}),
        }]
      }).slice(-20)
    : []

  let migratedGrayRavenEileenId: string | undefined
  const legacyGrayRaven = scenarios.find((scenario) => (
    scenario.assetId === 'scenario-border-tavern'
    && (scenario.authoringVersion ?? 0) < 5
  ))
  if (legacyGrayRaven && !scenarios.some((scenario) => scenario.assetId === 'scenario-border-tavern-eileen-companion')) {
    const investigate = legacyGrayRaven.stages.find((stage) => stage.id.endsWith('investigate'))
    const rolandId = investigate?.trigger.actorId
    const eileenId = investigate?.trigger.targetId
    if (rolandId && eileenId) {
      migratedGrayRavenEileenId = eileenId
      scenarios.push(createGrayRavenEileenCompanionScenario(
        legacyGrayRaven.id,
        new Set(scenarios.map((scenario) => scenario.id)),
        rolandId,
        eileenId,
        /[\u3400-\u9fff]/.test(legacyGrayRaven.title),
      ))
    }
  }
  scenarios = scenarios.map((scenario) => scenario.assetId === 'scenario-border-tavern'
    ? { ...scenario, authoringVersion: 5 }
    : scenario)

  const storedHiddenTargets = Array.isArray(value.hiddenTargets) ? value.hiddenTargets.flatMap((target) => {
    const parsed = parseTargetRef(target)
    return parsed && parsed.kind !== 'waypoint' ? [parsed] : []
  }).slice(-500) : []
  const terminalHiddenTargets = scenarios.flatMap((scenario) => {
    if (!scenario.outcomeId) return []
    const branch = scenario.stages
      .flatMap((stage) => stage.branches ?? [])
      .find((candidate) => candidate.id === scenario.outcomeId)
    return (branch?.actions ?? []).flatMap((action) => (
      action.type === 'set-visibility' && !action.visible ? [action.target] : []
    ))
  })
  const hiddenTargets = [...storedHiddenTargets]
  for (const target of terminalHiddenTargets) {
    if (!hiddenTargets.some((candidate) => candidate.kind === target.kind && candidate.id === target.id)) {
      hiddenTargets.push(target)
    }
  }
  const hiddenEntityIds = new Set(hiddenTargets.flatMap((target) => target.kind === 'entity' ? [target.id] : []))
  const storylineMemberships = new Map<string, string[]>()
  for (const scenario of scenarios) {
    for (const entityId of scenario.castEntityIds ?? []) {
      storylineMemberships.set(entityId, [...(storylineMemberships.get(entityId) ?? []), scenario.id])
    }
  }
  const restoredEntities = safeEntities.map((entity) => {
    const memberships = storylineMemberships.get(entity.id) ?? []
    const restoredWithStoryline = entity.storylineId || memberships.length !== 1
      ? entity
      : { ...entity, storylineId: memberships[0] }
    const restored = entity.id === migratedGrayRavenEileenId
      ? { ...restoredWithStoryline, factionId: 'neutral' }
      : restoredWithStoryline
    if (!hiddenEntityIds.has(entity.id)) return restored
    return {
      ...restored,
      activeCommand: undefined,
      commandQueue: [],
      speech: undefined,
      behaviorState: 'idle' as const,
      navigation: { status: 'idle' as const, path: [], pathIndex: 0 },
    }
  })
  const directorTurns = parseStoredDirectorTurns(narrative.directorTurns, planId)
  const storedDirectorMemory = isRecord(narrative.directorMemory) ? narrative.directorMemory : undefined
  const directorMemory = storedDirectorMemory
    && typeof storedDirectorMemory.summary === 'string'
    && typeof storedDirectorMemory.throughTurnId === 'string'
    && isFiniteNumber(storedDirectorMemory.sourceTurnCount)
    && isFiniteNumber(storedDirectorMemory.updatedAtSeconds)
    ? {
        summary: storedDirectorMemory.summary.slice(0, 4_000),
        ...(Array.isArray(storedDirectorMemory.lockedFacts)
          ? {
              lockedFacts: storedDirectorMemory.lockedFacts
                .filter((fact): fact is string => typeof fact === 'string' && Boolean(fact.trim()))
                .map((fact) => fact.trim().slice(0, 300))
                .slice(0, 30),
            }
          : {}),
        throughTurnId: storedDirectorMemory.throughTurnId.slice(0, 180),
        sourceTurnCount: Math.max(0, Math.floor(storedDirectorMemory.sourceTurnCount)),
        updatedAtSeconds: Math.max(0, storedDirectorMemory.updatedAtSeconds),
      }
    : undefined
  const migratedEvents = [...events]
  const entityById = new Map(restoredEntities.map((entity) => [entity.id, entity]))
  for (const scenario of scenarios) {
    if (scenario.activeDialogue) continue
    const activeStage = scenario.stages.find((stage) => (
      stage.status === 'active'
      && stage.trigger.eventType === 'interaction'
      && stage.trigger.actorId
      && stage.trigger.targetId
    ))
    if (!activeStage?.trigger.actorId || !activeStage.trigger.targetId) continue
    const { actorId, targetId } = activeStage.trigger
    if (migratedEvents.some((event) => event.type === 'interaction' && event.actorId === actorId && event.targetId === targetId)) continue
    const stageOpenedAtSeconds = Math.max(0, ...scenario.stages
      .filter((stage) => stage.status === 'completed')
      .map((stage) => stage.completedAtSeconds ?? 0))
    const matchingTurn = [...directorTurns].reverse().find((turn) => (
      turn.createdAtSeconds >= stageOpenedAtSeconds
      && [...turn.entries].reverse().some((entry) => (
        entry.type === 'dialogue'
        && (
          (entry.speakerId === targetId && (!entry.listenerId || entry.listenerId === actorId))
          || (entry.speakerId === actorId && entry.listenerId === targetId)
        )
      ))
    ))
    if (!matchingTurn) continue
    migratedEvents.push({
      id: `migrated-director-dialogue-${scenario.id}-${activeStage.id}`,
      timeSeconds: matchingTurn.createdAtSeconds,
      type: 'interaction',
      actorId,
      actorName: entityById.get(actorId)?.name,
      targetId,
      targetName: entityById.get(targetId)?.name,
      commandType: 'interact',
      commandSource: 'player',
    })
  }

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `world-${planId}`,
    planId,
    randomSeed: isFiniteNumber(value.randomSeed) ? Math.floor(value.randomSeed) : 1,
    elapsedSeconds: isFiniteNumber(value.elapsedSeconds) ? Math.max(0, value.elapsedSeconds) : 0,
    paused: typeof value.paused === 'boolean' ? value.paused : false,
    entities: restoredEntities,
    events: migratedEvents,
    pendingImpacts,
    scenarios,
    hiddenTargets,
    narrative: {
      processedEventIds: Array.isArray(narrative.processedEventIds)
        ? narrative.processedEventIds.filter((id): id is string => typeof id === 'string').slice(-1_000)
        : [],
      memoriesByEntityId: normalizeArrayRecord(narrative.memoriesByEntityId, isStoredMemory),
      relationshipsByEntityId: normalizeRelationships(narrative.relationshipsByEntityId),
      stories: Array.isArray(narrative.stories) ? narrative.stories.filter(isStoredStory).slice(-80) : [],
      directorTurns,
      ...(directorMemory ? { directorMemory } : {}),
    },
  } satisfies WorldState
}

const parseStoredDirectorCheckpoint = (
  value: unknown,
  planId: string,
): WorldDirectorCheckpoint | undefined => {
  if (!isRecord(value) || !isRecord(value.narrative) || !Array.isArray(value.directorTurnIds)) return undefined
  const parsedWorld = parseStoredWorldState({
    ...value,
    narrative: {
      ...value.narrative,
      directorTurns: [],
    },
  }, planId)
  if (!parsedWorld) return undefined
  const { directorTurns: _directorTurns, ...narrative } = parsedWorld.narrative
  void _directorTurns
  return {
    ...parsedWorld,
    narrative,
    directorTurnIds: value.directorTurnIds
      .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
      .map((id) => id.slice(0, 180))
      .slice(-100),
  }
}

const getCommandTargets = (command: WorldEntityCommand): WorldTargetRef[] => {
  if ('target' in command) return [command.target]
  if (command.type === 'patrol') return command.waypointIds.map((id) => ({ kind: 'waypoint', id }))
  return []
}

export type WorldCommandIssue =
  | 'ENTITY_NOT_FOUND'
  | 'EMPTY_TARGET_ID'
  | 'SELF_TARGET'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_NOT_DEFEATED'
  | 'UNSUPPORTED_COMMAND'
  | 'EMPTY_PATROL_ROUTE'

export type WorldCommandResult =
  | { ok: true; world: WorldState }
  | { ok: false; world: WorldState; issue: WorldCommandIssue }

export const issueWorldEntityCommand = (
  world: WorldState,
  entityId: string,
  command: WorldEntityCommand,
  targetExists: (target: WorldTargetRef) => boolean = (target) => (
    target.kind === 'entity' && world.entities.some((entity) => entity.id === target.id)
  ),
  queueMode: 'append' | 'replace' = 'append',
): WorldCommandResult => {
  const entity = world.entities.find((candidate) => candidate.id === entityId)
  if (!entity) return { ok: false, world, issue: 'ENTITY_NOT_FOUND' }
  if (command.type === 'revive' && !worldEntityDefinitionById.get(entity.definitionId)?.support) {
    return { ok: false, world, issue: 'UNSUPPORTED_COMMAND' }
  }
  if (command.type === 'patrol' && command.waypointIds.length === 0) {
    return { ok: false, world, issue: 'EMPTY_PATROL_ROUTE' }
  }

  for (const target of getCommandTargets(command)) {
    if (!normalizeName(target.id)) return { ok: false, world, issue: 'EMPTY_TARGET_ID' }
    if (target.kind === 'entity' && target.id === entityId) {
      return { ok: false, world, issue: 'SELF_TARGET' }
    }
    if (!targetExists(target)) return { ok: false, world, issue: 'TARGET_NOT_FOUND' }
  }

  if (command.type === 'revive') {
    const reviveTarget = world.entities.find((candidate) => candidate.id === command.target.id)
    if (!reviveTarget || reviveTarget.health > 0) return { ok: false, world, issue: 'TARGET_NOT_DEFEATED' }
  }

  const target = getCommandTargets(command)[0]
  const targetEntity = target?.kind === 'entity'
    ? world.entities.find((candidate) => candidate.id === target.id)
    : undefined
  const commandEvent = {
    id: `event-command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    timeSeconds: world.elapsedSeconds,
    type: 'command-issued' as const,
    actorId: entity.id,
    actorName: entity.name,
    targetId: target?.id,
    targetName: targetEntity?.name ?? target?.id,
    commandType: command.type,
    commandSource: entity.controller,
  }

  return {
    ok: true,
    world: {
      ...world,
      entities: world.entities.map((candidate) => candidate.id === entityId
        ? queueMode === 'replace'
          ? {
              ...candidate,
              activeCommand: undefined,
              commandQueue: [command],
              behaviorState: candidate.health > 0 ? 'idle' : 'dead',
              navigation: { status: 'idle', path: [], pathIndex: 0 },
            }
          : { ...candidate, commandQueue: [...candidate.commandQueue, command] }
        : candidate),
      events: [...world.events, commandEvent].slice(-500),
    },
  }
}
