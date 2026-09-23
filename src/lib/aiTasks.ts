import { withAbortSignal } from './requestLifetime'
export type AiTaskPhase = 'queued' | 'requesting' | 'receiving' | 'validating' | 'executing' | 'done' | 'canceled' | 'failed'
export type AiTask = { id: string; projectId: string; epoch: number; configVersion: number; kind: string; phase: AiTaskPhase; startedAt: number; endedAt?: number; error?: string; requests: number; outputTokens?: number }
export type AiLimits = { concurrency: number; requests: number; outputTokens: number; consecutiveFailures: number }
export const classifyAiError = (error: unknown) => {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  if (/abort|cancel|取消/i.test(text)) return 'canceled'
  if (/timeout|超时/i.test(text)) return 'timeout'
  if (/401|403|auth|认证/i.test(text)) return 'authentication'
  if (/429|rate|限流/i.test(text)) return 'rate-limit'
  if (/json|syntax|格式/i.test(text)) return 'format'
  if (/limit|预算/i.test(text)) return 'budget'
  if (/part|brick|结构|零件/i.test(text)) return 'validation'
  return 'network'
}
export const createAiTasks = () => {
  let context = { projectId: 'workspace', epoch: 0, configVersion: 0 }
  let limits: AiLimits = { concurrency: 2, requests: 200, outputTokens: 128_000, consecutiveFailures: 5 }
  let tasks: AiTask[] = []
  let running = 0
  let requests = 0
  let failures = 0
  const listeners = new Set<() => void>()
  const controls = new Map<string, AbortController>()
  const phases = new WeakMap<AbortSignal, AiTask>()
  const pending: (() => void)[] = []
  const emit = () => { tasks = [...tasks]; listeners.forEach(fn => fn()) }
  const drain = () => { while (running < limits.concurrency && pending.length) pending.shift()!() }
  const cancelAll = () => controls.forEach(controller => controller.abort())
  return {
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    getSnapshot: () => tasks,
    getLimits: () => limits,
    configure: (next: AiLimits) => {
      for (const value of Object.values(next)) if (!Number.isFinite(value) || value < 1) throw new Error('INVALID_LIMIT')
      limits = { concurrency: Math.min(4, Math.floor(next.concurrency)), requests: Math.floor(next.requests), outputTokens: Math.floor(next.outputTokens), consecutiveFailures: Math.floor(next.consecutiveFailures) }; emit(); drain()
    },
    setContext: (next: typeof context) => { if (Object.keys(context).some(key => context[key as keyof typeof context] !== next[key as keyof typeof context])) { cancelAll(); context = next; requests = 0; failures = 0 } },
    cancelAll,
    bind: (parent: AbortSignal | undefined, child: AbortSignal) => { const task = parent && phases.get(parent); if (task) phases.set(child, task) },
    cancel: (id: string) => controls.get(id)?.abort(),
    phase: (signal: AbortSignal | undefined, phase: AiTaskPhase) => { const task = signal && phases.get(signal); if (task && controls.has(task.id)) { task.phase = phase; emit() } },
    usage: (signal: AbortSignal | undefined, outputTokens: number | undefined) => { const task = signal && phases.get(signal); if (task && outputTokens !== undefined) { task.outputTokens = (task.outputTokens ?? 0) + outputTokens; emit() } },
    request: (signal: AbortSignal | undefined, outputTokens: number) => {
      const task = signal && phases.get(signal)
      if (requests >= limits.requests || failures >= limits.consecutiveFailures) throw new Error('AI_REQUEST_LIMIT')
      requests += 1
      if (task) { task.requests += 1; task.phase = 'requesting'; emit() }
      return Math.min(outputTokens, limits.outputTokens)
    },
    run: async <T>(kind: string, caller: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
      const parent = caller && phases.get(caller)
      if (parent && controls.has(parent.id)) { caller!.throwIfAborted(); return operation(caller!) }
      const controller = new AbortController()
      const abort = () => controller.abort()
      caller?.addEventListener('abort', abort, { once: true })
      if (caller?.aborted) abort()
      const task: AiTask = { ...context, id: crypto.randomUUID(), kind, phase: 'queued', startedAt: Date.now(), requests: 0 }
      tasks = [...tasks.filter(item => controls.has(item.id) || tasks.indexOf(item) >= tasks.length - 49), task]
      controls.set(task.id, controller); phases.set(controller.signal, task); emit()
      let acquired = false
      let start!: () => void
      try {
        await withAbortSignal(controller.signal, () => new Promise<void>(resolve => {
          start = () => { acquired = true; running += 1; resolve() }
          pending.push(start); drain()
        }))
        controller.signal.throwIfAborted()
        task.phase = 'requesting'; emit()
        const result = await withAbortSignal(controller.signal, () => operation(controller.signal))
        controller.signal.throwIfAborted()
        if (context.projectId !== task.projectId || context.epoch !== task.epoch || context.configVersion !== task.configVersion) throw new DOMException('Stale task', 'AbortError')
        task.phase = 'done'; failures = 0
        const usage = (result as { usage?: { outputTokens?: number } } | undefined)?.usage
        if (usage?.outputTokens !== undefined) task.outputTokens = usage.outputTokens
        return result
      } catch (error) {
        task.error = controller.signal.aborted ? 'canceled' : classifyAiError(error)
        task.phase = task.error === 'canceled' ? 'canceled' : 'failed'
        if (task.phase === 'failed') failures += 1
        throw error
      } finally {
        caller?.removeEventListener('abort', abort)
        const index = pending.indexOf(start)
        if (index >= 0) pending.splice(index, 1)
        if (acquired) running -= 1
        task.endedAt = Date.now(); controls.delete(task.id); emit(); drain()
      }
    },
    exportDiagnostics: () => JSON.stringify({ schemaVersion: 1, tasks }, null, 2),
  }
}
export const aiTasks = createAiTasks()
