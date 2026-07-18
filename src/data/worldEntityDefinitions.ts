import type { WorldEntityDefinition } from '../types/world'

const standardMinifigureHeightStuds = 5

export const worldEntityDefinitions: WorldEntityDefinition[] = [
  {
    id: 'knight',
    displayName: '骑士',
    description: '装备剑盾的近战单位，会接近并攻击附近的敌对单位。',
    kind: 'actor',
    role: 'melee',
    nameCandidates: ['亚瑟', '罗兰', '莱昂', '加文', '伊文', '布兰'],
    visual: {
      kind: 'brick-assembly',
      heightStuds: standardMinifigureHeightStuds,
      widthStuds: 2,
      depthStuds: 1.5,
    },
    body: {
      shape: 'capsule',
      radiusStuds: 0.72,
      heightStuds: 4.8,
      eyeHeightStuds: 4.2,
      attackOriginHeightStuds: 3.1,
    },
    movement: {
      speedStudsPerSecond: 2.4,
      turningRadiansPerSecond: Math.PI * 1.8,
      turningRadiusStuds: 0.45,
    },
    perception: {
      detectionRangeStuds: 12,
    },
    combat: {
      maxHealth: 140,
      attackRangeStuds: 1.5,
      damage: 12,
      windupSeconds: 0.55,
      cooldownSeconds: 1.25,
    },
  },
  {
    id: 'archer',
    displayName: '弓箭手',
    description: '保持距离进行射击的远程单位，箭矢会受到视线遮挡。',
    kind: 'actor',
    role: 'ranged',
    nameCandidates: ['艾琳', '罗宾', '希尔', '芬恩', '梅芙', '凯拉'],
    visual: {
      kind: 'brick-assembly',
      heightStuds: standardMinifigureHeightStuds,
      widthStuds: 2,
      depthStuds: 1.5,
    },
    body: {
      shape: 'capsule',
      radiusStuds: 0.68,
      heightStuds: 4.8,
      eyeHeightStuds: 4.2,
      attackOriginHeightStuds: 3.8,
    },
    movement: {
      speedStudsPerSecond: 2.7,
      turningRadiansPerSecond: Math.PI * 2,
      turningRadiusStuds: 0.4,
    },
    perception: {
      detectionRangeStuds: 16,
    },
    combat: {
      maxHealth: 100,
      attackRangeStuds: 10,
      minimumRangeStuds: 4,
      damage: 9,
      windupSeconds: 0.7,
      cooldownSeconds: 1.5,
      projectileKind: 'arrow',
    },
  },
  {
    id: 'catapult',
    displayName: '投石车',
    description: '缓慢移动的攻城单位，以抛物线向远处目标投射石弹。',
    kind: 'vehicle',
    role: 'siege',
    nameCandidates: ['雷鸣号', '碎城者', '灰岩号', '远山号', '铁臂号', '风暴号'],
    visual: {
      kind: 'brick-assembly',
      heightStuds: 4,
      widthStuds: 4,
      depthStuds: 6,
    },
    body: {
      shape: 'box',
      widthStuds: 3.6,
      heightStuds: 3.8,
      depthStuds: 5.6,
      eyeHeightStuds: 3,
      attackOriginHeightStuds: 3.5,
    },
    movement: {
      speedStudsPerSecond: 1.1,
      turningRadiansPerSecond: Math.PI * 0.55,
      turningRadiusStuds: 2.4,
    },
    perception: {
      detectionRangeStuds: 24,
    },
    combat: {
      maxHealth: 280,
      attackRangeStuds: 18,
      minimumRangeStuds: 8,
      damage: 28,
      windupSeconds: 1.4,
      cooldownSeconds: 5,
      projectileKind: 'stone',
    },
  },
]

export const worldEntityDefinitionById = new Map(
  worldEntityDefinitions.map((definition) => [definition.id, definition]),
)
