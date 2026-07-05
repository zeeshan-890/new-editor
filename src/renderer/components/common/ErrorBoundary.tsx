import { Component, type ErrorInfo, type ReactNode } from 'react'

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="h-screen flex flex-col items-center justify-center gap-3 bg-background text-foreground p-6">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted max-w-lg text-center">{this.state.error.message}</p>
          <button
            type="button"
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-card"
            onClick={() => window.location.reload()}
          >
            Reload app
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
