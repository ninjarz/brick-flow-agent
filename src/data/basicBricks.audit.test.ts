import { describe, expect, it } from 'vitest'
import { brickDefinitions } from './basicBricks'

describe('brick definition connector coverage', () => {
  it('keeps every non-wheel LEGO part connectable', () => {
    const unexpectedlyConnectorless = brickDefinitions
      .filter((definition) => definition.pack === 'lego' && definition.kind !== 'wheel' && definition.connectors.length === 0)
      .map((definition) => `${definition.id}:${definition.partNumber}`)
    expect(unexpectedlyConnectorless).toEqual([])
  })

  it('documents the current mechanical-joint boundary for wheels and tires', () => {
    const connectorless = brickDefinitions
      .filter((definition) => definition.pack === 'lego' && definition.connectors.length === 0)
    expect(connectorless.length).toBeGreaterThan(0)
    expect(connectorless.every((definition) => definition.kind === 'wheel')).toBe(true)
  })
})
