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
    controller: 'player',
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
    factionId: 'neutral',
    transform: { x: 19, z: -3, rotationRadians: Math.PI },
  })
  innkeeper.commandQueue = [{ type: 'wander', seed: 31 }]
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
    scenario: {
      id: 'scenario-border-tavern-runtime',
      assetId: 'scenario-border-tavern',
      title: zh ? '没有归来的商队' : 'The Caravan That Never Returned',
      description: zh
        ? '由罗兰调查北路的断箭线索，揭开黑岩使者的真实目的，并守住灰鸦酒馆。'
        : 'Guide Roland through the broken-arrow clue, expose the Blackrock Envoy, and defend the Gray Raven Tavern.',
      processedEventIds: [],
      stages: [
        {
          id: 'scenario-border-tavern-investigate',
          title: zh ? '询问北路斥候' : 'Question the Northern Scout',
          description: zh
            ? '选择罗兰，将控制器设为“玩家”（已预设），向艾琳下达“交互”命令。'
            : 'Select Roland and issue an Interact order targeting Eileen. His controller is already set to Player.',
          status: 'active',
          trigger: { eventType: 'interaction', actorId: knight.id, targetId: archer.id },
          actions: [{
            type: 'add-story',
            title: zh ? '第 2 章 · 断箭上的新伤' : 'Chapter 2 · Fresh Marks on the Broken Arrow',
            body: zh
              ? '艾琳摊开断箭：黑岩纹章旁还有新鲜的灰白石粉，只可能来自酒馆东侧的旧采石场。她压低声音说，那个陌生人的靴边也沾着同样的粉末。'
              : 'Eileen lays out the broken arrow. Fresh pale dust clings beside the Blackrock crest—the same stone found only in the old quarry east of the tavern. The stranger has that dust on his boots.',
            characterIds: [knight.id, archer.id, stranger.id],
          }],
        },
        {
          id: 'scenario-border-tavern-confront',
          title: zh ? '对质黑岩使者' : 'Confront the Blackrock Envoy',
          description: zh
            ? '让罗兰向黑岩使者下达“交互”命令，逼他解释采石场与失踪商队的关系。'
            : 'Have Roland Interact with the Blackrock Envoy and demand an explanation for the quarry and the missing caravan.',
          status: 'locked',
          trigger: { eventType: 'interaction', actorId: knight.id, targetId: stranger.id },
          actions: [
            {
              type: 'add-story',
              title: zh ? '第 3 章 · 酒杯落地' : 'Chapter 3 · The Fallen Cup',
              body: zh
                ? '罗兰刚说出“采石场”，黑岩使者便将酒杯摔碎，拔剑承认商队被扣作诱饵。玛拉推上门闩，艾琳占住窗边——灰鸦酒馆必须撑到巡逻队抵达。'
                : 'At the word “quarry,” the envoy shatters his cup and draws steel, admitting the caravan was taken as bait. Mara bars the door and Eileen takes the window—the tavern must hold until the patrol arrives.',
              characterIds: [innkeeper.id, knight.id, archer.id, stranger.id],
            },
            { type: 'set-faction', entityId: stranger.id, factionId: 'red' },
            { type: 'issue-command', entityId: stranger.id, command: { type: 'attack', target: { kind: 'entity', id: knight.id } } },
          ],
        },
        {
          id: 'scenario-border-tavern-defend',
          title: zh ? '守住灰鸦酒馆' : 'Defend the Gray Raven Tavern',
          description: zh
            ? '击败黑岩使者。罗兰可直接攻击，艾琳和玛拉会按各自职责支援。'
            : 'Defeat the Blackrock Envoy. Roland can attack directly while Eileen and Mara support according to their roles.',
          status: 'locked',
          trigger: { eventType: 'defeated', targetId: stranger.id },
          actions: [{
            type: 'add-story',
            title: zh ? '第 4 章 · 黎明前的灰鸦' : 'Chapter 4 · The Gray Raven Before Dawn',
            body: zh
              ? '黑岩使者倒下后，远处终于响起巡逻队的号角。商队仍有生还者，而酒馆保存下来的断箭、石粉和口供，将指向更深处的黑岩堡垒。'
              : 'As the envoy falls, the patrol horn finally sounds in the distance. Some caravan members still live, and the arrow, quarry dust, and confession now point toward the deeper Blackrock stronghold.',
            characterIds: [innkeeper.id, knight.id, archer.id, stranger.id],
          }],
        },
      ],
    },
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
