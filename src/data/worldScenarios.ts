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
  const quarryEntrance = [
    makeBrick('plate-4x6', 'gray', 17, 0, 5),
    makeBrick('slope-2x2', 'gray', 17, 0.4, 5, 1),
    makeBrick('slope-2x2', 'gray', 19, 0.4, 5, 3),
    makeBrick('brick-1x1', 'black', 17, 0.4, 8),
    makeBrick('brick-1x1', 'black', 20, 0.4, 8),
    makeBrick('tile-1x2', 'black', 18, 0.4, 8, 1),
    makeBrick('round-1x1-plate', 'yellow', 20, 1.6, 8),
  ]
  const blackrockOutpostSource = generateBuildPlan({
    prompt: zh ? '一座废弃的灰色小房子' : 'an abandoned small gray house',
  })
  const blackrockOutpost = blackrockOutpostSource.bricks.map((brick) => ({
    ...brick,
    color: brick.color === 'red'
      ? 'black' as const
      : brick.color === 'tan'
        ? 'gray' as const
        : brick.color,
    pose: {
      ...brick.pose,
      xStud: brick.pose.xStud + 2,
      zStud: brick.pose.zStud + 8,
    },
  }))
  const tavernStructureId = 'scenario-border-tavern-structure'
  const courtyardStructureId = 'scenario-border-tavern-courtyard'
  const quarryEntranceStructureId = 'scenario-border-tavern-quarry-entrance'
  const blackrockOutpostStructureId = 'scenario-border-tavern-blackrock-outpost'
  const bricks = [...house.bricks, ...courtyard, ...quarryEntrance, ...blackrockOutpost]
  const plan = {
    ...house,
    id: 'scenario-border-tavern-plan',
    title: zh ? '灰鸦边境酒馆' : 'Gray Raven Frontier Tavern',
    prompt,
    bricks,
    steps: createSingleBrickSteps(bricks),
    structures: [
      {
        id: tavernStructureId,
        name: zh ? '灰鸦酒馆' : 'Gray Raven Tavern',
        description: zh ? '旅人交换消息、佣兵等待委托的边境酒馆。' : 'A frontier inn where travelers trade news and mercenaries wait for work.',
        brickIds: house.bricks.map((brick) => brick.id),
      },
      {
        id: courtyardStructureId,
        name: zh ? '酒馆马厩与庭院' : 'Tavern Stable and Yard',
        description: zh ? '酒馆东侧的马厩、长桌与路灯，是角色集结和交谈的开放区域。' : 'The stable, long table, and lantern yard east of the tavern where characters gather.',
        brickIds: courtyard.map((brick) => brick.id),
      },
      {
        id: quarryEntranceStructureId,
        name: zh ? '旧采石场密门' : 'Old Quarry Hidden Door',
        description: zh ? '被碎石伪装的地下入口；调查断箭后才会显露，通往扣押商队的旧采石场。' : 'A rubble-disguised underground entrance revealed by investigating the broken arrow.',
        brickIds: quarryEntrance.map((brick) => brick.id),
      },
      {
        id: blackrockOutpostStructureId,
        name: zh ? '黑岩废弃前哨' : 'Abandoned Blackrock Outpost',
        description: zh ? '藏在酒馆后方林线、实际仍存放补给和军用箭矢的隐蔽前哨，在使者暴露身份后出现。' : 'A concealed outpost behind the tavern tree line, still holding supplies and military arrows until the envoy is exposed.',
        brickIds: blackrockOutpost.map((brick) => brick.id),
      },
    ],
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
    hiddenTargets: [
      { kind: 'structure', id: quarryEntranceStructureId },
      { kind: 'structure', id: blackrockOutpostStructureId },
    ],
    narrative: {
      processedEventIds: [],
      memoriesByEntityId: {},
      directorTurns: [],
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
      ? '包含灰鸦酒馆、4 名具名角色、两处随剧情显现的隐藏建筑、阵营关系与开场章节。可用“显影”提前编辑隐藏要素。'
      : 'Includes the Gray Raven Tavern, four named characters, two story-revealed hidden buildings, faction relationships, and an opening chapter. Reveal mode keeps hidden elements editable.',
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
      authoringVersion: 3,
      stages: [
        {
          id: 'scenario-border-tavern-investigate',
          title: zh ? '询问北路斥候' : 'Question the Northern Scout',
          description: zh
            ? '选择罗兰，向艾琳下达“交互”命令。对话结束后，断箭指向的旧采石场密门会显现。'
            : 'Have Roland interact with Eileen. When the dialogue ends, the hidden quarry door indicated by the arrow will be revealed.',
          status: 'active',
          trigger: { eventType: 'interaction', actorId: knight.id, targetId: archer.id },
          dialogue: [
            {
              id: 'investigate-roland', speakerId: knight.id, durationSeconds: 3.8,
              text: zh ? '艾琳，把你在北路找到的东西再说一遍。' : 'Eileen, tell me again what you found on the northern road.',
            },
            {
              id: 'investigate-eileen', speakerId: archer.id, durationSeconds: 5.2,
              text: zh ? '断箭上有黑岩纹章，还有旧采石场独有的灰白石粉。那个使者的靴边也沾着同样的粉末。' : 'The broken arrow bears the Blackrock crest and pale dust unique to the old quarry. The envoy has the same dust on his boots.',
            },
            {
              id: 'investigate-roland-answer', speakerId: knight.id, durationSeconds: 3.8,
              text: zh ? '明白了。我去问问他，失踪的商队究竟去了哪里。' : 'Understood. I will ask him where the missing caravan really went.',
            },
          ],
          actions: [
            {
              type: 'add-story',
              title: zh ? '第 2 章 · 断箭上的新伤' : 'Chapter 2 · Fresh Marks on the Broken Arrow',
              body: zh
                ? '艾琳摊开断箭：黑岩纹章旁还有新鲜的灰白石粉，只可能来自酒馆东侧的旧采石场。循着石粉，众人在乱石间找到了伪装的密门。'
                : 'Eileen lays out the broken arrow. Fresh pale dust clings beside the Blackrock crest. Following it, the group finds a disguised door among the quarry rubble.',
              characterIds: [knight.id, archer.id, stranger.id],
            },
            { type: 'set-visibility', target: { kind: 'structure', id: quarryEntranceStructureId }, visible: true },
          ],
        },
        {
          id: 'scenario-border-tavern-confront',
          title: zh ? '对质黑岩使者' : 'Confront the Blackrock Envoy',
          description: zh
            ? '让罗兰与黑岩使者交互。完整对话后使者才会转为敌对，同时暴露远处伪装成废墟的黑岩前哨。'
            : 'Have Roland interact with the envoy. Only after the full dialogue does he turn hostile and expose the disguised Blackrock outpost.',
          status: 'locked',
          trigger: { eventType: 'interaction', actorId: knight.id, targetId: stranger.id },
          dialogue: [
            {
              id: 'confront-roland', speakerId: knight.id, durationSeconds: 5,
              text: zh ? '北路商队在哪里？你靴上的石粉来自旧采石场。' : 'Where is the northern caravan? The dust on your boots came from the old quarry.',
            },
            {
              id: 'confront-envoy-denial', speakerId: stranger.id, durationSeconds: 4.5,
              text: zh ? '一支断箭和一点尘土，也敢当作证据？' : 'A broken arrow and a little dust—you call that evidence?',
            },
            {
              id: 'confront-eileen', speakerId: archer.id, durationSeconds: 5.2,
              text: zh ? '箭尾的切口是黑岩军用制式。你骗不了我们。' : 'The cut on the shaft is Blackrock military issue. You cannot deceive us.',
            },
            {
              id: 'confront-envoy-threat', speakerId: stranger.id, durationSeconds: 5,
              text: zh ? '既然你们已经知道，那就都别想活着离开。' : 'Since you already know, none of you will leave here alive.',
            },
          ],
          actions: [
            {
              type: 'add-story',
              title: zh ? '第 3 章 · 酒杯落地' : 'Chapter 3 · The Fallen Cup',
              body: zh
                ? '罗兰刚说出“采石场”，黑岩使者便将酒杯摔碎，拔剑承认商队被扣作诱饵。酒馆后方林线里，伪装成废墟的前哨亮起暗红信号，玛拉推上门闩——灰鸦酒馆必须撑到巡逻队抵达。'
                : 'At the word “quarry,” the envoy shatters his cup and draws steel. Behind the tavern tree line, a dark red signal lights in an outpost disguised as a ruin, and Mara bars the door.',
              characterIds: [innkeeper.id, knight.id, archer.id, stranger.id],
            },
            { type: 'set-visibility', target: { kind: 'structure', id: blackrockOutpostStructureId }, visible: true },
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
          branches: [{
            id: 'gray-raven-retreat',
            title: zh ? '罗兰倒下 · 停战撤退' : 'Roland Falls · Retreat',
            trigger: { eventType: 'defeated', targetId: knight.id },
            actions: [
              { type: 'set-faction', entityId: stranger.id, factionId: 'neutral' },
              { type: 'issue-command', entityId: stranger.id, command: { type: 'stop' } },
              {
                type: 'add-story',
                title: zh ? '败局 · 灰鸦暂熄' : 'Defeat · The Gray Raven Dims',
                body: zh
                  ? '罗兰倒下后，玛拉举起白布换来短暂停战。黑岩使者带伤撤退，酒馆保住了性命，却失去了追查商队的最佳时机。'
                  : 'When Roland falls, Mara raises a white cloth and wins a brief truce. The wounded envoy retreats; the tavern survives, but the best chance to find the caravan is lost.',
                characterIds: [knight.id, archer.id, stranger.id],
              },
            ],
          }],
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
