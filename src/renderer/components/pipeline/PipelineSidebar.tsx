import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { PipelineDashboard } from './PipelineDashboard'

export function PipelineSidebar({
  projectId,
  onOpenEditor,
  open,
  onToggle
}: {
  projectId: string
  onOpenEditor: () => void
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  if (!open) {
    return (
      <aside
        className={cn(
          'shrink-0 w-10 border-l border-border flex flex-col items-center py-3 gap-3',
          'bg-card/40 hover:bg-card/60 transition-colors'
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          title="Open script-to-video pipeline"
          aria-label="Open pipeline sidebar"
          className="p-1.5 rounded-md text-muted hover:text-foreground hover:bg-card"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="text-[10px] font-medium text-muted hover:text-foreground tracking-wide [writing-mode:vertical-rl] rotate-180 select-none"
        >
          Pipeline
        </button>
      </aside>
    )
  }

  return (
    <aside className="shrink-0 w-96 max-w-[42vw] border-l border-border flex flex-col min-h-0 bg-background">
      <div className="flex items-center justify-end px-2 py-1 border-b border-border shrink-0">
        <button
          type="button"
          onClick={onToggle}
          title="Close pipeline sidebar"
          aria-label="Close pipeline sidebar"
          className="p-1.5 rounded-md text-muted hover:text-foreground hover:bg-card"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <PipelineDashboard
          key={projectId}
          projectId={projectId}
          onOpenEditor={onOpenEditor}
          onCollapse={onToggle}
        />
      </div>
    </aside>
  )
}
