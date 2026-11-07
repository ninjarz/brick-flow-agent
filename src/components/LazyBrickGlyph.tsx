import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { BrickColor, BrickFootprint, BrickKind } from '../types/bricks'

const BrickGlyph = lazy(() => import('./BrickGlyph').then((module) => ({ default: module.BrickGlyph })))

type LazyBrickGlyphProps = {
  brickId?: string
  kind: BrickKind
  footprint: BrickFootprint
  color?: BrickColor
  className?: string
}

export const LazyBrickGlyph = (props: LazyBrickGlyphProps) => {
  const element = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!element.current) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '80px' })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [])
  return <span ref={element} className={`${props.className ?? ''}${visible ? '' : ' brick-glyph-placeholder'}`} aria-hidden="true">
    {visible && <Suspense fallback={null}><BrickGlyph {...props} className={undefined} /></Suspense>}
  </span>
}
