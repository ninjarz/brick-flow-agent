import { brickById, getDefaultBrickColor } from './basicBricks'
import { synchronizeVoxelBlockStates } from '../lib/voxelBlockState'
import type { BuildPlan, BuildStep, FinishedAsset, PlacedBrick } from '../types/bricks'

type SceneBuilder = {
  brick: (brickId: string, x: number, y: number, z: number, rotation?: 0 | 1 | 2 | 3, phase?: string) => void
  finish: (id: string, title: string, prompt: string) => BuildPlan
}

const createSceneBuilder = (): SceneBuilder => {
  const bricks: PlacedBrick[] = []
  const brickIdsByPhase = new Map<string, string[]>()

  return {
    brick: (brickId, x, y, z, rotation = 0, phase = '细节') => {
      const definition = brickById.get(brickId)
      if (!definition) throw new Error(`Unknown Minecraft block: ${brickId}`)
      const id = `piece-${bricks.length + 1}`
      bricks.push({
        id,
        brickId,
        color: getDefaultBrickColor(definition),
        pose: { xStud: x, yStud: y, zStud: z, rotationQuarterTurns: rotation },
      })
      brickIdsByPhase.set(phase, [...(brickIdsByPhase.get(phase) ?? []), id])
    },
    finish: (id, title, prompt) => {
      const steps: BuildStep[] = [...brickIdsByPhase].map(([phase, brickIds], index) => ({
        id: `step-${index + 1}`,
        title: phase,
        description: `搭建${phase}`,
        brickIds,
      }))
      return {
        id,
        title,
        prompt,
        source: 'template-local',
        bricks: synchronizeVoxelBlockStates(bricks),
        steps,
        structures: [{
          id: `structure-${id}`,
          name: title,
          description: '可整体选择，也可以解除固化后继续拆改。',
          brickIds: bricks.map((brick) => brick.id),
        }],
      }
    },
  }
}

const makeValleyWaystation = () => {
  const scene = createSceneBuilder()
  for (let x = 0; x < 8; x += 1) {
    for (let z = 0; z < 6; z += 1) {
      const path = z === 2 && (x === 0 || x >= 5)
      scene.brick(path ? 'minecraft-cobblestone' : 'minecraft-grass-block', x, 0, z, 0, '地形与道路')
    }
  }
  for (const [x, z] of [[1, 1], [4, 1], [1, 4], [4, 4]] as const) {
    scene.brick('minecraft-oak-log', x, 1, z, 0, '驿站墙体')
    scene.brick('minecraft-oak-log', x, 2, z, 0, '驿站墙体')
  }
  for (let x = 2; x <= 3; x += 1) {
    scene.brick('minecraft-oak-planks', x, 1, 4, 0, '驿站墙体')
    scene.brick('minecraft-glass-block', x, 2, 4, 0, '驿站墙体')
    scene.brick('minecraft-oak-planks', x, 2, 1, 0, '驿站墙体')
  }
  for (let z = 2; z <= 3; z += 1) {
    scene.brick('minecraft-oak-planks', 1, 1, z, 0, '驿站墙体')
    scene.brick('minecraft-oak-planks', 4, 1, z, 0, '驿站墙体')
    scene.brick('minecraft-glass-block', 1, 2, z, 0, '驿站墙体')
    scene.brick('minecraft-oak-planks', 4, 2, z, 0, '驿站墙体')
  }
  scene.brick('minecraft-crafting-table', 2, 1, 3, 0, '室内设施')
  scene.brick('minecraft-furnace', 3, 1, 3, 0, '室内设施')
  scene.brick('minecraft-bookshelf', 3, 1, 2, 0, '室内设施')
  for (let z = 1; z <= 4; z += 1) {
    scene.brick('minecraft-oak-stairs', 1, 3, z, 1, '屋顶')
    scene.brick('minecraft-oak-stairs', 4, 3, z, 3, '屋顶')
  }
  for (let x = 2; x <= 3; x += 1) {
    scene.brick('minecraft-oak-slab', x, 3, 1, 0, '屋顶')
    scene.brick('minecraft-oak-slab', x, 3, 4, 0, '屋顶')
  }
  for (const [x, z] of [[6, 1], [7, 1], [7, 3], [6, 3]] as const) {
    scene.brick('minecraft-oak-fence', x, 1, z, 0, '路边花圃')
  }
  scene.brick('minecraft-red-flower', 6, 1, 2, 0, '路边花圃')
  scene.brick('minecraft-yellow-flower', 7, 1, 2, 0, '路边花圃')
  scene.brick('minecraft-glow-lamp', 0, 1, 2, 0, '照明')
  scene.brick('minecraft-oak-fence', 0, 2, 2, 0, '照明')
  return scene.finish('minecraft-valley-waystation-plan', '溪谷驿站', '一座可拆改的 Minecraft 风格溪谷驿站')
}

const makeOreCutaway = () => {
  const scene = createSceneBuilder()
  for (let x = 0; x < 8; x += 1) {
    for (let z = 0; z < 6; z += 1) {
      const edge = x === 0 || z === 0
      scene.brick(edge ? 'minecraft-stone-block' : 'minecraft-deepslate', x, 0, z, 0, '岩层基座')
    }
  }
  const ores = [
    'minecraft-coal-ore',
    'minecraft-iron-ore',
    'minecraft-copper-ore',
    'minecraft-gold-ore',
    'minecraft-redstone-ore',
    'minecraft-lapis-ore',
    'minecraft-diamond-ore',
  ]
  for (let x = 0; x < 7; x += 1) {
    for (let z = 0; z < 4; z += 1) {
      const ore = (x + z * 2) % 5 === 0 ? ores[(x + z) % ores.length] : 'minecraft-stone-block'
      scene.brick(ore, x, 1, z, 0, '可见矿脉')
    }
  }
  for (let x = 0; x < 5; x += 1) {
    for (let z = 0; z < 3; z += 1) {
      const ore = (x * 3 + z) % 7 === 0 ? ores[(x * 2 + z) % ores.length] : 'minecraft-cobblestone'
      scene.brick(ore, x, 2, z, 0, '上层断面')
    }
  }
  for (let x = 1; x < 4; x += 1) scene.brick('minecraft-stone-slab', x, 3, 1, 0, '勘探台阶')
  scene.brick('minecraft-stone-stairs', 7, 1, 3, 3, '勘探台阶')
  for (let x = 5; x < 8; x += 1) {
    for (let z = 4; z < 6; z += 1) scene.brick('minecraft-water-block', x, 1, z, 0, '地下水洼')
  }
  scene.brick('minecraft-glow-lamp', 6, 2, 1, 0, '勘探照明')
  scene.brick('minecraft-redstone-block', 7, 1, 1, 0, '勘探照明')
  return scene.finish('minecraft-ore-cutaway-plan', '矿脉剖面', '一处展示多层岩石与矿物分布的体素剖面')
}

const makeForestCamp = () => {
  const scene = createSceneBuilder()
  for (let x = 0; x < 9; x += 1) {
    for (let z = 0; z < 7; z += 1) {
      scene.brick((x + z) % 7 === 0 ? 'minecraft-moss-block' : 'minecraft-grass-block', x, 0, z, 0, '林地')
    }
  }
  for (const [treeX, treeZ, logId, leavesId] of [
    [1, 1, 'minecraft-oak-log', 'minecraft-oak-leaves'],
    [7, 5, 'minecraft-birch-log', 'minecraft-birch-leaves'],
  ] as const) {
    scene.brick(logId, treeX, 1, treeZ, 0, '树木')
    scene.brick(logId, treeX, 2, treeZ, 0, '树木')
    for (let x = treeX - 1; x <= treeX + 1; x += 1) {
      for (let z = treeZ - 1; z <= treeZ + 1; z += 1) {
        if (x >= 0 && z >= 0 && x < 9 && z < 7) scene.brick(leavesId, x, 3, z, 0, '树木')
      }
    }
    scene.brick(leavesId, treeX, 4, treeZ, 0, '树木')
  }
  for (const [x, z] of [[4, 2], [4, 4], [3, 3], [5, 3]] as const) {
    scene.brick('minecraft-cobblestone', x, 1, z, 0, '营火区')
  }
  scene.brick('minecraft-redstone-block', 4, 1, 3, 0, '营火区')
  scene.brick('minecraft-glow-lamp', 4, 2, 3, 0, '营火区')
  for (let z = 2; z <= 4; z += 1) {
    scene.brick('minecraft-spruce-planks', 6, 1, z, 0, '帐篷')
    scene.brick('minecraft-oak-stairs', 7, 1, z, 3, '帐篷')
  }
  scene.brick('minecraft-bookshelf', 2, 1, 5, 0, '营地物资')
  scene.brick('minecraft-crafting-table', 3, 1, 5, 0, '营地物资')
  scene.brick('minecraft-yellow-flower', 0, 1, 5, 0, '林地细节')
  scene.brick('minecraft-red-flower', 1, 1, 5, 0, '林地细节')
  scene.brick('minecraft-tall-grass', 2, 1, 1, 0, '林地细节')
  return scene.finish('minecraft-forest-camp-plan', '林间营地', '一个带树木、营火、帐篷与物资点的体素营地')
}

const makeSeasideLighthouse = () => {
  const scene = createSceneBuilder()
  for (let x = 0; x < 8; x += 1) {
    for (let z = 0; z < 8; z += 1) {
      const isWater = x === 0 || z === 0 || x === 7 || z === 7
      if (isWater) {
        scene.brick('minecraft-water-block', x, 0, z, 0, '岛岸与水面')
        continue
      }
      const isSand = x === 1 || z === 1 || x === 6 || z === 6
      scene.brick(isSand ? 'minecraft-sand-block' : 'minecraft-stone-block', x, 0, z, 0, '岛岸与水面')
    }
  }
  for (const z of [0, 1] as const) {
    scene.brick('minecraft-oak-planks', 3, 1, z, 0, '码头')
    scene.brick('minecraft-oak-planks', 4, 1, z, 0, '码头')
  }
  scene.brick('minecraft-oak-fence', 3, 2, 0, 0, '码头')
  scene.brick('minecraft-oak-fence', 4, 2, 0, 0, '码头')
  const bands: Array<[number, string]> = [
    [1, 'minecraft-white-concrete'],
    [2, 'minecraft-white-concrete'],
    [3, 'minecraft-red-concrete'],
    [4, 'minecraft-red-concrete'],
    [5, 'minecraft-white-concrete'],
  ]
  for (const [y, blockId] of bands) {
    for (const x of [3, 4] as const) {
      for (const z of [3, 4] as const) {
        scene.brick(blockId, x, y, z, 0, '灯塔塔身')
      }
    }
  }
  for (const x of [3, 4] as const) {
    for (const z of [3, 4] as const) {
      scene.brick('minecraft-glow-lamp', x, 6, z, 0, '灯室与细节')
    }
  }
  scene.brick('minecraft-redstone-block', 3, 7, 3, 0, '灯室与细节')
  scene.brick('minecraft-tall-grass', 2, 1, 5, 0, '灯室与细节')
  scene.brick('minecraft-yellow-flower', 5, 1, 2, 0, '灯室与细节')
  return scene.finish('minecraft-seaside-lighthouse-plan', '滨海灯塔', '一座带环形水面、木板码头与发光灯室的体素灯塔')
}

const makeVillageSquare = () => {
  const scene = createSceneBuilder()
  for (let x = 0; x < 9; x += 1) {
    for (let z = 0; z < 7; z += 1) {
      const square = z === 3 || (x >= 5 && z >= 1 && z <= 5)
      const groundId = x === 0 && z === 5
        ? 'minecraft-mud-block'
        : x === 0 && z === 6
          ? 'minecraft-sand-block'
          : square
            ? 'minecraft-gravel-block'
            : 'minecraft-grass-block'
      scene.brick(groundId, x, 0, z, 0, '广场地基')
    }
  }

  for (let y = 1; y <= 2; y += 1) {
    for (let x = 1; x <= 4; x += 1) {
      if (!(x === 2 || (x === 3 && y === 1))) scene.brick('minecraft-oak-planks', x, y, 1, 0, '村舍墙体')
      scene.brick('minecraft-oak-planks', x, y, 5, 0, '村舍墙体')
    }
    for (let z = 2; z <= 4; z += 1) {
      if (!(z === 3 && y === 1)) scene.brick('minecraft-oak-log', 1, y, z, 0, '村舍墙体')
      scene.brick('minecraft-oak-log', 4, y, z, 0, '村舍墙体')
    }
  }
  scene.brick('minecraft-oak-door', 2, 1, 1, 0, '门窗与室内')
  scene.brick('minecraft-glass-pane', 3, 1, 1, 0, '门窗与室内')
  scene.brick('minecraft-glass-pane', 1, 1, 3, 1, '门窗与室内')
  scene.brick('minecraft-chest', 3, 1, 4, 0, '门窗与室内')
  scene.brick('minecraft-crafting-table', 2, 1, 4, 0, '门窗与室内')
  for (let z = 1; z <= 5; z += 1) {
    scene.brick('minecraft-oak-stairs', 1, 3, z, 1, '村舍屋顶')
    scene.brick('minecraft-oak-stairs', 4, 3, z, 3, '村舍屋顶')
  }
  for (let z = 1; z <= 5; z += 1) {
    scene.brick('minecraft-oak-slab', 2, 3, z, 0, '村舍屋顶')
    scene.brick('minecraft-oak-slab', 3, 3, z, 0, '村舍屋顶')
  }

  for (const [x, z] of [[6, 1], [8, 1], [6, 5], [8, 5]] as const) {
    scene.brick('minecraft-oak-fence', x, 1, z, 0, '市集与照明')
    scene.brick('minecraft-lantern', x, 2, z, 0, '市集与照明')
  }
  scene.brick('minecraft-hay-bale', 6, 1, 2, 0, '市集与照明')
  scene.brick('minecraft-hay-bale', 7, 1, 2, 0, '市集与照明')
  scene.brick('minecraft-hay-bale', 6, 2, 2, 1, '市集与照明')
  scene.brick('minecraft-chest', 8, 1, 4, 0, '市集与照明')
  for (let z = 2; z <= 3; z += 1) scene.brick('minecraft-iron-bars', 8, 1, z, 0, '市集与照明')

  scene.brick('minecraft-cactus', 0, 1, 6, 0, '自然细节')
  scene.brick('minecraft-blue-flower', 5, 1, 6, 0, '自然细节')
  scene.brick('minecraft-red-flower', 6, 1, 6, 0, '自然细节')
  scene.brick('minecraft-yellow-flower', 7, 1, 6, 0, '自然细节')
  return scene.finish('minecraft-village-square-plan', '村庄广场', '一座带村舍、市集、路灯与花圃的体素村庄广场')
}

export const minecraftSceneAssets: FinishedAsset[] = [
  {
    id: 'finished-minecraft-waystation',
    i18nKey: 'asset.default.minecraftWaystation',
    title: '溪谷驿站',
    category: 'Minecraft 场景',
    description: '带房屋、花圃、道路和照明的可拆改体素驿站。',
    plan: makeValleyWaystation(),
  },
  {
    id: 'finished-minecraft-ore-cutaway',
    i18nKey: 'asset.default.minecraftOreCutaway',
    title: '矿脉剖面',
    category: 'Minecraft 场景',
    description: '用于观察岩层、矿脉、台阶与地下水洼的教学剖面。',
    plan: makeOreCutaway(),
  },
  {
    id: 'finished-minecraft-forest-camp',
    i18nKey: 'asset.default.minecraftForestCamp',
    title: '林间营地',
    category: 'Minecraft 场景',
    description: '带两种树木、营火、帐篷和物资点的小型探索营地。',
    plan: makeForestCamp(),
  },
  {
    id: 'finished-minecraft-seaside-lighthouse',
    i18nKey: 'asset.default.minecraftSeasideLighthouse',
    title: '滨海灯塔',
    category: 'Minecraft 场景',
    description: '红白条纹塔身、发光灯室、木板码头和环形水面的原创滨海灯塔。',
    plan: makeSeasideLighthouse(),
  },
  {
    id: 'finished-minecraft-village-square',
    i18nKey: 'asset.default.minecraftVillageSquare',
    title: '村庄广场',
    category: 'Minecraft 场景',
    description: '带薄门窗、村舍、市集摊位、路灯、围栏和花圃的原创体素村庄广场。',
    plan: makeVillageSquare(),
  },
]
