import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  locale: 'zh-CN' | 'en-US'
  resetKey?: string
}

type State = {
  error?: Error
  lastResetKey?: string
}

export class SceneErrorBoundary extends Component<Props, State> {
  state: State = { lastResetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.lastResetKey) {
      return { error: undefined, lastResetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Brick Flow 3D scene render failure', error, info.componentStack)
  }

  private handleRetry = () => {
    this.setState({ error: undefined })
  }

  render() {
    if (!this.state.error) return this.props.children
    const zh = this.props.locale === 'zh-CN'
    return (
      <div className="scene-error-boundary" role="alert">
        <section>
          <h2>{zh ? '3D 视口遇到渲染错误' : 'The 3D viewport hit a render error'}</h2>
          <p>{zh
            ? '当前作品数据未受影响。你可以重试 3D 视口，或继续使用顶部工具栏导出与切换作品。'
            : 'Your project data is unaffected. Retry the 3D viewport, or keep using the top toolbar to export or switch projects.'}</p>
          <details>
            <summary>{zh ? '错误详情' : 'Error details'}</summary>
            <code>{this.state.error.message}</code>
          </details>
          <button type="button" onClick={this.handleRetry}>
            {zh ? '重试 3D 视口' : 'Retry 3D viewport'}
          </button>
        </section>
      </div>
    )
  }
}
