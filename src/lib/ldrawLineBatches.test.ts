import { expect, it, vi } from 'vitest'
import { yieldToBrowser } from './yieldToBrowser'
import { Matrix4 } from 'three'
import { makeBrick } from './planUtils'
import { mergeLDrawLineBatches, prepareLDrawLineBatches, type LDrawLineGroup } from './ldrawLineBatches'

vi.mock('./yieldToBrowser', () => ({ yieldToBrowser: vi.fn(async () => {}) }))

it('cooperatively prepares exactly the same endpoints as synchronous batching', async () => {
  const brick = makeBrick('brick-1x1', 'red', 0, 0, 0)
  const points = Array.from({ length: 60000 }, (_, i) => Math.sin(i))
  const lines = new Map<string, LDrawLineGroup>([['body:0:0', { color: '#172033', length: points.length, items: [{ brick, points, matrix: new Matrix4().makeRotationY(.4).setPosition(1, 2, 3) }] }]])
  const sync = mergeLDrawLineBatches(lines)
  const progress: number[] = []
  const asyncBatches = await prepareLDrawLineBatches(lines, value => progress.push(value))
  expect(asyncBatches[0].points).toEqual(sync[0].points)
  expect(asyncBatches[0].sources).toEqual(sync[0].sources)
  expect(progress.at(-1)).toBe(1)
  expect(await prepareLDrawLineBatches(new Map())).toEqual([])
})

it('groups cheap preparation work within a time slice instead of yielding once per batch', async () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.mocked(yieldToBrowser).mockClear()
  try {
    const brick = makeBrick('brick-1x1', 'red', 0, 0, 0)
    const source = { color: '#172033', length: 6, items: [{ brick, points: [0, 0, 0, 1, 1, 1], matrix: new Matrix4() }] }
    const lines = new Map(Array.from({ length: 1000 }, (_, i) => [String(i), source]))
    expect(await prepareLDrawLineBatches(lines)).toHaveLength(1000)
    expect(yieldToBrowser).not.toHaveBeenCalled()
  } finally { clock.mockRestore() }
})

it('preserves rigid chunk source order when new spatial buckets interleave old members', () => {
  const sources = [0, 1, 2].map(i => ({ brick: makeBrick('brick-1x1', 'red', i, 0, 0), points: [0, 0, 0, 1, 1, 1], matrix: new Matrix4().makeTranslation(i, 0, 0) }))
  const first = mergeLDrawLineBatches(new Map([['body:active:old', { color: '#172033', rigid: true, items: sources, length: 18 }]]))
  const moved = sources.map(item => ({ ...item, brick: { ...item.brick }, matrix: new Matrix4().makeTranslation(20, 0, 0).multiply(item.matrix) }))
  const next = mergeLDrawLineBatches(new Map([
    ['body:active:new-1', { color: '#172033', rigid: true, items: [moved[0], moved[2]], length: 12 }],
    ['body:active:new-2', { color: '#172033', rigid: true, items: [moved[1]], length: 6 }],
  ]), first)
  expect(next).toHaveLength(1)
  expect(next[0].points).toBe(first[0].points)
  expect(next[0].sources.map(item => item.brick.id)).toEqual(sources.map(item => item.brick.id))
  expect(next[0].transform!.elements[12]).toBe(20)
})
