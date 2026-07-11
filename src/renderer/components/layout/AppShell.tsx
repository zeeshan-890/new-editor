import { useEffect } from 'react'
import { ProjectTabBar } from './ProjectTabBar'
import { VideoEditorShell } from '../video-editor/VideoEditorShell'
import { GenerationWorkspace } from '../workspace/GenerationWorkspace'
import { ProjectsPage } from '../projects/ProjectsPage'
import { useProjectTabStore } from '@renderer/stores/projectTabStore'
import { startBackgroundServices } from '@renderer/lib/backgroundServices'

export function AppShell(): React.JSX.Element {
  const initialized = useProjectTabStore((s) => s.initialized)
  const init = useProjectTabStore((s) => s.init)
  const tabs = useProjectTabStore((s) => s.tabs)
  const activeTabId = useProjectTabStore((s) => s.activeTabId)
  const projectsPageOpen = useProjectTabStore((s) => s.projectsPageOpen)
  const flushProjectSaves = useProjectTabStore((s) => s.flushProjectSaves)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (!initialized) return
    return startBackgroundServices()
  }, [initialized])

  useEffect(() => {
    const onBeforeUnload = (): void => {
      void flushProjectSaves()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [flushProjectSaves])

  const activeTab = tabs.find((t) => t.id === activeTabId)

  if (!initialized) {
    return (
      <div className="h-screen flex items-center justify-center bg-background text-muted text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <ProjectTabBar />
      <div className="flex-1 flex min-h-0">
        {projectsPageOpen ? (
          <ProjectsPage />
        ) : activeTab?.kind === 'editor' ? (
          <VideoEditorShell embedded tabId={activeTab.id} projectId={activeTab.projectId} />
        ) : activeTab?.projectId ? (
          <GenerationWorkspace tabId={activeTab.id} projectId={activeTab.projectId} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted text-sm">
            No project selected
          </div>
        )}
      </div>
    </div>
  )
}
