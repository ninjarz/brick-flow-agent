import type { WorldEvent, WorldMemory, WorldNarrativeState, WorldRelationship, WorldState, WorldStory } from '../types/world'

const maxMemoriesPerEntity = 40
const maxProcessedEvents = 1_000
const maxStories = 80

const eventImportance = (type: WorldEvent['type']): 1 | 2 | 3 => {
  if (type === 'defeated' || type === 'revive') return 3
  if (type === 'damage' || type === 'brick-hit' || type === 'structure-hit') return 2
  return 1
}

const appendMemory = (
  memories: Record<string, WorldMemory[]>,
  entityId: string,
  memory: WorldMemory,
) => ({
  ...memories,
  [entityId]: [...(memories[entityId] ?? []), memory].slice(-maxMemoriesPerEntity),
})

const clampAffinity = (value: number) => Math.max(-100, Math.min(100, value))

const relationshipDelta = (event: WorldEvent, observerId: string) => {
  if (event.type === 'interaction') return 5
  if (event.type === 'revive') return observerId === event.targetId ? 18 : 10
  if (event.type === 'defeated') return observerId === event.targetId ? -24 : -5
  if (event.type === 'damage') return observerId === event.targetId ? -10 : -3
  if (event.type === 'attack') return observerId === event.targetId ? -4 : -1
  return 0
}

const updateRelationship = (
  relationships: WorldNarrativeState['relationshipsByEntityId'],
  observerId: string,
  targetEntityId: string,
  event: WorldEvent,
) => {
  const current = relationships[observerId]?.[targetEntityId]
  const next: WorldRelationship = {
    targetEntityId,
    affinity: clampAffinity((current?.affinity ?? 0) + relationshipDelta(event, observerId)),
    encounters: (current?.encounters ?? 0) + 1,
    lastEventType: event.type,
    updatedAtSeconds: event.timeSeconds,
  }
  return {
    ...relationships,
    [observerId]: { ...(relationships[observerId] ?? {}), [targetEntityId]: next },
  }
}

export const ingestWorldEvents = (
  narrative: WorldNarrativeState,
  events: WorldEvent[],
  entityIds: Set<string>,
): WorldNarrativeState => {
  const processedIds = new Set(narrative.processedEventIds)
  let memories = narrative.memoriesByEntityId
  let relationships = narrative.relationshipsByEntityId ?? {}
  const nextProcessedIds = [...narrative.processedEventIds]

  for (const event of events) {
    if (processedIds.has(event.id)) continue
    processedIds.add(event.id)
    nextProcessedIds.push(event.id)
    memories = appendMemory(memories, event.actorId, {
      id: `memory-${event.id}-${event.actorId}`,
      eventId: event.id,
      entityId: event.actorId,
      timeSeconds: event.timeSeconds,
      type: event.type,
      otherId: event.targetId,
      otherName: event.targetName,
      importance: eventImportance(event.type),
    })
    if (event.targetId && entityIds.has(event.targetId)) {
      memories = appendMemory(memories, event.targetId, {
        id: `memory-${event.id}-${event.targetId}`,
        eventId: event.id,
        entityId: event.targetId,
        timeSeconds: event.timeSeconds,
        type: event.type,
        otherId: event.actorId,
        otherName: event.actorName,
        importance: eventImportance(event.type),
      })
      relationships = updateRelationship(relationships, event.actorId, event.targetId, event)
      relationships = updateRelationship(relationships, event.targetId, event.actorId, event)
    }
  }

  return {
    ...narrative,
    processedEventIds: nextProcessedIds.slice(-maxProcessedEvents),
    memoriesByEntityId: memories,
    relationshipsByEntityId: relationships,
  }
}

const displayName = (name: string | undefined, id: string | undefined, fallback: string) =>
  name?.trim() || id?.trim() || fallback

const commandName = (type: WorldEvent['commandType'], locale: 'zh-CN' | 'en-US') => {
  if (locale === 'en-US') return type ?? 'act'
  return ({
    stop: '停止',
    wander: '闲逛',
    move: '移动',
    attack: '攻击',
    revive: '复活',
    guard: '守卫',
    follow: '跟随',
    interact: '交谈',
    patrol: '巡逻',
  } as const)[type ?? 'move'] ?? '行动'
}

export const formatWorldEvent = (event: WorldEvent, locale: 'zh-CN' | 'en-US') => {
  const actor = displayName(event.actorName, event.actorId, locale === 'zh-CN' ? '某个单位' : 'A unit')
  const target = displayName(event.targetName, event.targetId, locale === 'zh-CN' ? '目标' : 'the target')
  if (locale === 'en-US') {
    if (event.type === 'command-issued') {
      const source = event.commandSource === 'ai' ? 'AI' : event.commandSource === 'player' ? 'the player' : 'the rule controller'
      return `${source} ordered ${actor} to ${commandName(event.commandType, locale)}${event.targetId ? ` toward ${target}` : ''}.`
    }
    if (event.type === 'attack') return `${actor} attacked ${target}.`
    if (event.type === 'damage') return `${target} took ${event.amount ?? 0} damage from ${actor}.`
    if (event.type === 'miss') return `${actor}'s attack missed ${target}.`
    if (event.type === 'defeated') return `${actor} defeated ${target}.`
    if (event.type === 'revive') return `${actor} revived ${target} with ${event.amount ?? 0} health.`
    if (event.type === 'brick-hit') return `${actor} struck brick ${target}, but the structure was not damaged.`
    if (event.type === 'structure-hit') return `${actor} struck structure ${target}, but it remained intact.`
    if (event.type === 'interaction') return `${actor} interacted with ${target}.`
    return `${actor} completed an order involving ${target}.`
  }
  if (event.type === 'command-issued') {
    const source = event.commandSource === 'ai' ? 'AI' : event.commandSource === 'player' ? '玩家' : '规则控制器'
    return `${source}命令${actor}执行“${commandName(event.commandType, locale)}”${event.targetId ? `，目标是${target}` : ''}。`
  }
  if (event.type === 'attack') return `${actor}向${target}发起了攻击。`
  if (event.type === 'damage') return `${target}受到${actor}造成的 ${event.amount ?? 0} 点伤害。`
  if (event.type === 'miss') return `${actor}的攻击没有命中${target}。`
  if (event.type === 'defeated') return `${actor}击败了${target}。`
  if (event.type === 'revive') return `${actor}复活了${target}，恢复 ${event.amount ?? 0} 点生命。`
  if (event.type === 'brick-hit') return `${actor}击中了砖块${target}，但建筑没有受损。`
  if (event.type === 'structure-hit') return `${actor}攻击了结构${target}，结构依然完好。`
  if (event.type === 'interaction') return `${actor}与${target}进行了交谈。`
  return `${actor}完成了与${target}有关的命令。`
}

export const createLocalTavernStory = (
  world: WorldState,
  locale: 'zh-CN' | 'en-US',
  focusEntityId?: string,
): WorldStory => {
  const focusEntity = focusEntityId ? world.entities.find((entity) => entity.id === focusEntityId) : undefined
  const usedEventIds = new Set(world.narrative.stories.flatMap((story) => story.eventIds))
  const relevantEvents = focusEntity
    ? world.events.filter((event) => event.actorId === focusEntity.id || event.targetId === focusEntity.id)
    : world.events
  const unusedEvents = relevantEvents.filter((event) => !usedEventIds.has(event.id))
  const recentEvents = (unusedEvents.length > 0 ? unusedEvents : relevantEvents).slice(-6)
  const livingNames = world.entities.filter((entity) => entity.health > 0).map((entity) => entity.name)
  const defeatedNames = world.entities.filter((entity) => entity.health <= 0).map((entity) => entity.name)
  const latestEvent = recentEvents.at(-1)
  const eventTitle = locale === 'zh-CN'
    ? latestEvent?.type === 'revive' ? '重燃的生命'
      : latestEvent?.type === 'defeated' ? '倒下的旗帜'
        : latestEvent?.type === 'attack' || latestEvent?.type === 'damage' ? '剑影下的传闻'
          : latestEvent?.type === 'interaction' ? '炉火边的低语'
            : latestEvent?.type === 'command-issued' ? '新的委托'
              : focusEntity ? `${focusEntity.name}的新动向`
                : recentEvents.length > 0 ? '酒馆里的最新传闻' : '平静世界的开场'
    : latestEvent?.type === 'revive' ? 'Life Rekindled'
      : latestEvent?.type === 'defeated' ? 'A Fallen Banner'
        : latestEvent?.type === 'attack' || latestEvent?.type === 'damage' ? 'Rumors beneath the Blades'
          : latestEvent?.type === 'interaction' ? 'Whispers by the Hearth'
            : latestEvent?.type === 'command-issued' ? 'A New Commission'
              : focusEntity ? `News of ${focusEntity.name}`
                : recentEvents.length > 0 ? 'The Latest Tavern Rumor' : 'A Quiet Beginning'
  const title = eventTitle
  const eventLines = recentEvents.map((event) => formatWorldEvent(event, locale))
  const focusRelationships = focusEntity
    ? Object.values(world.narrative.relationshipsByEntityId[focusEntity.id] ?? {})
      .sort((left, right) => Math.abs(right.affinity) - Math.abs(left.affinity) || right.encounters - left.encounters)
    : []
  const strongestRelationship = focusRelationships[0]
  const relationshipTarget = strongestRelationship
    ? world.entities.find((entity) => entity.id === strongestRelationship.targetEntityId)
    : undefined
  const body = locale === 'zh-CN'
    ? [
        focusEntity
          ? `${focusEntity.name}目前${focusEntity.health > 0 ? `仍然活跃，生命为 ${focusEntity.health}/${focusEntity.maxHealth}` : '已经倒下'}。`
          : livingNames.length > 0 ? `今晚，人们仍在谈论${livingNames.join('、')}。` : '今晚的酒馆格外安静。',
        focusEntity && strongestRelationship && relationshipTarget
          ? `${focusEntity.name}与${relationshipTarget.name}已经相遇 ${strongestRelationship.encounters} 次，关系倾向为 ${strongestRelationship.affinity > 0 ? '+' : ''}${strongestRelationship.affinity}。`
          : undefined,
        ...eventLines,
        defeatedNames.length > 0 ? `${defeatedNames.join('、')}的命运已经成为新的谈资。` : '没有人知道明天会发生什么。',
      ].filter(Boolean).join('\n')
    : [
        focusEntity
          ? `${focusEntity.name} is ${focusEntity.health > 0 ? `still active at ${focusEntity.health}/${focusEntity.maxHealth} health` : 'among the fallen'}.`
          : livingNames.length > 0 ? `Tonight, the tavern still speaks of ${livingNames.join(', ')}.` : 'The tavern is unusually quiet tonight.',
        focusEntity && strongestRelationship && relationshipTarget
          ? `${focusEntity.name} has met ${relationshipTarget.name} ${strongestRelationship.encounters} time(s), with an affinity of ${strongestRelationship.affinity > 0 ? '+' : ''}${strongestRelationship.affinity}.`
          : undefined,
        ...eventLines,
        defeatedNames.length > 0 ? `The fate of ${defeatedNames.join(', ')} has become a new tale.` : 'No one knows what tomorrow will bring.',
      ].filter(Boolean).join('\n')

  const eventCharacterIds = recentEvents.flatMap((event) => [event.actorId, event.targetId]).filter((id): id is string => Boolean(id))

  return {
    id: `story-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    body,
    blocks: body.split('\n').filter(Boolean).map((text) => ({ type: 'narration' as const, text })),
    createdAtSeconds: world.elapsedSeconds,
    eventIds: recentEvents.map((event) => event.id),
    characterIds: Array.from(new Set([...(focusEntity ? [focusEntity.id] : []), ...eventCharacterIds]))
      .filter((id) => world.entities.some((entity) => entity.id === id)),
    source: 'local',
  }
}

export const addWorldStory = (world: WorldState, story: WorldStory): WorldState => {
  const eventsById = new Map(world.events.map((event) => [event.id, event]))
  const inferredCharacterIds = story.eventIds.flatMap((eventId) => {
    const event = eventsById.get(eventId)
    return event ? [event.actorId, event.targetId].filter((id): id is string => Boolean(id)) : []
  })
  const enrichedStory: WorldStory = {
    ...story,
    characterIds: Array.from(new Set(story.characterIds ?? inferredCharacterIds))
      .filter((id) => world.entities.some((entity) => entity.id === id)),
  }
  return {
    ...world,
    narrative: {
      ...world.narrative,
      stories: [...world.narrative.stories, enrichedStory].slice(-maxStories),
    },
  }
}
