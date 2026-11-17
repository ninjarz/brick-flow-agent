import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../lib/i18n'
import { BrickCountList } from './BrickCountList'

const items = [
  { key: 'red', brickId: 'brick-1x1', name: 'Small red', color: 'red' as const, quantity: 2 },
  { key: 'blue', brickId: 'brick-1x1', name: 'Large blue', color: 'blue' as const, quantity: 19 },
  { key: 'white', brickId: 'brick-1x1', name: 'Equal white', color: 'white' as const, quantity: 2 },
]

describe('shared brick count cards', () => {
  it('orders cards by descending quantity without mutating the source inventory', () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(BrickCountList, { items })))
    expect(html.indexOf('Large blue')).toBeLessThan(html.indexOf('Small red'))
    expect(html.indexOf('Small red')).toBeLessThan(html.indexOf('Equal white'))
    expect(html.match(/<article/g)).toHaveLength(3)
    expect(items.map(item => item.quantity)).toEqual([2, 19, 2])
  })
  it('accepts an empty inventory', () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(BrickCountList, { items: [] })))
    expect(html).not.toContain('<article')
  })
})
