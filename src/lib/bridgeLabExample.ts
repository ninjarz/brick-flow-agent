import type { BuildPlan } from '../types/bricks'

export const bridgeLabPlanPrefix = 'bridge-lab-'

export const createBridgeLabPlan = (id: string, title: string, locale: 'zh-CN' | 'en-US'): BuildPlan => ({
  id,
  title,
  prompt: '',
  source: 'template-local',
  bricks: [
    { id: 'pier', brickId: 'brick-1x1', color: 'gray', pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0 } },
    { id: 'deck', brickId: 'brick-1x4', color: 'gray', pose: { xStud: 0, yStud: 1.2, zStud: 0, rotationQuarterTurns: 0 } },
  ],
  steps: [
    { id: 'pier-step', title: locale === 'zh-CN' ? '桥墩' : 'Pier', description: '', brickIds: ['pier'] },
    { id: 'deck-step', title: locale === 'zh-CN' ? '桥面' : 'Deck', description: '', brickIds: ['deck'] },
  ],
})
