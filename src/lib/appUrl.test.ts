import { describe, expect, it } from 'vitest'
import { getCanonicalAppPath } from './appUrl'

describe('app URL normalization', () => {
  it('collapses a duplicated Vite base path', () => {
    expect(getCanonicalAppPath(
      '/brick-flow-agent/brick-flow-agent',
      '/brick-flow-agent/',
    )).toBe('/brick-flow-agent/')
    expect(getCanonicalAppPath(
      '/brick-flow-agent/brick-flow-agent/',
      '/brick-flow-agent/',
    )).toBe('/brick-flow-agent/')
  })

  it('adds the canonical trailing slash without changing a valid base path', () => {
    expect(getCanonicalAppPath('/brick-flow-agent', '/brick-flow-agent/')).toBe('/brick-flow-agent/')
    expect(getCanonicalAppPath('/brick-flow-agent/', '/brick-flow-agent/')).toBeUndefined()
  })

  it('does not rewrite unrelated paths or a root deployment', () => {
    expect(getCanonicalAppPath('/another-app/', '/brick-flow-agent/')).toBeUndefined()
    expect(getCanonicalAppPath('/', '/')).toBeUndefined()
  })
})
