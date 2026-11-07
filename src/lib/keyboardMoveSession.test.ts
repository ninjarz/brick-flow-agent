import { describe, expect, it, vi } from 'vitest'
import { createKeyboardMoveSession, type MoveDelta } from './keyboardMoveSession'
import { translateRigidBrickGroup } from './rigidBrickGroup'
import { makeBrick, createBrickCollisionIndex } from './planUtils'
import { moveBrickGroupAlongSteps } from './brickGroupPlacement'
import type { PlacedBrick } from '../types/bricks'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const source = () => [makeBrick('brick-1x1', 'red', 0, 0, 0)]
const moved = (from: PlacedBrick[], steps: MoveDelta[]) => steps.reduce((parts, delta) => translateRigidBrickGroup(parts, delta), from)

describe('keyboard move transactions', () => {
  it('coalesces waiting inputs without losing steps and commits once after release', async () => {
    const jobs: Array<{ from: PlacedBrick[]; steps: MoveDelta[]; resolve: (parts: PlacedBrick[]) => void }> = []
    const commit = vi.fn(), preview = vi.fn(), close = vi.fn()
    const session = createKeyboardMoveSession({ source: source(), valid: () => true, validate: (from, steps) => new Promise(resolve => jobs.push({ from, steps, resolve })), commit, preview, close, error: vi.fn() })
    session.move({ xStud: .2 }); session.move({ xStud: .2 }); session.move({ zStud: -.2 })
    expect(jobs).toHaveLength(1)
    session.finish(); expect(commit).not.toHaveBeenCalled()
    jobs[0].resolve(moved(jobs[0].from, jobs[0].steps)); await flush()
    expect(jobs).toHaveLength(2); expect(jobs[1].steps).toHaveLength(2)
    expect(commit).not.toHaveBeenCalled()
    jobs[1].resolve(moved(jobs[1].from, jobs[1].steps)); await flush()
    expect(commit).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0][0][0].pose.xStud).toBeCloseTo(.4)
    expect(commit.mock.calls[0][0][0].pose.zStud).toBeCloseTo(-.2)
    expect(preview).toHaveBeenCalledTimes(2)
  })
  it.each(['cancel', 'stale'] as const)('ignores late worker results after %s', async mode => {
    let resolve!: (parts: PlacedBrick[]) => void, valid = true
    const commit = vi.fn(), preview = vi.fn(), close = vi.fn()
    const session = createKeyboardMoveSession({ source: source(), valid: () => valid, validate: () => new Promise(done => { resolve = done }), commit, preview, close, error: vi.fn() })
    session.move({ xStud: .2 }); session.finish()
    if (mode === 'cancel') session.cancel(); else valid = false
    resolve(translateRigidBrickGroup(source(), { xStud: .2 })); await flush()
    expect(commit).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce()
  })
  it('does not commit a blocked move or an out-and-back gesture', async () => {
    const commit = vi.fn()
    const session = createKeyboardMoveSession({ source: source(), valid: () => true, validate: async from => from, commit, preview: vi.fn(), close: vi.fn(), error: vi.fn() })
    session.move({ xStud: .2 }); session.finish(); await flush()
    expect(commit).not.toHaveBeenCalled()
  })
  it('retains new input arriving while a released gesture is still awaiting collision results', async () => {
    let done!: (parts: PlacedBrick[]) => void
    const original = source(), commit = vi.fn()
    let calls = 0
    const session = createKeyboardMoveSession({ source: original, valid: () => true,
      validate: (from, steps) => ++calls === 1 ? new Promise(resolve => { done = resolve }) : Promise.resolve(moved(from, steps)),
      commit, preview: vi.fn(), close: vi.fn(), error: vi.fn() })
    session.move({ xStud: .2 }); session.finish()
    session.move({ xStud: .2 }); session.finish()
    done(moved(original, [{ xStud: .2 }])); await flush()
    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0][0][0].pose.xStud).toBeCloseTo(.4)
  })
  it('closes a failed transaction without changing the model', async () => {
    const commit = vi.fn(), close = vi.fn(), error = vi.fn()
    const session = createKeyboardMoveSession({ source: source(), valid: () => true, validate: async () => { throw Error('worker unavailable') }, commit, close, error, preview: vi.fn() })
    session.move({ xStud: .2 }); session.finish(); await flush()
    expect(commit).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce(); expect(error).toHaveBeenCalledOnce()
  })
  it('checks intermediate poses instead of tunnelling through obstacles', () => {
    const wall = [makeBrick('brick-1x1', 'gray', 2, 0, 0)]
    const index = createBrickCollisionIndex(wall)
    const result = moveBrickGroupAlongSteps(source(), Array.from({ length: 20 }, () => ({ xStud: .2 })), wall, index)
    expect(result[0].pose.xStud).toBeLessThanOrEqual(1.00001)
    expect(result[0].pose.xStud).toBeGreaterThan(0)
    const retreat = moveBrickGroupAlongSteps(result, [{ xStud: -.2 }], wall, index)
    expect(retreat[0].pose.xStud).toBeCloseTo(result[0].pose.xStud - .2)
  })
})
