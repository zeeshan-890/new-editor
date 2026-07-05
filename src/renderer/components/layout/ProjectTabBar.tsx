import { Plus, X, Scissors, FolderOpen, Sparkles } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useProjectTabStore } from '@renderer/stores/projectTabStore'
import type { AppTabKind } from '@shared/types'

function tabIcon(kind: AppTabKind): React.JSX.Element {
  if (kind === 'editor') return <Scissors size={12} className="shrink-0" />
  return <Sparkles size={12} className="shrink-0" />
}

export function ProjectTabBar(): React.JSX.Element {
  const tabs = useProjectTabStore((s) => s.tabs)
  const activeTabId = useProjectTabStore((s) => s.activeTabId)
  const newTabMenuOpen = useProjectTabStore((s) => s.newTabMenuOpen)
  const projectList = useProjectTabStore((s) => s.projectList)
  const setActiveTab = useProjectTabStore((s) => s.setActiveTab)
  const closeTab = useProjectTabStore((s) => s.closeTab)
  const setNewTabMenuOpen = useProjectTabStore((s) => s.setNewTabMenuOpen)
  const openNewProjectTab = useProjectTabStore((s) => s.openNewProjectTab)
  const openExistingProjectTab = useProjectTabStore((s) => s.openExistingProjectTab)
  const openEditorTab = useProjectTabStore((s) => s.openEditorTab)
  const openProjectEditorTab = useProjectTabStore((s) => s.openProjectEditorTab)

  return (
    <div className="relative flex items-end gap-0.5 px-2 pt-2 pb-0 bg-card border-b border-border shrink-0 min-h-[40px]">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            'group flex items-center gap-1.5 max-w-[200px] rounded-t-md border border-b-0 px-3 py-1.5 text-xs cursor-pointer transition-colors',
            activeTabId === tab.id
              ? 'bg-background border-border text-foreground'
              : 'bg-card/60 border-transparent text-muted hover:text-foreground hover:bg-background/60'
          )}
          onClick={() => setActiveTab(tab.id)}
        >
          {tabIcon(tab.kind)}
          <span className="truncate">{tab.title}</span>
          {tabs.length > 1 && (
            <button
              type="button"
              className="opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-border/80"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              aria-label="Close tab"
            >
              <X size={12} />
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        className="flex items-center justify-center w-8 h-8 rounded-md text-muted hover:text-foreground hover:bg-background/60 mb-0.5"
        onClick={() => setNewTabMenuOpen(!newTabMenuOpen)}
        aria-label="New tab"
      >
        <Plus size={16} />
      </button>

      {newTabMenuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setNewTabMenuOpen(false)} />
          <div className="absolute left-2 top-full z-50 mt-1 w-72 rounded-md border border-border bg-card shadow-xl p-2 space-y-1">
            <button
              type="button"
              className="w-full text-left rounded px-3 py-2 text-sm hover:bg-background flex items-center gap-2"
              onClick={() => void openNewProjectTab()}
            >
              <Sparkles size={14} className="text-primary" />
              New generation project
            </button>
            <button
              type="button"
              className="w-full text-left rounded px-3 py-2 text-sm hover:bg-background flex items-center gap-2"
              onClick={() => void openEditorTab()}
            >
              <Scissors size={14} className="text-primary" />
              Blank video editor
            </button>
            {projectList.length > 0 && (
              <>
                <div className="border-t border-border my-1 pt-1 px-2 text-[10px] text-muted uppercase tracking-wide flex items-center gap-1">
                  <FolderOpen size={10} /> Existing projects
                </div>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {projectList.map((project) => (
                    <div key={project.id} className="flex gap-0.5">
                      <button
                        type="button"
                        className="flex-1 text-left rounded px-3 py-1.5 text-xs hover:bg-background"
                        onClick={() => void openExistingProjectTab(project.id)}
                      >
                        <span className="font-medium">{project.name}</span>
                        <span className="text-muted ml-1">
                          · {project.generationCount} items · {project.mode}
                        </span>
                      </button>
                      <button
                        type="button"
                        title="Open video editor for this project"
                        className="shrink-0 rounded px-2 py-1.5 text-xs hover:bg-background text-primary"
                        onClick={() => void openProjectEditorTab(project.id)}
                      >
                        <Scissors size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
