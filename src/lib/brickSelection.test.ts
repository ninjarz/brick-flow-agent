import { describe, expect, it } from 'vitest'
import { toggleBrickSelection } from './brickSelection'

describe('toggleBrickSelection', () => {
  it('adds a modifier-clicked brick to the current selection', () => {
    expect(toggleBrickSelection('a', [], 'b')).toEqual({
      selectedId: 'b',
      selectedGroupIds: ['a', 'b'],
    })
  })

  it('removes a modifier-clicked primary brick and promotes a remaining brick', () => {
    expect(toggleBrickSelection('b', ['a', 'b', 'c'], 'b')).toEqual({
      selectedId: 'c',
      selectedGroupIds: ['a', 'c'],
    })
  })

  it('returns to an ordinary single selection after toggling down to one brick', () => {
    expect(toggleBrickSelection('b', ['a', 'b'], 'a')).toEqual({
      selectedId: 'b',
      selectedGroupIds: [],
    })
  })
})
