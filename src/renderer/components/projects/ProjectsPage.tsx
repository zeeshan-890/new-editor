import { useMemo, useState } from 'react'
import { FolderOpen, Scissors, Trash2 } from 'lucide-react'
import { Button } from '../common/Button'
import { useProjectTabStore } from '@renderer/stores/projectTabStore'
import { shortProjectId } from '@shared/types'

export function ProjectsPage(): React.JSX.Element {
  const projectList = useProjectTabStore((s) => s.projectList)
  const openExistingProjectTab = useProjectTabStore((s) => s.openExistingProjectTab)
  const openProjectEditorTab = useProjectTabStore((s) => s.openProjectEditorTab)
  const deleteProjectAndCloseTabs = useProjectTabStore((s) => s.deleteProjectAndCloseTabs)
  const refreshProjectList = useProjectTabStore((s) => s.refreshProjectList)
  const [query, setQuery] = useState('')
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projectList
    return projectList.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        shortProjectId(p.id).toLowerCase().includes(q)
    )
  }, [projectList, query])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects..."
          className="h-9 flex-1 rounded-md border border-border bg-card px-3 text-sm"
        />
        <Button size="sm" variant="outline" onClick={() => void refreshProjectList()}>
          Refresh
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm text-muted">No projects found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((project) => (
            <div key={project.id} className="rounded-md border border-border bg-card p-3 space-y-3">
              <div>
                <p className="text-sm font-medium truncate">{project.name}</p>
                <p className="text-[10px] text-muted font-mono truncate" title={project.id}>
                  ID {shortProjectId(project.id)}
                </p>
                <p className="text-xs text-muted">
                  Created {new Date(project.createdAt).toLocaleString()}
                </p>
                <p className="text-xs text-muted">
                  {project.generationCount} items · updated {new Date(project.updatedAt).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => void openExistingProjectTab(project.id)}>
                  <FolderOpen size={13} className="mr-1" /> Open
                </Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => void openProjectEditorTab(project.id)}>
                  <Scissors size={13} className="mr-1" /> Editor
                </Button>
              </div>
              <Button
                size="sm"
                variant="destructive"
                className="w-full"
                disabled={busyDeleteId === project.id}
                onClick={async () => {
                  if (!window.confirm(`Delete project "${project.name}"? This cannot be undone.`)) return
                  setBusyDeleteId(project.id)
                  await deleteProjectAndCloseTabs(project.id)
                  setBusyDeleteId(null)
                }}
              >
                <Trash2 size={13} className="mr-1" /> Delete
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
