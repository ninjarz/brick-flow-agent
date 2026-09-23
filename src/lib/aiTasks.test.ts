import { describe, expect, it } from 'vitest'
import { createAiTasks } from './aiTasks'
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
describe('AI task isolation', () => {
  it('cancels queued work without executing it and releases the next slot', async () => {
    const tasks = createAiTasks()
    tasks.configure({ concurrency: 1, requests: 10, outputTokens: 100, consecutiveFailures: 3 })
    let release!: () => void
    const first = tasks.run('one', undefined, () => new Promise<void>(resolve => { release = resolve }))
    await tick()
    let calls = 0
    const second = tasks.run('two', undefined, async () => { calls++ })
    const rejected = expect(second).rejects.toThrow()
    tasks.cancel(tasks.getSnapshot()[1].id)
    await rejected
    release(); await first
    await tasks.run('three', undefined, async () => { calls++ })
    expect(calls).toBe(1)
  })
  it('rejects old project responses even if the service ignores abort', async () => {
    const tasks = createAiTasks()
    let release!: (value: string) => void
    const result = tasks.run('old', undefined, () => new Promise<string>(resolve => { release = resolve }))
    const rejected = expect(result).rejects.toThrow()
    await tick()
    tasks.setContext({ projectId: 'new', epoch: 1, configVersion: 0 })
    release('stale'); await rejected
    expect(tasks.getSnapshot()[0].phase).toBe('canceled')
  })
  it('enforces output and request budgets and exports no error content', async () => {
    const tasks = createAiTasks()
    tasks.configure({ concurrency: 1, requests: 1, outputTokens: 100, consecutiveFailures: 2 })
    expect(await tasks.run('one', undefined, async signal => tasks.request(signal, 200))).toBe(100)
    await expect(tasks.run('two', undefined, async signal => tasks.request(signal, 200))).rejects.toThrow('LIMIT')
    await expect(tasks.run('secret', undefined, async () => { throw new Error('private prompt API_KEY') })).rejects.toThrow()
    expect(tasks.exportDiagnostics()).not.toContain('private prompt')
    expect(tasks.exportDiagnostics()).not.toContain('API_KEY')
  })
})
