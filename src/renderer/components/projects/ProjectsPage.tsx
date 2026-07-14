import { useMemo, useState } from 'react'
import { CheckSquare, FolderOpen, Scissors, Square, Trash2 } from 'lucide-react'
import { Button } from '../common/Button'
import { cn } from '@renderer/lib/utils'
import { useProjectTabStore } from '@renderer/stores/projectTabStore'
import { shortProjectId } from '@shared/types'

export function ProjectsPage(): React.JSX.Element {
  const projectList = useProjectTabStore((s) => s.projectList)
  const openExistingProjectTab = useProjectTabStore((s) => s.openExistingProjectTab)
  const openProjectEditorTab = useProjectTabStore((s) => s.openProjectEditorTab)
  const deleteProjectAndCloseTabs = useProjectTabStore((s) => s.deleteProjectAndCloseTabs)
  const deleteProjectsAndCloseTabs = useProjectTabStore((s) => s.deleteProjectsAndCloseTabs)
  const refreshProjectList = useProjectTabStore((s) => s.refreshProjectList)
  const [query, setQuery] = useState('')
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

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

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((project) => selectedIds.has(project.id))
  const selectedCount = [...selectedIds].filter((id) =>
    filtered.some((project) => project.id === id)
  ).length

  const toggleSelected = (projectId: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const toggleSelectAllFiltered = (): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const project of filtered) next.delete(project.id)
      } else {
        for (const project of filtered) next.add(project.id)
      }
      return next
    })
  }

  const clearSelection = (): void => setSelectedIds(new Set())

  const deleteOne = async (projectId: string, projectName: string): Promise<void> => {
    if (
      !window.confirm(
        `Delete project "${projectName}"?\n\nThis permanently removes the project folder, media, generations, and pipeline data. This cannot be undone.`
      )
    ) {
      return
    }
    setBusyDeleteId(projectId)
    try {
      await deleteProjectAndCloseTabs(projectId)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(projectId)
        return next
      })
    } finally {
      setBusyDeleteId(null)
    }
  }

  const deleteSelected = async (): Promise<void> => {
    const ids = filtered.filter((p) => selectedIds.has(p.id)).map((p) => p.id)
    if (ids.length === 0) return
    if (
      !window.confirm(
        `Delete ${ids.length} selected project${ids.length === 1 ? '' : 's'}?\n\nThis permanently removes each project folder, media, generations, and pipeline data. This cannot be undone.`
      )
    ) {
      return
    }
    setBulkDeleting(true)
    try {
      const deleted = await deleteProjectsAndCloseTabs(ids)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const id of ids) next.delete(id)
        return next
      })
      if (deleted < ids.length) {
        window.alert(`Deleted ${deleted} of ${ids.length} projects. Some folders could not be removed.`)
      }
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects..."
          className="h-9 flex-1 min-w-[12rem] rounded-md border border-border bg-card px-3 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={filtered.length === 0}
          onClick={toggleSelectAllFiltered}
        >
          {allFilteredSelected ? (
            <>
              <CheckSquare size={13} className="mr-1" /> Deselect all
            </>
          ) : (
            <>
              <Square size={13} className="mr-1" /> Select all
            </>
          )}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void refreshProjectList()}>
          Refresh
        </Button>
      </div>

      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
          <p className="flex-1 text-xs">
            {selectedCount} project{selectedCount === 1 ? '' : 's'} selected — delete removes all
            project files and media.
          </p>
          <Button size="sm" variant="outline" disabled={bulkDeleting} onClick={clearSelection}>
            Clear
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={bulkDeleting}
            onClick={() => void deleteSelected()}
          >
            <Trash2 size={13} className="mr-1" />
            {bulkDeleting ? 'Deleting…' : `Delete selected (${selectedCount})`}
          </Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-sm text-muted">No projects found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((project) => {
            const selected = selectedIds.has(project.id)
            return (
              <div
                key={project.id}
                className={cn(
                  'rounded-md border bg-card p-3 space-y-3',
                  selected ? 'border-primary ring-1 ring-primary/30' : 'border-border'
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    className="mt-0.5 shrink-0 rounded p-0.5 text-muted hover:text-foreground"
                    title={selected ? 'Deselect' : 'Select'}
                    onClick={() => toggleSelected(project.id)}
                  >
                    {selected ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{project.name}</p>
                    <p className="text-[10px] text-muted font-mono truncate" title={project.id}>
                      ID {shortProjectId(project.id)}
                    </p>
                    <p className="text-xs text-muted">
                      Created {new Date(project.createdAt).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted">
                      {project.generationCount} items · updated{' '}
                      {new Date(project.updatedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => void openExistingProjectTab(project.id)}
                  >
                    <FolderOpen size={13} className="mr-1" /> Open
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => void openProjectEditorTab(project.id)}
                  >
                    <Scissors size={13} className="mr-1" /> Editor
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  className="w-full"
                  disabled={busyDeleteId === project.id || bulkDeleting}
                  onClick={() => void deleteOne(project.id, project.name)}
                >
                  <Trash2 size={13} className="mr-1" /> Delete
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
