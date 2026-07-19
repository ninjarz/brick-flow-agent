import { generateBuildPlan } from '../lib/localGenerator'
import { createSingleBrickSteps, makeBrick } from '../lib/planUtils'
import { createEmptyWorldState, createWorldEntity } from '../lib/worldEntity'
import type { Locale } from '../lib/i18n'
import type { WorldRelationship, WorldState } from '../types/world'
import type { WorldScenarioAsset } from '../types/worldScenario'
import { worldEntityDefinitionById } from './worldEntityDefinitions'

const relationship = (targetEntityId: string, affinity: number): WorldRelationship => ({
  targetEntityId,
  affinity,
  encounters: 1,
  lastEventType: 'interaction',
  updatedAtSeconds: 0,
})

const createBorderTavernScenario = (locale: Locale): WorldScenarioAsset => {
  const zh = locale === 'zh-CN'
  const prompt = zh ? '一座有角色和开场剧情的边境酒馆' : 'a frontier tavern with characters and an opening story'
  const house = generateBuildPlan({ prompt: zh ? '一个小房子' : 'a small house' })
  const courtyard = [
    makeBrick('plate-4x6', 'green', 8, 0, 0),
    makeBrick('brick-1x1', 'brown', 9, 0.4, 1),
    makeBrick('brick-1x1', 'brown', 12, 0.4, 1),
    makeBrick('plate-2x4', 'tan', 9, 1.6, 1),
    makeBrick('brick-1x4', 'brown', 9, 0.4, 3),
    makeBrick('tile-1x2', 'tan', 9, 1.6, 3, 1),
    makeBrick('tile-1x2', 'tan', 11, 1.6, 3, 1),
    makeBrick('brick-1x1', 'brown', 13, 0.4, 0),
    makeBrick('round-1x1-plate', 'yellow', 13, 1.6, 0),
  ]
  const bricks = [...house.bricks, ...courtyard]
  const plan = {
    ...house,
    id: 'scenario-border-tavern-plan',
    title: zh ? '灰鸦边境酒馆' : 'Gray Raven Frontier Tavern',
    prompt,
    bricks,
    steps: createSingleBrickSteps(bricks),
    structures: [{
      id: 'scenario-border-tavern-structure',
      name: zh ? '灰鸦酒馆' : 'Gray Raven Tavern',
      description: zh ? '旅人交换消息、佣兵等待委托的边境酒馆。' : 'A frontier inn where travelers trade news and mercenaries wait for work.',
      brickIds: bricks.map((brick) => brick.id),
    }],
  }

  const innkeeper = createWorldEntityDefinition('priest', {
    id: 'scenario-innkeeper',
    name: zh ? '玛拉' : 'Mara',
    description: zh ? '灰鸦酒馆的老板兼治疗者，知道每一条经过边境的传闻。' : 'The tavern keeper and healer who hears every rumor crossing the frontier.',
    factionId: 'blue',
    transform: { x: 2, z: -3, rotationRadians: 0 },
  })
  const knight = createWorldEntityDefinition('knight', {
    id: 'scenario-guard',
    name: zh ? '罗兰' : 'Roland',
    description: zh ? '受雇守护酒馆的骑士，正在调查失踪的商队。' : 'A hired knight investigating a missing caravan.',
    factionId: 'blue',
    transform: { x: 6, z: -3, rotationRadians: 0 },
  })
  const archer = createWorldEntityDefinition('archer', {
    id: 'scenario-scout',
    name: zh ? '艾琳' : 'Eileen',
    description: zh ? '刚从北方山路归来的斥候，带回了不祥的线索。' : 'A scout newly returned from the northern road with an ominous clue.',
    factionId: 'blue',
    transform: { x: 10, z: -3, rotationRadians: 0 },
  })
  const stranger = createWorldEntityDefinition('knight', {
    id: 'scenario-stranger',
    name: zh ? '黑岩使者' : 'Blackrock Envoy',
    description: zh ? '在酒馆外徘徊的陌生武士，似乎不希望调查继续。' : 'A stranger lingering beyond the tavern who seems eager to end the investigation.',
    factionId: 'red',
    transform: { x: 19, z: -3, rotationRadians: Math.PI },
  })
  innkeeper.commandQueue = [{ type: 'wander', seed: 31 }]
  knight.commandQueue = [{ type: 'guard', target: { kind: 'structure', id: plan.structures[0].id } }]
  archer.commandQueue = [{ type: 'follow', target: { kind: 'entity', id: knight.id } }]
  stranger.commandQueue = [{ type: 'wander', seed: 73 }]

  const world: WorldState = {
    ...createEmptyWorldState(plan.id),
    paused: true,
    randomSeed: 42731,
    entities: [innkeeper, knight, archer, stranger],
    narrative: {
      processedEventIds: [],
      memoriesByEntityId: {},
      relationshipsByEntityId: {
        [innkeeper.id]: {
          [knight.id]: relationship(knight.id, 28),
          [archer.id]: relationship(archer.id, 22),
        },
        [knight.id]: {
          [innkeeper.id]: relationship(innkeeper.id, 28),
          [archer.id]: relationship(archer.id, 35),
          [stranger.id]: relationship(stranger.id, -45),
        },
        [archer.id]: {
          [knight.id]: relationship(knight.id, 35),
          [stranger.id]: relationship(stranger.id, -30),
        },
        [stranger.id]: {
          [knight.id]: relationship(knight.id, -45),
          [archer.id]: relationship(archer.id, -30),
        },
      },
      stories: [{
        id: 'scenario-border-tavern-opening',
        title: zh ? '第 1 章 · 没有归来的商队' : 'Chapter 1 · The Caravan That Never Returned',
        body: zh
          ? '北方商队已经迟到三天。艾琳带回一枚刻着黑岩纹章的断箭，罗兰决定天亮后沿旧路追查。玛拉却注意到，酒馆外那位陌生人从听见“断箭”二字起，就再也没有碰过杯中的酒。'
          : 'The northern caravan is three days late. Eileen returned with a broken arrow bearing the Blackrock crest, and Roland plans to search the old road at dawn. Mara noticed that the stranger outside has not touched his drink since hearing the words “broken arrow.”',
        createdAtSeconds: 0,
        eventIds: [],
        characterIds: [innkeeper.id, knight.id, archer.id, stranger.id],
        chapterNumber: 1,
        source: 'local',
      }],
    },
  }

  return {
    id: 'scenario-border-tavern',
    title: plan.title,
    category: zh ? '剧情场景' : 'Story Scene',
    description: zh
      ? '包含灰鸦酒馆、4 名具名角色、阵营关系、初始命令与开场章节。载入后可在世界酒馆继续生成真实事件驱动的故事。'
      : 'Includes the Gray Raven Tavern, four named characters, faction relationships, initial orders, and an opening chapter. Continue its event-driven story in the World Tavern.',
    plan,
    world,
  }
}

function createWorldEntityDefinition(
  definitionId: string,
  options: Parameters<typeof createWorldEntity>[1],
) {
  const definition = worldEntityDefinitionById.get(definitionId)
  if (!definition) throw new Error(`Missing world entity definition: ${definitionId}`)
  return createWorldEntity(definition, options)
}

export const createDefaultWorldScenarios = (locale: Locale): WorldScenarioAsset[] => [
  createBorderTavernScenario(locale),
]
