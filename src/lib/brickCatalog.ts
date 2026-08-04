import type { BrickDefinition } from '../types/bricks'
import type { Locale } from './i18n'

const minecraftZhNames: Record<string, string> = {
  'minecraft-grass-block': '草方块',
  'minecraft-dirt-block': '泥土',
  'minecraft-sand-block': '沙块',
  'minecraft-snow-block': '雪块',
  'minecraft-clay-block': '黏土',
  'minecraft-moss-block': '苔藓块',
  'minecraft-ice-block': '冰块',
  'minecraft-tall-grass': '高草',
  'minecraft-red-flower': '红花',
  'minecraft-yellow-flower': '黄花',
  'minecraft-stone-block': '石块',
  'minecraft-cobblestone': '圆石',
  'minecraft-stone-bricks': '石砖',
  'minecraft-sandstone': '砂岩',
  'minecraft-deepslate': '深层岩',
  'minecraft-obsidian': '黑曜石',
  'minecraft-stone-slab': '石质半砖',
  'minecraft-stone-stairs': '石质台阶',
  'minecraft-oak-planks': '橡木板',
  'minecraft-birch-planks': '白桦木板',
  'minecraft-spruce-planks': '云杉木板',
  'minecraft-oak-log': '橡木原木',
  'minecraft-birch-log': '白桦原木',
  'minecraft-spruce-log': '云杉原木',
  'minecraft-oak-leaves': '橡树叶',
  'minecraft-birch-leaves': '白桦树叶',
  'minecraft-oak-slab': '橡木半砖',
  'minecraft-oak-stairs': '橡木台阶',
  'minecraft-oak-fence': '橡木栅栏',
  'minecraft-coal-ore': '煤矿石',
  'minecraft-iron-ore': '铁矿石',
  'minecraft-copper-ore': '铜矿石',
  'minecraft-gold-ore': '金矿石',
  'minecraft-redstone-ore': '红石矿石',
  'minecraft-lapis-ore': '青金石矿石',
  'minecraft-diamond-ore': '钻石矿石',
  'minecraft-bricks': '红砖块',
  'minecraft-white-concrete': '白色混凝土',
  'minecraft-gray-concrete': '灰色混凝土',
  'minecraft-red-concrete': '红色混凝土',
  'minecraft-bookshelf': '书架',
  'minecraft-crafting-table': '工作台',
  'minecraft-furnace': '熔炉',
  'minecraft-water-block': '水方块',
  'minecraft-glass-block': '玻璃',
  'minecraft-redstone-block': '红石块',
  'minecraft-glow-lamp': '发光灯',
  'minecraft-basic-block': '基础体素块',
}

const searchAliases: Record<string, string[]> = {
  'minecraft-grass-block': ['草地', '地表'],
  'minecraft-cobblestone': ['石头', '毛石'],
  'minecraft-stone-bricks': ['砖墙'],
  'minecraft-oak-fence': ['围栏', '栏杆'],
  'minecraft-tall-grass': ['植物', '草丛'],
  'minecraft-red-flower': ['植物', '花朵'],
  'minecraft-yellow-flower': ['植物', '花朵'],
  'minecraft-glow-lamp': ['灯光', '照明'],
  'minecraft-crafting-table': ['制作台'],
}

export const getBrickCatalogName = (definition: BrickDefinition, locale: Locale) =>
  locale === 'zh-CN' && definition.pack === 'minecraft'
    ? minecraftZhNames[definition.id] ?? definition.name
    : definition.name

export const getBrickCatalogSearchTerms = (definition: BrickDefinition, locale: Locale) => [
  definition.id,
  definition.partNumber,
  definition.name,
  getBrickCatalogName(definition, locale),
  ...(searchAliases[definition.id] ?? []),
]
