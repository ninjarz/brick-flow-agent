import type { WorldCharacterSpark } from '../types/world'

export type WorldSparkLocale = 'zh-CN' | 'en-US'

export type WorldCharacterSparkPreset = {
  id: string
  label: Record<WorldSparkLocale, string>
  spark: Record<WorldSparkLocale, WorldCharacterSpark>
}

/**
 * Lightweight built-in spark presets. They intentionally reuse the project's
 * own four-field spark shape instead of any third-party character-card format,
 * so applying a preset is a plain field copy with no migration surface.
 */
export const worldCharacterSparkPresets: WorldCharacterSparkPreset[] = [
  {
    id: 'loyal-guard',
    label: { 'zh-CN': '忠诚卫士', 'en-US': 'Loyal guard' },
    spark: {
      'zh-CN': {
        motive: '守住身后的人与承诺，不让阵线在自己这里断开',
        temperament: '坚定、可靠、危险面前先想到同伴的位置',
        voice: '短促有力，先报状况再给承诺',
        initiative: 0.7,
      },
      'en-US': {
        motive: 'Hold the line for the people and promises behind them',
        temperament: 'Steadfast and reliable; tracks allies before engaging threats',
        voice: 'Crisp and direct; reports the situation before giving assurances',
        initiative: 0.7,
      },
    },
  },
  {
    id: 'cautious-scout',
    label: { 'zh-CN': '谨慎斥候', 'en-US': 'Cautious scout' },
    spark: {
      'zh-CN': {
        motive: '在队伍之前看清路况与风险，把有用情报带回来',
        temperament: '警觉、克制、宁可绕路也不打无准备的仗',
        voice: '压低声音讲重点，先说观察到的事实',
        initiative: 0.6,
      },
      'en-US': {
        motive: 'See the road and its risks before the party does, and bring back useful intelligence',
        temperament: 'Wary and measured; would rather detour than fight unprepared',
        voice: 'Keeps it low and factual; observations before opinions',
        initiative: 0.6,
      },
    },
  },
  {
    id: 'wandering-healer',
    label: { 'zh-CN': '云游医者', 'en-US': 'Wandering healer' },
    spark: {
      'zh-CN': {
        motive: '让每个倒下的人都有再站起来的机会',
        temperament: '温和、耐心、先处理最重的伤再说话',
        voice: '轻声细语，解释风险时坦白直接',
        initiative: 0.65,
      },
      'en-US': {
        motive: 'Give every fallen person a chance to stand again',
        temperament: 'Gentle and patient; treats the worst wounds before talking',
        voice: 'Soft-spoken but honest about risks',
        initiative: 0.65,
      },
    },
  },
  {
    id: 'siege-breaker',
    label: { 'zh-CN': '破城重锤', 'en-US': 'Siege breaker' },
    spark: {
      'zh-CN': {
        motive: '拆掉挡路的墙，为队伍砸开一条直路',
        temperament: '沉稳、缓慢、对坚固目标异常执着',
        voice: '话少声沉，用距离和结构说话',
        initiative: 0.4,
      },
      'en-US': {
        motive: 'Break the walls in the way and open a straight path for the party',
        temperament: 'Heavy and unhurried; fixates on the sturdiest target',
        voice: 'Few words, low voice; speaks in ranges and structures',
        initiative: 0.4,
      },
    },
  },
  {
    id: 'tavern-keeper',
    label: { 'zh-CN': '消息灵通的店主', 'en-US': 'Well-informed keeper' },
    spark: {
      'zh-CN': {
        motive: '让店里永远热闹，顺便弄清城里每件小事',
        temperament: '热络、好奇、嘴上待客心里记账',
        voice: '亲切健谈，总从最近传闻聊起',
        initiative: 0.6,
      },
      'en-US': {
        motive: 'Keep the house lively and stay on top of every little thing in town',
        temperament: 'Warm and curious; serves drinks while keeping mental ledgers',
        voice: 'Chatty and welcoming; always opens with the latest rumor',
        initiative: 0.6,
      },
    },
  },
  {
    id: 'quiet-artisan',
    label: { 'zh-CN': '沉默工匠', 'en-US': 'Quiet artisan' },
    spark: {
      'zh-CN': {
        motive: '把手上的活计做好，用成品替自己说话',
        temperament: '内向、专注、对粗糙的工艺难以忍受',
        voice: '惜字如金，评价作品时意外地较真',
        initiative: 0.35,
      },
      'en-US': {
        motive: 'Do the work well and let the finished piece speak for itself',
        temperament: 'Reserved and focused; cannot stand sloppy craftsmanship',
        voice: 'Sparse with words, surprisingly exacting when judging work',
        initiative: 0.35,
      },
    },
  },
]
