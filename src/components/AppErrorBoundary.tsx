import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clearAllLocalAppData } from '../lib/localData'

type Props = { children: ReactNode }
type State = { error?: Error; clearing: boolean }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { clearing: false }

  static getDerivedStateFromError(error: Error): State {
    return { error, clearing: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Brick Flow render failure', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    const zh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
    return (
      <main className="app-error-boundary">
        <section>
          <p className="eyebrow">brick-flow-agent</p>
          <h1>{zh ? '工作区遇到错误' : 'The workspace hit an error'}</h1>
          <p>{zh
            ? '你的项目草稿仍保存在浏览器中。可以先重新载入；如果损坏的本地数据导致错误，再清除本地数据。'
            : 'Your project draft is still stored in this browser. Reload first; clear local data only if corrupted browser data keeps causing the error.'}</p>
          <details>
            <summary>{zh ? '错误详情' : 'Error details'}</summary>
            <code>{this.state.error.message}</code>
          </details>
          <div>
            <button type="button" onClick={() => window.location.reload()}>{zh ? '重新载入' : 'Reload'}</button>
            <button
              type="button"
              className="danger-action"
              disabled={this.state.clearing}
              onClick={async () => {
                const confirmed = window.confirm(zh
                  ? '这会删除项目草稿、自定义素材、API 配置和所有偏好。继续吗？'
                  : 'This deletes project drafts, custom assets, API settings, and all preferences. Continue?')
                if (!confirmed) return
                this.setState({ clearing: true })
                const cleared = await clearAllLocalAppData()
                if (!cleared) {
                  window.alert(zh
                    ? '请关闭其他 Brick Flow 标签页后再试。'
                    : 'Close other Brick Flow tabs and try again.')
                  this.setState({ clearing: false })
                  return
                }
                window.location.reload()
              }}
            >
              {zh ? '清除本地数据' : 'Clear local data'}
            </button>
          </div>
        </section>
      </main>
    )
  }
}
