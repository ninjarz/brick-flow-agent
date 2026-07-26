import { addWorldStory } from './worldNarrative'
import type { WorldEntity, WorldState, WorldStory, WorldStoryBlock } from '../types/world'

export type TavernActivityKind = 'toast' | 'dice' | 'rumor'

export type TavernActivityResult = {
  world: WorldState
  title: string
  body: string
  participantIds: string[]
  storyId: string
  source: 'local' | 'ai'
  notice?: string
}

const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const getAvailableCharacters = (world: WorldState) => {
  const hiddenIds = new Set(
    world.hiddenTargets.filter((target) => target.kind === 'entity').map((target) => target.id),
  )
  return world.entities.filter((entity) => entity.health > 0 && !hiddenIds.has(entity.id))
}

const pickCharacter = (characters: WorldEntity[], random: () => number) => (
  characters[Math.min(characters.length - 1, Math.floor(random() * characters.length))]
)

const getParticipants = (world: WorldState, focusEntityId: string | undefined, random: () => number) => {
  const available = getAvailableCharacters(world)
  const focus = available.find((entity) => entity.id === focusEntityId) ?? pickCharacter(available, random)
  if (!focus) return []
  const companions = available.filter((entity) => entity.id !== focus.id)
  const sameStoryline = companions.filter((entity) => entity.storylineId === focus.storylineId)
  const companion = pickCharacter(sameStoryline.length > 0 ? sameStoryline : companions, random)
  return companion ? [focus, companion] : [focus]
}

const addSpeech = (entity: WorldEntity, text: string, expiresAtSeconds: number): WorldEntity => ({
  ...entity,
  activeCommand: undefined,
  commandQueue: [],
  behaviorState: 'idle',
  navigation: { status: 'idle', path: [], pathIndex: 0 },
  speech: { message: 'scenario-dialogue', text, expiresAtSeconds },
  combat: { ...entity.combat, attackTargetId: undefined },
  autonomy: {
    ...entity.autonomy,
    nextDecisionAtSeconds: Math.max(entity.autonomy.nextDecisionAtSeconds, expiresAtSeconds),
  },
})

const makeStory = (
  world: WorldState,
  title: string,
  body: string,
  characterIds: string[],
  blocks: WorldStoryBlock[],
): WorldStory => ({
  id: makeId('story-tavern'),
  title,
  body,
  blocks,
  createdAtSeconds: world.elapsedSeconds,
  eventIds: [],
  characterIds,
  source: 'local',
})

export const playTavernActivity = (
  world: WorldState,
  activity: TavernActivityKind,
  locale: string,
  focusEntityId?: string,
  random: () => number = Math.random,
): TavernActivityResult | undefined => {
  const zh = locale === 'zh-CN'
  const participants = getParticipants(world, focusEntityId, random)
  const host = participants[0]
  const guest = participants[1]
  if (!host) return undefined

  const characterIds = participants.map((entity) => entity.id)
  const expiresAtSeconds = world.elapsedSeconds + 7
  let title = ''
  let body = ''
  const speechById = new Map<string, string>()

  if (activity === 'toast') {
    title = zh ? '炉火边的一杯' : 'A Drink by the Hearth'
    body = guest
      ? zh
        ? `${host.name}举起杯子邀请${guest.name}碰杯。没有任务，也没有刀剑，只有短暂而难得的轻松。`
        : `${host.name} raises a mug to ${guest.name}. No quests or blades—just a rare, easy moment.`
      : zh ? `${host.name}独自举杯，敬还没有写完的故事。` : `${host.name} raises a solitary mug to stories not yet written.`
    speechById.set(host.id, zh ? '这一杯，敬下一次平安归来！' : 'To returning safely next time!')
    if (guest) speechById.set(guest.id, zh ? '好——今晚先不谈麻烦。' : 'Agreed—no trouble tonight.')
  } else if (activity === 'dice') {
    const hostRoll = 1 + Math.floor(random() * 20)
    const guestRoll = guest ? 1 + Math.floor(random() * 20) : undefined
    title = zh ? '酒馆骰局' : 'Tavern Dice'
    if (!guest) {
      body = zh ? `${host.name}掷出了 ${hostRoll} 点。围观的人煞有介事地点了点头。` : `${host.name} rolls ${hostRoll}. The onlookers nod as if it means something profound.`
    } else if (hostRoll === guestRoll) {
      body = zh ? `${host.name}和${guest.name}都掷出了 ${hostRoll} 点。两人决定把胜负留到下一杯。` : `${host.name} and ${guest.name} both roll ${hostRoll}. The rematch can wait for another drink.`
    } else {
      const winner = hostRoll > guestRoll ? host : guest
      body = zh ? `${host.name}掷出 ${hostRoll} 点，${guest.name}掷出 ${guestRoll} 点。${winner.name}赢得了今晚的骰局。` : `${host.name} rolls ${hostRoll}; ${guest.name} rolls ${guestRoll}. ${winner.name} wins tonight's game.`
    }
    speechById.set(host.id, zh ? `我掷出了 ${hostRoll} 点！` : `I rolled ${hostRoll}!`)
    if (guest && guestRoll !== undefined) speechById.set(guest.id, zh ? `${guestRoll} 点，看来酒钱有着落了。` : `${guestRoll}. Drinks might be covered after all.`)
  } else {
    const activeStage = world.scenarios.flatMap((scenario) => scenario.stages).find((stage) => stage.status === 'active')
    const rumor = activeStage
      ? zh ? `有人说，“${activeStage.title}”并不像表面那么简单。` : `Someone says “${activeStage.title}” is not as simple as it looks.`
      : zh ? '有人在旧路边看见了陌生的灯火，但天亮后没有留下脚印。' : 'Someone saw strange lights by the old road, yet dawn revealed no footprints.'
    title = zh ? '今晚的新传闻' : "Tonight's Rumor"
    body = guest
      ? zh ? `${guest.name}压低声音，把刚听来的消息告诉${host.name}：${rumor}` : `${guest.name} lowers their voice and tells ${host.name}: ${rumor}`
      : zh ? `${host.name}从邻桌听到一则消息：${rumor}` : `${host.name} overhears a rumor at the next table: ${rumor}`
    speechById.set(host.id, zh ? '还有什么新消息？' : 'Any fresh news?')
    if (guest) speechById.set(guest.id, rumor)
  }

  const withSpeech: WorldState = {
    ...world,
    entities: world.entities.map((entity) => {
      const speech = speechById.get(entity.id)
      return speech ? addSpeech(entity, speech, expiresAtSeconds) : entity
    }),
  }
  const story = makeStory(withSpeech, title, body, characterIds, [
    { type: 'narration', text: body },
    ...Array.from(speechById, ([speakerId, text]) => ({ type: 'dialogue' as const, speakerId, text })),
  ])
  return {
    world: addWorldStory(withSpeech, story),
    title,
    body,
    participantIds: characterIds,
    storyId: story.id,
    source: 'local',
  }
}
