import { describe, expect, it } from 'vitest'
import { createCoalescedAsyncWriter } from './coalescedWriter'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('coalesced async writer', () => {
  it('persists the active value and only the newest queued value', async () => {
    const calls: number[] = []
    const gates = [deferred<boolean>(), deferred<boolean>()]
    const writer = createCoalescedAsyncWriter<number>(async (value) => {
      calls.push(value)
      return gates[calls.length - 1].promise
    })

    const first = writer.write(1)
    const second = writer.write(2)
    const third = writer.write(3)
    expect(calls).toEqual([1])
    gates[0].resolve(true)
    expect(await first).toBe(true)
    await Promise.resolve()
    expect(calls).toEqual([1, 3])
    gates[1].resolve(true)
    expect(await Promise.all([second, third])).toEqual([true, true])
  })

  it('turns write failures into false and continues with pending work', async () => {
    const calls: string[] = []
    const writer = createCoalescedAsyncWriter<string>(async (value) => {
      calls.push(value)
      if (value === 'first') throw new Error('storage offline')
      return true
    })
    expect(await writer.write('first')).toBe(false)
    expect(await writer.write('second')).toBe(true)
    expect(calls).toEqual(['first', 'second'])
  })
})
