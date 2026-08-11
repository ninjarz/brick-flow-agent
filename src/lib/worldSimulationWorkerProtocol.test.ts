import { describe, expect, it } from 'vitest'
import { createEmptyWorldState } from './worldEntity'
import {
  appendWorldSimulationBacklog,
  isExpectedWorldSimulationWorkerResponse,
  worldSimulationWorkerProtocolVersion,
  type WorldSimulationWorkerResponse,
} from './worldSimulationWorkerProtocol'

describe('world simulation worker protocol', () => {
  it('bounds accumulated simulation work when a worker falls behind', () => {
    expect(appendWorldSimulationBacklog(2, 5)).toBe(3)
    expect(appendWorldSimulationBacklog(-1, 2)).toBe(2)
  })

  it('accepts only the current request for the current world', () => {
    const world = createEmptyWorldState('worker-plan')
    const response = {
      protocolVersion: worldSimulationWorkerProtocolVersion,
      requestId: 7,
      worldId: world.id,
      world,
    } satisfies WorldSimulationWorkerResponse
    expect(isExpectedWorldSimulationWorkerResponse(response, 7, world.id)).toBe(true)
    expect(isExpectedWorldSimulationWorkerResponse(response, 6, world.id)).toBe(false)
    expect(isExpectedWorldSimulationWorkerResponse(response, 7, 'another-world')).toBe(false)
  })
})
