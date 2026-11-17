import { memo, useMemo } from 'react'
import { brickDefinitions, getDefaultBrickColor } from '../data/basicBricks'
import { useI18n } from '../lib/i18n'
import type { BuildPlan } from '../types/bricks'
import { BrickCountList } from './BrickCountList'

type BrickCountsPanelProps = {
  plan: BuildPlan
  brickCounts: Record<string, number>
}

export const BrickCountsPanel = memo(({ plan, brickCounts }: BrickCountsPanelProps) => {
  const { t } = useI18n()
  const usedBricks = useMemo(
    () => brickDefinitions.filter((brick) => brickCounts[brick.id]),
    [brickCounts],
  )
  const firstColorByDefinitionId = useMemo(() => {
    const colors = new Map<string, BuildPlan['bricks'][number]['color']>()
    for (const brick of plan.bricks) {
      if (!colors.has(brick.brickId)) colors.set(brick.brickId, brick.color)
    }
    return colors
  }, [plan.bricks])

  return (
    <section className="brick-counts" aria-label={t('counts.aria')}>
      <header>
        <h2>{t('counts.title')}</h2>
        <p>{t('common.parts', { count: plan.bricks.length })}</p>
      </header>
      <BrickCountList items={usedBricks.map(brick => ({
        key: brick.id,
        brickId: brick.id,
        name: brick.name,
        color: firstColorByDefinitionId.get(brick.id) ?? getDefaultBrickColor(brick),
        quantity: brickCounts[brick.id],
      }))} />
      {usedBricks.length === 0 && <p className="muted">{t('counts.empty')}</p>}
    </section>
  )
})

BrickCountsPanel.displayName = 'BrickCountsPanel'
