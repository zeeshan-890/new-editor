import { Upload, FileAudio, X } from 'lucide-react'
import { useEditorStore } from '@renderer/stores/editorStore'
import { cn } from '@renderer/lib/utils'

interface SidebarProps {
  onOpenFile: () => void
  onDropFile: (path: string) => void
}

export function Sidebar({ onOpenFile, onDropFile }: SidebarProps): React.JSX.Element {
  const recentFiles = useEditorStore((s) => s.recentFiles)
  const metadata = useEditorStore((s) => s.metadata)
  const error = useEditorStore((s) => s.error)
  const setError = useEditorStore((s) => s.setError)
  const loading = useEditorStore((s) => s.loading)
  const loadingMessage = useEditorStore((s) => s.loadingMessage)

  const onDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files[0]
    if (!file) return
    const path = window.electronAPI?.getPathForFile(file) ?? (file as File & { path?: string }).path
    if (path) onDropFile(path)
  }

  return (
    <aside className="w-56 border-r border-border bg-card flex flex-col shrink-0">
      <div
        className={cn(
          'm-3 p-4 border-2 border-dashed border-border rounded-lg text-center cursor-pointer hover:border-primary/50 transition-colors',
          loading && 'opacity-50 pointer-events-none'
        )}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={onOpenFile}
      >
        <Upload className="mx-auto mb-2 text-muted" size={24} />
        <p className="text-xs text-muted">Drop audio here or click to open</p>
      </div>

      {loading && (
        <div className="px-3 text-xs text-primary animate-pulse">{loadingMessage || 'Loading…'}</div>
      )}

      {metadata && (
        <div className="px-3 py-2 mx-3 mb-2 rounded bg-background text-xs">
          <div className="flex items-center gap-2 font-medium truncate">
            <FileAudio size={14} className="shrink-0 text-primary" />
            {metadata.fileName}
          </div>
          <div className="text-muted mt-1">
            {(metadata.durationMs / 1000).toFixed(1)}s · {metadata.sampleRate} Hz
          </div>
        </div>
      )}

      {error && (
        <div className="mx-3 mb-2 p-2 rounded bg-destructive/10 border border-destructive/30 text-xs text-red-300 flex gap-2">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      {recentFiles.length > 0 && (
        <div className="flex-1 overflow-y-auto px-3">
          <p className="text-[10px] uppercase tracking-wide text-muted mb-2">Recent</p>
          {recentFiles.map((f) => (
            <button
              key={f}
              className="block w-full text-left text-xs truncate py-1.5 px-2 rounded hover:bg-background text-muted hover:text-foreground"
              onClick={() => onDropFile(f)}
              title={f}
            >
              {f.split(/[/\\]/).pop()}
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
