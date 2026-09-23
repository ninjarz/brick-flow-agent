import { describe, expect, it } from 'vitest'
import { createEmptyWorldState } from './worldEntity'
import {
  appendWorldSimulationBacklog,
  isExpectedWorldSimulationWorkerResponse,
  isWorldSimulationSnapshotCurrent,
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
      planRevision: 1,
      worldId: world.id,
      world,
    } satisfies WorldSimulationWorkerResponse
    expect(isExpectedWorldSimulationWorkerResponse(response, 7, world.id, 1)).toBe(true)
    expect(isExpectedWorldSimulationWorkerResponse(response, 6, world.id, 1)).toBe(false)
    expect(isExpectedWorldSimulationWorkerResponse(response, 7, 'another-world', 1)).toBe(false)
    expect(isExpectedWorldSimulationWorkerResponse(response, 7, world.id, 2)).toBe(false)
  })

  it('rejects a delayed step after geometry or controller options change without a world edit', () => {
    const world = createEmptyWorldState('worker-plan')
    const sent = { world, plan: { bricks: [], structures: [] }, options: { enableAi: false, directorPlaybackActive: false, directorSimulationStarted: false } }
    expect(isWorldSimulationSnapshotCurrent(sent, { ...sent, plan: { ...sent.plan } })).toBe(true)
    expect(isWorldSimulationSnapshotCurrent(sent, { ...sent, plan: { ...sent.plan, bricks: [] } })).toBe(false)
    expect(isWorldSimulationSnapshotCurrent(sent, { ...sent, plan: { ...sent.plan, structures: [] } })).toBe(false)
    expect(isWorldSimulationSnapshotCurrent(sent, { ...sent, options: { ...sent.options, enableAi: true } })).toBe(false)
  })
})
