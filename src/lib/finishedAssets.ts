import type { FinishedAsset } from '../types/bricks'
import { generateBuildPlan } from './localGenerator'
import { tryNormalizeImportedPlan } from './planImport'
import { getBlockingBuildPlanIssues, validateBuildPlan } from './planUtils'

const storageKey = 'brick-flow-agent:finished-assets:v18'
const generatedObjAssetIdPrefix = 'finished-obj-'
const retiredDefaultAssetIds = new Set([
  'finished-tiger',
  'finished-toaster',
  'finished-windmill',
  'finished-plane',
  'finished-window-house',
  'finished-spinner',
  'finished-arch-gate',
])
const defaultAssetIds = new Set([
  'finished-ghost',
  'finished-bridge',
  'finished-house',
  'finished-castle',
  'finished-bench',
  'finished-rocket',
  'finished-flower',
  'finished-robot',
  'finished-tree',
  'finished-duck',
])
let generatedObjAssetsPromise: Promise<FinishedAsset[]> | undefined

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const normalizeAsset = (asset: FinishedAsset): FinishedAsset | undefined => {
  const plan = tryNormalizeImportedPlan(asset.plan)
  if (!plan) return undefined

  return {
    ...asset,
    plan,
  }
}

const createDefaultAsset = (
  id: string,
  i18nKey: string,
  category: string,
  prompt: string,
  description: string,
  instructionUrl?: string,
  instructionStatus?: FinishedAsset['instructionStatus'],
): FinishedAsset => {
  const plan = generateBuildPlan({ prompt })

  return {
    id,
    i18nKey,
    title: plan.title,
    category,
    description,
    instructionUrl,
    instructionStatus,
    plan,
  }
}

export const defaultFinishedAssets: FinishedAsset[] = [
  createDefaultAsset('finished-ghost', 'asset.default.ghost', 'Classic', '一个 Classic 小幽灵', '按 LEGO Classic 10696 Ghost 官方说明复刻并经用户校准的 Classic 小幽灵，包含 2x6 底座、白色弧脚、青色身体、透明粉色 1x2 砖、侧向眼睛、白色手臂和头罩。', 'https://www.lego.com/cdn/product-assets/product.bi.additional.extra.pdf/10696_X_Ghost.pdf', 'inspired'),
  createDefaultAsset('finished-bridge', 'asset.default.bridge', '结构', '一座小桥', '带双层桥墩、拱形支撑、灰色桥面铺装、红色双侧护栏、端点灯和蓝色水面点的小桥。'),
  createDefaultAsset('finished-house', 'asset.default.house', '建筑', '一个小房子', '带侧墙、棕色门、透明绿色窗、红色坡屋顶、烟囱烟点和院内花树的紧凑房屋。'),
  createDefaultAsset('finished-castle', 'asset.default.castle', '建筑', '一个小城堡门楼', '双塔、中央城墙、红色塔顶旗点、灰色垛口、黑色门槛、金色门饰和前场水点组成的城堡门楼。'),
  createDefaultAsset('finished-bench', 'asset.default.bench', '街景', '一个公园长椅', '带四条椅腿、加厚座面、靠背、扶手、光面坐垫以及一排多色草地花点的公园长椅。'),
  createDefaultAsset('finished-rocket', 'asset.default.rocket', '物体', '一个小火箭', '灰色发射台、橙色喷焰、蓝色双尾翼、红白蓝分色舱体、正面双舷窗和黄色锥形整流罩组成的小火箭。'),
  createDefaultAsset('finished-flower', 'asset.default.flower', '自然', '一个小花盆', '绿色草地、棕色花盆、双茎、两侧斜叶、红色横向花冠、粉色四瓣和黄色圆形花芯组成的小花盆。'),
  createDefaultAsset('finished-robot', 'asset.default.robot', '角色', '一个蓝灰色机器人', '带灰色斜面双脚、蓝色躯干、横向肩梁、红色双手、黄色双层头部、正面印刷眼睛、格栅嘴和天线的机器人。'),
  createDefaultAsset('finished-tree', 'asset.default.tree', '自然', '一棵小树', '棕色树干、向中心收拢的四面坡树冠、青绿树顶、红黄橙果实和底部草叶组成的小树。'),
  createDefaultAsset('finished-duck', 'asset.default.duck', '动物', '一只黄色小鸭', '蓝色水面底座、橙色双脚、黄色身体、尾翼和双翅、双层头部、正面橙色嘴与印刷眼睛组成的小鸭。'),
]

const isFinishedAsset = (item: unknown): item is FinishedAsset => {
  if (!isRecord(item)) return false
  const asset = item as Partial<FinishedAsset>
  return Boolean(
    asset.id &&
      asset.title &&
      asset.category &&
      asset.description &&
      asset.plan &&
      Array.isArray(asset.plan.bricks) &&
      Array.isArray(asset.plan.steps),
  )
}

export const isDefaultFinishedAsset = (asset: Pick<FinishedAsset, 'id'>) =>
  defaultAssetIds.has(asset.id) || asset.id.startsWith(generatedObjAssetIdPrefix)

export const mergeWithDefaultAssets = (
  assets: FinishedAsset[],
  defaultAssets = defaultFinishedAssets,
) => {
  const customAssets = assets.filter((asset) =>
    !isDefaultFinishedAsset(asset) &&
    !retiredDefaultAssetIds.has(asset.id)
  )
  return [...defaultAssets, ...customAssets]
}

export const loadAllDefaultFinishedAssets = async () => {
  generatedObjAssetsPromise ??= import('../data/generatedObjAssets').then((module) => module.generatedObjAssets)
  return [...defaultFinishedAssets, ...await generatedObjAssetsPromise]
}

export const loadFinishedAssets = (): FinishedAsset[] => {
  if (typeof window === 'undefined') return defaultFinishedAssets

  const stored = window.localStorage.getItem(storageKey)
  if (!stored) return defaultFinishedAssets

  try {
    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) return defaultFinishedAssets

    const validStoredAssets = parsed
      .filter(isFinishedAsset)
      .map(normalizeAsset)
      .filter((asset): asset is FinishedAsset => Boolean(asset))
      .filter((asset) => getBlockingBuildPlanIssues(validateBuildPlan(asset.plan)).length === 0)

    return mergeWithDefaultAssets(validStoredAssets)
  } catch {
    return defaultFinishedAssets
  }
}

export const saveFinishedAssets = (assets: FinishedAsset[]) => {
  const customAssets = assets.filter((asset) => !isDefaultFinishedAsset(asset))
  window.localStorage.setItem(storageKey, JSON.stringify(customAssets))
}
