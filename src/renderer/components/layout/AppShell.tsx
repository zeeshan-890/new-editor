import { useEffect, useState } from 'react'
import { LogIn, RefreshCw, X } from 'lucide-react'
import { ProjectTabBar } from './ProjectTabBar'
import { VideoEditorShell } from '../video-editor/VideoEditorShell'
import { GenerationWorkspace } from '../workspace/GenerationWorkspace'
import { ProjectsPage } from '../projects/ProjectsPage'
import { Button } from '../common/Button'
import { useProjectTabStore } from '@renderer/stores/projectTabStore'
import { useHiggsfieldStore } from '@renderer/stores/higgsfieldStore'
import { startBackgroundServices } from '@renderer/lib/backgroundServices'
import { isHiggsfieldAuthFailureMessage } from '@shared/higgsfieldAuth'

export function AppShell(): React.JSX.Element {
  const initialized = useProjectTabStore((s) => s.initialized)
  const init = useProjectTabStore((s) => s.init)
  const tabs = useProjectTabStore((s) => s.tabs)
  const activeTabId = useProjectTabStore((s) => s.activeTabId)
  const projectsPageOpen = useProjectTabStore((s) => s.projectsPageOpen)
  const flushProjectSaves = useProjectTabStore((s) => s.flushProjectSaves)

  const status = useHiggsfieldStore((s) => s.status)
  const hfError = useHiggsfieldStore((s) => s.error)
  const statusLoading = useHiggsfieldStore((s) => s.statusLoading)
  const login = useHiggsfieldStore((s) => s.login)
  const refreshStatus = useHiggsfieldStore((s) => s.refreshStatus)
  const setError = useHiggsfieldStore((s) => s.setError)
  const [authBannerDismissed, setAuthBannerDismissed] = useState(false)

  const sessionNeedsReconnect =
    status != null &&
    !statusLoading &&
    (!status.authenticated || (hfError != null && isHiggsfieldAuthFailureMessage(hfError)))

  useEffect(() => {
    if (status?.authenticated) setAuthBannerDismissed(false)
  }, [status?.authenticated])

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
      {sessionNeedsReconnect && !authBannerDismissed && (
        <div className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 flex items-center gap-3">
          <p className="flex-1 text-xs text-amber-800 dark:text-amber-100">
            {hfError && isHiggsfieldAuthFailureMessage(hfError)
              ? hfError
              : status?.statusMessage?.toLowerCase().includes('expired')
                ? 'Higgsfield session expired. Reconnect to keep generating.'
                : 'Higgsfield is not connected. Sign in to generate images and videos.'}
          </p>
          <Button size="sm" onClick={() => void login()}>
            <LogIn size={14} className="mr-1" /> Reconnect
          </Button>
          <Button size="sm" variant="outline" onClick={() => void refreshStatus()}>
            <RefreshCw size={14} className="mr-1" /> Refresh
          </Button>
          <button
            type="button"
            className="rounded p-1 text-amber-800/70 hover:bg-amber-500/20 dark:text-amber-100/70"
            title="Dismiss"
            onClick={() => {
              setAuthBannerDismissed(true)
              setError(null)
            }}
            aria-label="Dismiss session banner"
          >
            <X size={14} />
          </button>
        </div>
      )}
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
