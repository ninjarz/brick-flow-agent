import { lazy, Suspense } from 'react'
import type { BrickColor, BrickFootprint, BrickKind } from '../types/bricks'

const BrickGlyph = lazy(() => import('./BrickGlyph').then((module) => ({ default: module.BrickGlyph })))

type LazyBrickGlyphProps = {
  brickId?: string
  kind: BrickKind
  footprint: BrickFootprint
  color?: BrickColor
  className?: string
}

export const LazyBrickGlyph = (props: LazyBrickGlyphProps) => (
  <Suspense fallback={<span className={`${props.className ?? ''} brick-glyph-placeholder`} aria-hidden="true" />}>
    <BrickGlyph {...props} />
  </Suspense>
)
