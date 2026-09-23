import type { WorldScenarioStage, WorldState } from '../types/world'

export const upgradeGrayRavenScenarioStages = (
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
  if (authoringVersion < 6) upgraded = upgraded.map((stage) => stage.id.endsWith('defend')
    ? {
        ...stage,
        branches: stage.branches?.map((branch) => {
          if (branch.id !== 'gray-raven-retreat') return branch
          const storyActions = (branch.actions ?? []).filter((action) => action.type === 'add-story')
          const otherActions = (branch.actions ?? []).filter((action) => (
            action.type !== 'add-story'
            && action.type !== 'set-visibility'
            && action.type !== 'issue-command'
          ))
          return {
            ...branch,
            actions: [
              ...otherActions,
              { type: 'issue-command' as const, entityId: envoyId, command: { type: 'wander' as const } },
              ...storyActions,
              {
                type: 'set-visibility' as const,
                target: { kind: 'entity' as const, id: envoyId },
                visible: false,
                delaySeconds: 2.5,
              },
            ],
          }
        }),
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

export const upgradeGrayRavenCompanionStages = (
  stages: WorldScenarioStage[],
  title: string,
  authoringVersion: number,
) => {
  let upgraded = stages
  if (authoringVersion < 2) upgraded = upgraded.map((stage) => {
    const rolandId = stage.trigger.actorId
    const eileenId = stage.trigger.targetId
    if (!rolandId || !eileenId || stage.actions?.some((action) => action.type === 'join-party')) return stage
    return {
      ...stage,
      actions: [
        ...(stage.actions ?? []).filter((action) => action.type !== 'add-story'),
        {
          type: 'join-party' as const,
          entityId: eileenId,
          leaderId: rolandId,
          partyName: /[\u3400-\u9fff]/.test(title) ? '灰鸦调查队' : 'Gray Raven Investigators',
        },
        ...(stage.actions ?? []).filter((action) => action.type === 'add-story'),
      ],
    }
  })
  if (authoringVersion < 3) upgraded = upgraded.map((stage) => {
    const rolandId = stage.trigger.actorId
    const eileenId = stage.trigger.targetId
    if (!rolandId || !eileenId || stage.trigger.conditions) return stage
    return {
      ...stage,
      trigger: {
        ...stage.trigger,
        minimumAffinity: undefined,
        conditions: {
          mode: 'all' as const,
          conditions: [
            { type: 'affinity' as const, actorId: rolandId, targetId: eileenId, comparison: 'gte' as const, value: 45 },
            { type: 'entity-alive' as const, entityId: rolandId, alive: true },
            { type: 'entity-alive' as const, entityId: eileenId, alive: true },
          ],
        },
      },
    }
  })
  return upgraded
}

export const createGrayRavenEileenCompanionScenario = (
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
    priority: 60,
    mutexGroup: 'gray-raven-story',
    authoringVersion: 3,
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
        conditions: {
          mode: 'all',
          conditions: [
            { type: 'affinity', actorId: rolandId, targetId: eileenId, comparison: 'gte', value: 45 },
            { type: 'entity-alive', entityId: rolandId, alive: true },
            { type: 'entity-alive', entityId: eileenId, alive: true },
          ],
        },
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
        {
          type: 'join-party',
          entityId: eileenId,
          leaderId: rolandId,
          partyName: zh ? '灰鸦调查队' : 'Gray Raven Investigators',
        },
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
