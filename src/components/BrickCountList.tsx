import { memo, useMemo } from 'react'
import { brickById } from '../data/basicBricks'
import { useI18n } from '../lib/i18n'
import type { BrickColor } from '../types/bricks'
import { LazyBrickGlyph } from './LazyBrickGlyph'

type BrickCountItem = {
  key: string
  brickId: string
  name: string
  color: BrickColor
  quantity: number
}

export const BrickCountList = memo(({ items }: { items: BrickCountItem[] }) => {
  const { t } = useI18n()
  const sortedItems = useMemo(() => [...items].sort((a, b) => b.quantity - a.quantity), [items])
  return <div className="brick-count-list">
    {sortedItems.map(item => {
      const definition = brickById.get(item.brickId)
      return <article key={item.key}>
        {definition ? <LazyBrickGlyph brickId={definition.id} kind={definition.kind} footprint={definition.footprint} color={item.color} className="count-glyph" /> : <span className="count-glyph" aria-hidden="true" />}
        <div>
          <h3 title={item.name}>{item.name}</h3>
          <p>{t('counts.quantity', { count: item.quantity })}</p>
        </div>
      </article>
    })}
  </div>
})

BrickCountList.displayName = 'BrickCountList'
