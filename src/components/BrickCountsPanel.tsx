import { memo, useMemo } from 'react'
import { brickDefinitions, getDefaultBrickColor } from '../data/basicBricks'
import { useI18n } from '../lib/i18n'
import type { BuildPlan } from '../types/bricks'
import { LazyBrickGlyph } from './LazyBrickGlyph'

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
      <div className="brick-count-list">
        {usedBricks.map((brick) => (
          <article key={brick.id}>
            <LazyBrickGlyph
              brickId={brick.id}
              kind={brick.kind}
              footprint={brick.footprint}
              color={firstColorByDefinitionId.get(brick.id) ?? getDefaultBrickColor(brick)}
              className="count-glyph"
            />
            <div>
              <h3>{brick.name}</h3>
              <p>{t('counts.quantity', { count: brickCounts[brick.id] })}</p>
            </div>
          </article>
        ))}
      </div>
      {usedBricks.length === 0 && <p className="muted">{t('counts.empty')}</p>}
    </section>
  )
})

BrickCountsPanel.displayName = 'BrickCountsPanel'
