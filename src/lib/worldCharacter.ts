import type {
  WorldCharacterSpark,
  WorldEntity,
  WorldEntityDefinition,
  WorldEntityFocus,
  WorldTargetRef,
} from '../types/world'

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

const roleSpark: Record<WorldEntityDefinition['role'], WorldCharacterSpark> = {
  melee: {
    motive: '保护同伴，以行动守住承诺',
    temperament: '果断、重视荣誉、会正面回应威胁',
    voice: '简短直接，少说空话，承诺后会付诸行动',
    initiative: 0.72,
  },
  ranged: {
    motive: '看清局势，在危险扩大前找到关键线索',
    temperament: '谨慎、敏锐、愿意分享经过验证的发现',
    voice: '冷静具体，偏好描述观察与可验证的细节',
    initiative: 0.62,
  },
  siege: {
    motive: '在安全距离支援阵线，突破最坚固的阻碍',
    temperament: '沉稳、迟缓、专注于高价值目标',
    voice: '少言、笃定，以阵地和距离来判断局势',
    initiative: 0.38,
  },
  civilian: {
    motive: '保住日常生活，并弄清身边正在发生什么',
    temperament: '亲切、好奇、遇到危险会先寻求帮助',
    voice: '自然亲近，常从传闻与生活细节说起',
    initiative: 0.55,
  },
  utility: {
    motive: '让同伴活着回来，并缓和不必要的冲突',
    temperament: '耐心、关怀、优先照顾最需要帮助的人',
    voice: '温和克制，会明确说出风险与希望',
    initiative: 0.66,
  },
}

export const normalizeWorldCharacterSpark = (
  spark: Partial<WorldCharacterSpark> | undefined,
  definition: WorldEntityDefinition,
): WorldCharacterSpark => {
  const fallback = roleSpark[definition.role]
  const clean = (value: string | undefined, fallbackValue: string, maxLength: number) => (
    value?.trim().replace(/\s+/g, ' ').slice(0, maxLength) || fallbackValue
  )
  return {
    motive: clean(spark?.motive, fallback.motive, 180),
    temperament: clean(spark?.temperament, fallback.temperament, 180),
    voice: clean(spark?.voice, fallback.voice, 180),
    initiative: clamp01(Number.isFinite(spark?.initiative) ? Number(spark?.initiative) : fallback.initiative),
  }
}

export const createDefaultWorldCharacterSpark = (
  definition: WorldEntityDefinition,
): WorldCharacterSpark => normalizeWorldCharacterSpark(undefined, definition)

export const createWorldEntityFocus = (
  summary: string,
  source: WorldEntityFocus['source'],
  updatedAtSeconds: number,
  target?: WorldTargetRef,
): WorldEntityFocus | undefined => {
  const cleanSummary = summary.trim().replace(/\s+/g, ' ').slice(0, 220)
  if (!cleanSummary) return undefined
  return {
    summary: cleanSummary,
    source,
    ...(target ? { target } : {}),
    updatedAtSeconds: Math.max(0, updatedAtSeconds),
  }
}

export const updateWorldEntityFocus = (
  entity: WorldEntity,
  focus: WorldEntityFocus | undefined,
): WorldEntity => ({
  ...entity,
  mind: {
    ...entity.mind,
    ...(focus ? { focus } : { focus: undefined }),
  },
})
