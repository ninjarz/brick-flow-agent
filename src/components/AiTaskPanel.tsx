import { aiTasks, type AiTask } from '../lib/aiTasks'
import { useI18n } from '../lib/i18n'
export const AiTaskPanel = ({ tasks }: { tasks: AiTask[] }) => {
  const { locale } = useI18n()
  const zh = locale === 'zh-CN'
  const phases = { queued: '排队', requesting: '请求中', receiving: '接收中', validating: '校验中', executing: '执行中', done: '完成', canceled: '已取消', failed: '失败' }
  return <details className="project-manager"><summary>{zh ? 'AI 任务' : 'AI tasks'} · {tasks.filter(item => !item.endedAt).length}</summary>
    <p>{zh ? '响应完成后由对应功能校验并执行。失败请在原功能重试，剧情不会在此自动重放。' : 'Each feature validates and applies completed responses. Retry from the original feature; story actions are not replayed here.'}</p>
    {(['concurrency', 'requests', 'outputTokens', 'consecutiveFailures'] as const).map(key => <label key={key}>{({ concurrency: '并发数', requests: '本会话请求上限', outputTokens: '单次输出 token 上限', consecutiveFailures: '连续失败上限' })[key]} <input aria-label={key} type="number" min={1} max={key === 'concurrency' ? 4 : undefined} defaultValue={aiTasks.getLimits()[key]} onBlur={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 1) aiTasks.configure({ ...aiTasks.getLimits(), [key]: value }) }} /></label>)}
    <ol>{tasks.slice(-20).reverse().map(task => <li key={task.id}>{task.kind} · {zh ? phases[task.phase] : task.phase} {task.error && `(${task.error})`} · {task.outputTokens ?? '?'} tokens {!task.endedAt && <button onClick={() => aiTasks.cancel(task.id)}>{zh ? '取消' : 'Cancel'}</button>}</li>)}</ol>
    <button onClick={() => { const url = URL.createObjectURL(new Blob([aiTasks.exportDiagnostics()], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'ai-diagnostics.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}>{zh ? '导出诊断（不含内容和密钥）' : 'Export diagnostics (no content or keys)'}</button>
  </details>
}
