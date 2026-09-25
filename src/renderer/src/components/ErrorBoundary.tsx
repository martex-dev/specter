import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

interface Props {
  name: string
  children: ReactNode
  /** Compact rendering for small containers (panels, HUD). */
  compact?: boolean
  fallback?: ReactNode
}

/** Isolates a feature so a rendering error never takes down the browser. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}] crashed`, error, info.componentStack)
    window.specter?.invoke('logs:write', 'error', this.props.name, `${error.message}\n${(info.componentStack ?? '').slice(0, 800)}`).catch(() => undefined)
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    if (this.props.compact) return <span className="dim" title={this.state.error.message}>⚠</span>
    return (
      <div className="empty" role="alert">
        <AlertTriangle size={24} className="warn" />
        <div style={{ color: 'var(--fg-1)' }}>{this.props.name} ran into a problem</div>
        <code className="mono dim" style={{ fontSize: 11, maxWidth: 520, whiteSpace: 'pre-wrap' }}>{this.state.error.message}</code>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          <RotateCw size={13} /> Try again
        </button>
      </div>
    )
  }
}
