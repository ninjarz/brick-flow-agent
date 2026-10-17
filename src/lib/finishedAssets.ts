import { preparePlanGeometry } from './planGeometry'
import { safeStorage } from './safeStorage'
import { coordinateStorageWrite } from './storageCoordinator'
import searsTowerPlan from '../data/legoSearsTowerPlan.json'
import empireStatePlan from '../data/legoEmpireStatePlan.json'
import rockefellerPlan from '../data/legoRockefellerPlan.json'
import bigBenPlan from '../data/legoBigBenPlan.json'
import lighthousePlan from '../data/legoLighthousePlan.json'
import type { BuildPlan, FinishedAsset } from '../types/bricks'
import { minecraftSceneAssets } from '../data/minecraftSceneAssets'
import { indexedDbStorageMarker, isIndexedDbStorageMarker, localStorageComfortLimit, readLargeStoredValue, removeLargeStoredValue, writeLargeStoredValue } from './browserStorage'
import { generateBuildPlan } from './localGenerator'
import { tryNormalizeImportedPlan } from './planImport'
import { getBlockingBuildPlanIssues, validateBuildPlan } from './planUtils'

const storageKey = 'brick-flow-agent:finished-assets:v18'
const indexedDbKey = 'finished-assets:v18'
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
  'finished-lego-21000',
  'finished-lego-21002',
  'finished-lego-21007',
  'finished-lego-21013',
  'finished-ghost',
  'finished-lego-30023',
  'finished-bridge',
  'finished-house',
  'finished-castle',
  'finished-bench',
  'finished-rocket',
  'finished-flower',
  'finished-robot',
  'finished-tree',
  'finished-duck',
  ...minecraftSceneAssets.map((asset) => asset.id),
])
let recoveryBlocked = false

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
  {
    id: 'finished-lego-21000', title: 'LEGO 21000 西尔斯大厦', category: 'Classic',
    description: '69 个可编辑零件、17 个官方步骤，保留逐级退台、弧形入口、双天线和原始铭牌。',
    instructionUrl: 'https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4580893.pdf',
    instructionStatus: 'mapped', plan: searsTowerPlan as BuildPlan,
  },
  {
    id: 'finished-lego-21002', title: 'LEGO 21002 帝国大厦', category: 'Classic',
    description: '77 个可编辑零件、25 个官方步骤，保留层层退台、侧销与孔砖连接、尖塔和原始铭牌。',
    instructionUrl: 'https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4580898.pdf',
    instructionStatus: 'mapped', plan: empireStatePlan as BuildPlan,
  },
  {
    id: 'finished-lego-21007', title: 'LEGO 21007 洛克菲勒中心', category: 'Classic',
    description: '240 个可编辑零件、23 个官方主步骤，保留侧贴砖立面、建筑群、金色广场圆板和双铭牌；主塔与副塔子步骤按总成展示。',
    instructionUrl: 'https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4632899.pdf',
    instructionStatus: 'mapped', plan: rockefellerPlan as BuildPlan,
  },
  {
    id: 'finished-lego-21013', title: 'LEGO 21013 大本钟', category: 'Classic',
    description: 'LEGO Architecture 大本钟，346 个可编辑零件、52 个官方主步骤，保留四面钟盘、侧向格栅、屋顶尖塔与 Big Ben 铭牌。',
    instructionUrl: 'https://www.lego.com/cdn/product-assets/product.bi.core.pdf/6115609.pdf',
    instructionStatus: 'mapped', plan: bigBenPlan as BuildPlan,
  },
  {
    id: 'finished-lego-30023', title: 'LEGO 30023 灯塔', category: 'Classic',
    description: '按 LEGO Creator 30023 官方说明书 4650618 逐步复刻，25 个可编辑零件，包括红白圆塔、八边平台、透明黄色灯室和底座小屋。',
    instructionUrl: 'https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4650618.pdf',
    instructionStatus: 'mapped', plan: lighthousePlan as BuildPlan,
  },
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
  ...minecraftSceneAssets,
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

const normalizeStoredAssets = (value: unknown): FinishedAsset[] => {
  if (!Array.isArray(value)) throw new Error('INVALID_ASSET_STORAGE')
  return value.map((item) => {
    if (!isFinishedAsset(item)) throw new Error('INVALID_ASSET_STORAGE')
    const asset = normalizeAsset(item)
    if (!asset || getBlockingBuildPlanIssues(validateBuildPlan(asset.plan)).length > 0) throw new Error('INVALID_ASSET_STORAGE')
    return asset
  })
}

const prepareStoredAssets = async (value: unknown) => {
  if (!Array.isArray(value)) throw new Error('INVALID_ASSET_STORAGE')
  const normalized = value.map((item) => {
    if (!isFinishedAsset(item)) throw new Error('INVALID_ASSET_STORAGE')
    const asset = normalizeAsset(item)
    if (!asset) throw new Error('INVALID_ASSET_STORAGE')
    return asset
  })
  await Promise.all(normalized.map((asset) => preparePlanGeometry(asset.plan)))
  return normalizeStoredAssets(normalized)
}

export const mergeRecoveredFinishedAssets = (stored: FinishedAsset[], current: FinishedAsset[]) => {
  const custom = new Map(stored.filter((asset) => !isDefaultFinishedAsset(asset)).map((asset) => [asset.id, asset]))
  for (const asset of current) if (!isDefaultFinishedAsset(asset)) custom.set(asset.id, asset)
  return mergeWithDefaultAssets([...custom.values()], current.filter(isDefaultFinishedAsset))
}

export type FinishedAssetsLoadResult =
  | { status: 'loaded'; assets: FinishedAsset[] }
  | { status: 'missing' | 'unavailable' | 'invalid' }

export const hasIndexedDbFinishedAssets = () => {
  if (typeof window === 'undefined') return false
  try {
    return isIndexedDbStorageMarker(safeStorage.getItem(storageKey))
  } catch {
    return false
  }
}

export const needsFinishedAssetsRecovery = () => {
  const inline = safeStorage.getItem(storageKey)
  if (!inline || isIndexedDbStorageMarker(inline)) return true
  try { normalizeStoredAssets(JSON.parse(inline)); return false } catch { return true }
}

export const loadFinishedAssets = (): FinishedAsset[] => {
  if (typeof window === 'undefined') return defaultFinishedAssets

  const stored = safeStorage.getItem(storageKey)
  if (!stored || isIndexedDbStorageMarker(stored)) { recoveryBlocked = true; return defaultFinishedAssets }

  try {
    const validStoredAssets = normalizeStoredAssets(JSON.parse(stored) as unknown)
    recoveryBlocked = false

    return mergeWithDefaultAssets(validStoredAssets)
  } catch {
    recoveryBlocked = true
    return defaultFinishedAssets
  }
}

export const loadFinishedAssetsFromIndexedDb = async (): Promise<FinishedAssetsLoadResult> => {
  recoveryBlocked = true
  const inline = safeStorage.getItem(storageKey)
  if (inline && !isIndexedDbStorageMarker(inline)) {
    try {
      const assets = mergeWithDefaultAssets(await prepareStoredAssets(JSON.parse(inline)))
      recoveryBlocked = false
      return { status: 'loaded', assets }
    } catch { return { status: 'invalid' } }
  }
  let stored: unknown
  try { stored = await readLargeStoredValue<unknown>(indexedDbKey) }
  catch { return { status: 'unavailable' } }
  if (stored === undefined) {
    if (isIndexedDbStorageMarker(inline)) return { status: 'invalid' }
    recoveryBlocked = false
    return { status: 'missing' }
  }
  try {
    const assets = mergeWithDefaultAssets(await prepareStoredAssets(stored))
    recoveryBlocked = false
    return { status: 'loaded', assets }
  } catch { return { status: 'invalid' } }
}

let finishedAssetsSaveQueue = Promise.resolve(true)

const persistFinishedAssets = async (assets: FinishedAsset[]) => {
  if (recoveryBlocked) return false
  const customAssets = assets.filter((asset) => !isDefaultFinishedAsset(asset))
  const serialized = JSON.stringify(customAssets)

  if (serialized.length <= localStorageComfortLimit) {
    try {
      if (!safeStorage.setItem(storageKey, serialized)) throw new Error('LOCAL_STORAGE_UNAVAILABLE')
      await removeLargeStoredValue(indexedDbKey).catch(() => undefined)
      return true
    } catch {
      // Fall through to IndexedDB when localStorage is unavailable or full.
    }
  }

  try {
    await writeLargeStoredValue(indexedDbKey, customAssets)
    safeStorage.removeItem(storageKey)
    safeStorage.setItem(storageKey, indexedDbStorageMarker)
    return true
  } catch {
    return false
  }
}

export const saveFinishedAssets = (assets: FinishedAsset[]) => {
  const nextSave = finishedAssetsSaveQueue.then(() => coordinateStorageWrite(() => persistFinishedAssets(assets)))
  finishedAssetsSaveQueue = nextSave.catch(() => false)
  return nextSave
}
