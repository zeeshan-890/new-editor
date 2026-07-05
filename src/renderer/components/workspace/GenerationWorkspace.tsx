import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Clock,
  Download,
  ImagePlus,
  Loader2,
  LogIn,
  RefreshCw,
  Sparkles,
  Video,
  X
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import {
  allowFileDrop,
  filePathFromDrop,
  imageFilesFromDataTransfer,
  isImageFile
} from '@renderer/lib/dropFiles'
import {
  galleryDragPayloadFromDataTransfer,
  setGalleryDragData,
  type GalleryDragPayload
} from '@renderer/lib/galleryDrag'
import { Button } from '../common/Button'
import { Label } from '../common/Label'
import { Switch } from '../common/Switch'
import { useProjectTabStore } from '@renderer/stores/projectTabStore'
import { useHiggsfieldStore } from '@renderer/stores/higgsfieldStore'
import type {
  HiggsfieldGenerationJob,
  ProjectGeneration,
  ProjectMedia
} from '@shared/types'
import {
  activeModeDraft,
  createEmptyTabComposerState,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  generateId
} from '@shared/types'
import { sortImageModels, pickImageModel, imageModelShortLabel } from '@shared/imageModels'
import {
  attachmentDisplayName,
  buildImageGenerationRequest,
  validateImageGenerationInput
} from '@shared/imageGeneration'

import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url)
}

function shortModelLabel(model: string): string {
  return imageModelShortLabel(model)
}

function defaultDownloadName(item: ProjectGeneration): string {
  const fromUrl = item.url.match(/\.(mp4|webm|mov|png|jpe?g|webp|gif)(\?|$)/i)?.[1]
  const ext =
    fromUrl ??
    (item.type === 'video' || isVideoUrl(item.url) ? 'mp4' : 'png')
  return `generation-${item.id.slice(0, 8)}.${ext}`
}

async function downloadGeneration(item: ProjectGeneration): Promise<void> {
  if (!window.electronAPI?.saveMediaAs) return
  await window.electronAPI.saveMediaAs({
    url: item.localPath ? undefined : item.url,
    localPath: item.localPath,
    defaultName: defaultDownloadName(item)
  })
}

export function GenerationWorkspace({
  tabId,
  projectId
}: {
  tabId: string
  projectId: string
}): React.JSX.Element {
  const project = useProjectTabStore((s) => s.projects[projectId])
  const tabDraft = useProjectTabStore((s) => s.tabDrafts[tabId] ?? createEmptyTabComposerState())
  const updateProject = useProjectTabStore((s) => s.updateProject)
  const updateModeDraft = useProjectTabStore((s) => s.updateModeDraft)
  const appendImageAttachment = useProjectTabStore((s) => s.appendImageAttachment)
  const setTabMode = useProjectTabStore((s) => s.setTabMode)
  const loadGenerationIntoTab = useProjectTabStore((s) => s.loadGenerationIntoTab)
  const trackJob = useProjectTabStore((s) => s.trackJob)
  const handleJobUpdate = useProjectTabStore((s) => s.handleJobUpdate)
  const pendingJobProjects = useProjectTabStore((s) => s.pendingJobProjects)

  const jobs = useHiggsfieldStore((s) => s.jobs)
  const queueStats = useHiggsfieldStore((s) => s.queueStats)
  const subscribeJobUpdates = useHiggsfieldStore((s) => s.subscribeJobUpdates)
  const syncJobs = useHiggsfieldStore((s) => s.syncJobs)
  const refreshHiggsfield = useHiggsfieldStore((s) => s.refreshStatus)
  const status = useHiggsfieldStore((s) => s.status)
  const login = useHiggsfieldStore((s) => s.login)
  const workspaces = useHiggsfieldStore((s) => s.workspaces)
  const selectedWorkspaceId = useHiggsfieldStore((s) => s.selectedWorkspaceId)
  const setSelectedWorkspaceId = useHiggsfieldStore((s) => s.setSelectedWorkspaceId)
  const imageModels = useHiggsfieldStore((s) => s.imageModels)

  const [error, setError] = useState<string | null>(null)
  const [lightboxItem, setLightboxItem] = useState<ProjectGeneration | null>(null)
  const [dragOverTarget, setDragOverTarget] = useState<'attachments' | 'startFrame' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const startFrameInputRef = useRef<HTMLInputElement>(null)

  const mode = tabDraft.activeMode
  const draft = activeModeDraft(tabDraft)

  useEffect(() => {
    void refreshHiggsfield()
    void syncJobs()
    const unsubJobs = subscribeJobUpdates()
    const unsubProject = window.electronAPI?.onHiggsfieldJobUpdated((job) => {
      handleJobUpdate(job)
    })
    return () => {
      unsubJobs?.()
      unsubProject?.()
    }
  }, [refreshHiggsfield, syncJobs, subscribeJobUpdates, handleJobUpdate])

  useEffect(() => {
    if (mode !== 'image') return
    if (imageModels.length === 0) return
    const ids = new Set(imageModels.map((m) => m.id))
    const currentModel = useProjectTabStore.getState().tabDrafts[tabId]?.image.model
    if (currentModel && ids.has(currentModel)) return
    updateModeDraft(tabId, 'image', { model: pickImageModel(undefined, imageModels) })
  }, [imageModels, mode, tabId, updateModeDraft])

  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      event.preventDefault()
    }
    document.addEventListener('dragover', onDragOver)
    return () => document.removeEventListener('dragover', onDragOver)
  }, [])

  useEffect(() => {
    if (!lightboxItem) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setLightboxItem(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxItem])

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-sm">
        Loading project…
      </div>
    )
  }

  const activeWorkspaceId =
    selectedWorkspaceId || workspaces.find((ws) => ws.isSelected)?.id || workspaces[0]?.id || ''

  const attachImportedMedia = (
    imported: { localPath: string; name: string },
    target: 'attachments' | 'startFrame',
    previewUrl?: string
  ): void => {
    const media: ProjectMedia = {
      id: generateId(),
      localPath: imported.localPath,
      name: imported.name,
      previewUrl
    }
    if (target === 'startFrame') {
      updateModeDraft(tabId, 'video', { videoStartFrame: media })
    } else {
      appendImageAttachment(tabId, media)
    }
    setError(null)
  }

  const importImage = async (
    sourcePath: string,
    target: 'attachments' | 'startFrame'
  ): Promise<void> => {
    if (!window.electronAPI?.importProjectMedia) {
      setError('File import is unavailable.')
      return
    }
    try {
      const imported = await window.electronAPI.importProjectMedia(projectId, sourcePath)
      attachImportedMedia(imported, target)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const importImageFile = async (
    file: File,
    target: 'attachments' | 'startFrame'
  ): Promise<void> => {
    if (!isImageFile(file)) {
      setError('Only image files can be attached.')
      return
    }

    const path = filePathFromDrop(file)
    if (path) {
      await importImage(path, target)
      return
    }

    if (!window.electronAPI?.importProjectMediaBytes) {
      setError('Could not read dropped file. Use Upload from computer instead.')
      return
    }

    try {
      const imported = await window.electronAPI.importProjectMediaBytes(
        projectId,
        file.name || 'image.png',
        await file.arrayBuffer()
      )
      attachImportedMedia(imported, target)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const importFromGalleryPayload = async (
    payload: GalleryDragPayload,
    target: 'attachments' | 'startFrame'
  ): Promise<boolean> => {
    const previewUrl = payload.url

    if (payload.localPath) {
      try {
        const imported = await window.electronAPI!.importProjectMedia(projectId, payload.localPath)
        attachImportedMedia(imported, target, previewUrl)
        return true
      } catch {
        if (previewUrl) {
          attachImportedMedia(
            { localPath: payload.localPath, name: 'Start frame' },
            target,
            previewUrl
          )
          return true
        }
      }
    }

    if (previewUrl && window.electronAPI?.resolveHiggsfieldReference) {
      try {
        const resolved = await window.electronAPI.resolveHiggsfieldReference(previewUrl)
        const imported = await window.electronAPI.importProjectMedia!(projectId, resolved.localPath)
        attachImportedMedia(imported, target, previewUrl)
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return true
      }
    }

    return false
  }

  const onFilePick = async (
    files: FileList | null,
    target: 'attachments' | 'startFrame'
  ): Promise<void> => {
    if (!files?.length) return
    for (const file of Array.from(files)) {
      await importImageFile(file, target)
      if (target === 'startFrame') break
    }
  }

  const onDropFiles = async (
    e: React.DragEvent,
    target: 'attachments' | 'startFrame'
  ): Promise<void> => {
    allowFileDrop(e)
    setDragOverTarget(null)

    const galleryPayload = galleryDragPayloadFromDataTransfer(e.dataTransfer)
    if (galleryPayload) {
      await importFromGalleryPayload(galleryPayload, target)
      return
    }

    const link = e.dataTransfer
      .getData('text/uri-list')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#') && /^https?:\/\//i.test(line))

    if (link) {
      await importFromGalleryPayload({ type: 'higgsfield-image', url: link }, target)
      return
    }

    const files = imageFilesFromDataTransfer(e.dataTransfer)
    if (files.length === 0) {
      setError('Drop a gallery image, file, or image link here.')
      return
    }

    for (const file of files) {
      await importImageFile(file, target)
      if (target === 'startFrame') break
    }
  }

  const activeJobs = jobs.filter(
    (job) =>
      pendingJobProjects[job.id] === projectId &&
      (job.status === 'queued' || job.status === 'running')
  )

  const projectQueueStats = {
    queued: activeJobs.filter((j) => j.status === 'queued').length,
    running: activeJobs.filter((j) => j.status === 'running').length
  }

  const handleGenerate = async (): Promise<void> => {
    if (!window.electronAPI?.enqueueHiggsfieldJob) return

    const tabState =
      useProjectTabStore.getState().tabDrafts[tabId] ?? createEmptyTabComposerState()

    const built = buildImageGenerationRequest({
      tabState,
      workspaceId: activeWorkspaceId || undefined,
      projectId
    })

    const validationError = validateImageGenerationInput(
      activeModeDraft(tabState),
      tabState.activeMode,
      built.effectivePrompt,
      built.referenceCount
    )
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)

    try {
      const job = await window.electronAPI.enqueueHiggsfieldJob(built.enqueue)
      trackJob(job.id, projectId, built.snapshot)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const patchDraft = (patch: Partial<typeof draft>): void => {
    updateModeDraft(tabId, mode, patch)
  }

  const removeAttachment = (mediaId: string): void => {
    patchDraft({
      imageAttachments: draft.imageAttachments.filter((m) => m.id !== mediaId)
    })
  }

  const moveAttachment = (mediaId: string, direction: -1 | 1): void => {
    const list = [...draft.imageAttachments]
    const index = list.findIndex((m) => m.id === mediaId)
    if (index < 0) return
    const next = index + direction
    if (next < 0 || next >= list.length) return
    ;[list[index], list[next]] = [list[next], list[index]]
    patchDraft({ imageAttachments: list })
  }

  return (
    <div className="flex-1 flex min-h-0 bg-background text-foreground">
      <aside className="w-80 border-r border-border flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 space-y-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-primary" />
            <input
              value={project.name}
              onChange={(e) => updateProject(projectId, { name: e.target.value })}
              className="flex-1 bg-transparent font-semibold text-sm focus:outline-none border-b border-transparent focus:border-primary"
            />
          </div>

          {tabDraft.selectedGenerationId && (
            <p className="text-[10px] text-primary rounded border border-primary/30 bg-primary/5 px-2 py-1">
              Loaded from gallery — edit and queue to generate a new variant
            </p>
          )}

          {status && !status.authenticated && (
            <Button size="sm" className="w-full" onClick={() => void login()}>
              <LogIn size={14} className="mr-1" /> Connect Higgsfield
            </Button>
          )}

          {status?.authenticated && workspaces.length > 0 && (
            <select
              value={activeWorkspaceId}
              onChange={(e) => void setSelectedWorkspaceId(e.target.value)}
              className="w-full h-8 rounded-md border border-border bg-card px-2 text-xs"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name} ({Math.floor(ws.credits).toLocaleString()} cr)
                </option>
              ))}
            </select>
          )}

          <div className="flex rounded-md border border-border overflow-hidden">
            {(['image', 'video'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setTabMode(tabId, m)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium transition-colors',
                  mode === m
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted hover:text-foreground hover:bg-card'
                )}
              >
                {m === 'image' ? <ImagePlus size={14} /> : <Video size={14} />}
                {m === 'image' ? 'Image' : 'Video'}
              </button>
            ))}
          </div>

          {mode === 'image' ? (
            <div className="space-y-1">
              <Label>Image model</Label>
              <select
                value={
                  imageModels.some((m) => m.id === draft.model)
                    ? draft.model
                    : DEFAULT_IMAGE_MODEL
                }
                onChange={(e) => patchDraft({ model: e.target.value })}
                className="w-full h-8 rounded-md border border-border bg-card px-2 text-xs"
              >
                {(imageModels.length > 0
                  ? sortImageModels(imageModels)
                  : [{ id: DEFAULT_IMAGE_MODEL, name: 'Nano Banana Pro — Text to Image' }]
                ).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-[10px] text-muted">
              Model: Kling v3.0 ({DEFAULT_VIDEO_MODEL})
            </p>
          )}
        </div>

        <div className="p-4 space-y-4 flex-1">
          <div>
            <Label>{mode === 'image' ? 'Image context' : 'Video context'}</Label>
            <textarea
              value={draft.context}
              onChange={(e) => patchDraft({ context: e.target.value })}
              rows={3}
              placeholder={
                mode === 'image'
                  ? 'Style and subject notes for image generations in this tab…'
                  : 'Motion, scene, and style notes for video in this tab…'
              }
              className="w-full mt-1 rounded-md border border-border bg-card px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <Label>Prompt</Label>
              <label className="flex items-center gap-1.5 text-[10px] text-muted cursor-pointer">
                <Switch
                  checked={draft.useContextInPrompt}
                  onChange={(checked) => patchDraft({ useContextInPrompt: checked })}
                />
                Use context
              </label>
            </div>
            <textarea
              value={draft.prompt}
              onChange={(e) => patchDraft({ prompt: e.target.value })}
              rows={4}
              placeholder={
                mode === 'image'
                  ? draft.imageAttachments.length >= 2
                    ? 'e.g. Combine #1 and #2: skeleton from #2 holding a plate with the brain from #1'
                    : 'Describe the image you want…'
                  : 'Describe the video motion and scene…'
              }
              className="w-full mt-1 rounded-md border border-border bg-card px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {mode === 'image' && draft.useContextInPrompt && draft.context.trim() && (
              <p className="mt-1 text-[10px] text-muted">
                Context is prepended to your prompt when generating.
              </p>
            )}
          </div>

          {mode === 'image' && (
            <div>
              <Label>Attached images</Label>
              <div
                className={cn(
                  'mt-1 rounded-md border border-dashed p-2 transition-colors',
                  dragOverTarget === 'attachments'
                    ? 'border-primary bg-primary/5'
                    : 'border-border'
                )}
                onDragEnterCapture={() => setDragOverTarget('attachments')}
                onDragLeaveCapture={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return
                  setDragOverTarget(null)
                }}
                onDragOverCapture={allowFileDrop}
                onDropCapture={(e) => void onDropFiles(e, 'attachments')}
              >
                <div className="flex flex-wrap gap-2">
                  {draft.imageAttachments.map((media, index) => (
                    <div key={media.id} className="flex flex-col items-center gap-0.5">
                      <div className="relative h-14 w-14 rounded border border-border overflow-hidden group">
                        <img
                          src={localMediaPathUrl(media.previewUrl ?? media.localPath)}
                          alt={media.name}
                          className="h-full w-full object-cover"
                        />
                        <span className="absolute bottom-0 left-0 right-0 bg-black/75 text-[9px] text-white text-center py-0.5 font-medium">
                          #{index + 1}
                        </span>
                        <button
                          type="button"
                          className="absolute top-0.5 right-0.5 rounded-full bg-black/70 p-0.5 opacity-0 group-hover:opacity-100"
                          onClick={() => removeAttachment(media.id)}
                        >
                          <X size={10} className="text-white" />
                        </button>
                      </div>
                      <div className="flex gap-0.5">
                        {index > 0 && (
                          <button
                            type="button"
                            className="text-[9px] text-muted hover:text-primary px-0.5"
                            title="Move earlier (lower number)"
                            onClick={() => moveAttachment(media.id, -1)}
                          >
                            ←
                          </button>
                        )}
                        {index < draft.imageAttachments.length - 1 && (
                          <button
                            type="button"
                            className="text-[9px] text-muted hover:text-primary px-0.5"
                            title="Move later (higher number)"
                            onClick={() => moveAttachment(media.id, 1)}
                          >
                            →
                          </button>
                        )}
                      </div>
                      <span className="text-[8px] text-muted max-w-14 truncate">
                        {attachmentDisplayName(media, index)}
                      </span>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-14 w-14 flex items-center justify-center rounded border border-dashed border-border text-muted hover:border-primary hover:text-primary"
                  >
                    <ImagePlus size={16} />
                  </button>
                </div>
                <button
                  type="button"
                  className="mt-2 text-[10px] text-primary hover:underline"
                  onClick={async () => {
                    const path = await window.electronAPI?.openImageFile()
                    if (path) await importImage(path, 'attachments')
                  }}
                >
                  Upload from computer
                </button>
                <p className="mt-1 text-[10px] text-muted">
                  Or drag from the gallery, a file, or an image link
                </p>
                {draft.imageAttachments.length >= 2 && (
                  <p className="mt-1 text-[10px] text-primary/90 rounded border border-primary/20 bg-primary/5 px-2 py-1">
                    Order matters: #1 is sent first, then #2. Use arrows to reorder. In your prompt say
                    what each number is (e.g. &quot;#1 = brain, #2 = skeleton, combine both&quot;).
                  </p>
                )}
              </div>
            </div>
          )}

          {mode === 'video' && (
            <>
              <div>
                <Label>Starting frame</Label>
                <div
                  className={cn(
                    'mt-1 rounded-md border border-dashed p-2 transition-colors',
                    dragOverTarget === 'startFrame'
                      ? 'border-primary bg-primary/5'
                      : 'border-border'
                  )}
                  onDragEnterCapture={() => setDragOverTarget('startFrame')}
                  onDragLeaveCapture={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return
                    setDragOverTarget(null)
                  }}
                  onDragOverCapture={allowFileDrop}
                  onDropCapture={(e) => void onDropFiles(e, 'startFrame')}
                >
                  {draft.videoStartFrame ? (
                    <div className="relative h-24 w-full rounded overflow-hidden group">
                      <img
                        src={localMediaPathUrl(draft.videoStartFrame.previewUrl ?? draft.videoStartFrame.localPath)}
                        alt="Start frame"
                        className="h-full w-full object-contain bg-black/20"
                      />
                      <button
                        type="button"
                        className="absolute top-1 right-1 rounded-full bg-black/70 p-1"
                        onClick={() => patchDraft({ videoStartFrame: null })}
                      >
                        <X size={12} className="text-white" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center py-4 text-xs text-muted gap-2">
                      <ImagePlus size={20} />
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => startFrameInputRef.current?.click()}
                      >
                        Upload or drag image
                      </button>
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={async () => {
                          const path = await window.electronAPI?.openImageFile()
                          if (path) await importImage(path, 'startFrame')
                        }}
                      >
                        Choose from computer
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <Label>Duration (seconds)</Label>
                <select
                  value={draft.videoDuration}
                  onChange={(e) => patchDraft({ videoDuration: Number(e.target.value) })}
                  className="w-full mt-1 h-9 rounded-md border border-border bg-card px-2 text-sm"
                >
                  {[3, 4, 5, 6, 8, 10].map((d) => (
                    <option key={d} value={d}>
                      {d}s
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {error && (
            <p className="text-xs text-red-400 rounded border border-destructive/30 bg-destructive/10 p-2">
              {error}
            </p>
          )}

          {(projectQueueStats.running > 0 || projectQueueStats.queued > 0) && (
            <p className="text-xs text-primary animate-pulse">
              Background queue · Running {projectQueueStats.running} · Queued {projectQueueStats.queued}
              {queueStats.running + queueStats.queued > projectQueueStats.running + projectQueueStats.queued
                ? ` (${queueStats.running + queueStats.queued} total app-wide)`
                : ''}
            </p>
          )}

          <Button
            className="w-full"
            disabled={!status?.authenticated}
            onClick={() => void handleGenerate()}
          >
            Queue {mode} generation
          </Button>

          <Button size="sm" variant="outline" className="w-full" onClick={() => void refreshHiggsfield()}>
            <RefreshCw size={14} className="mr-1" /> Refresh account
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void onFilePick(e.target.files, 'attachments')
            e.target.value = ''
          }}
        />
        <input
          ref={startFrameInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void onFilePick(e.target.files, 'startFrame')
            e.target.value = ''
          }}
        />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="px-4 py-2 border-b border-border flex items-center justify-between shrink-0">
          <span className="text-sm font-medium">
            Project gallery ({project.generations.length}
            {activeJobs.length > 0 ? ` · ${activeJobs.length} in progress` : ''})
          </span>
          <span className="text-[10px] text-muted">Shared gallery · tab composer is isolated</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {project.generations.length === 0 && activeJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted text-sm gap-2">
              <Sparkles size={32} className="text-primary/40" />
              <p>No generations yet. Queue images or videos — they run in the background.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {activeJobs.map((job) => (
                <PendingJobTile key={job.id} job={job} />
              ))}
              {project.generations.map((item, index) => (
                <GalleryTile
                  key={item.id}
                  item={item}
                  index={project.generations.length - index}
                  selected={tabDraft.selectedGenerationId === item.id}
                  onPreview={() => setLightboxItem(item)}
                  onLoadSettings={() => void loadGenerationIntoTab(tabId, projectId, item)}
                  onDownload={() => void downloadGeneration(item)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {lightboxItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/92 p-4"
          onClick={() => setLightboxItem(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Generation preview"
        >
          <div
            className="flex max-w-[96vw] max-h-[92vh] flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative inline-flex max-w-[96vw] max-h-[78vh]">
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-lg border border-white/15 bg-black/55 p-1 shadow-lg backdrop-blur-sm">
                <button
                  type="button"
                  className="rounded-md p-1.5 text-white/85 hover:bg-white/10 hover:text-white"
                  title="Load into sidebar"
                  onClick={() => {
                    loadGenerationIntoTab(tabId, projectId, lightboxItem)
                    setLightboxItem(null)
                  }}
                >
                  <Sparkles size={18} />
                </button>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-white/85 hover:bg-white/10 hover:text-white"
                  title="Download"
                  onClick={() => void downloadGeneration(lightboxItem)}
                >
                  <Download size={18} />
                </button>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-white/85 hover:bg-white/10 hover:text-white"
                  title="Close"
                  onClick={() => setLightboxItem(null)}
                >
                  <X size={18} />
                </button>
              </div>
              {lightboxItem.type === 'video' || isVideoUrl(lightboxItem.url) ? (
                <video
                  src={lightboxItem.url}
                  controls
                  autoPlay
                  className="max-h-[78vh] max-w-[96vw] rounded-lg shadow-2xl"
                />
              ) : (
                <img
                  src={lightboxItem.url}
                  alt={lightboxItem.prompt}
                  className="max-h-[78vh] max-w-[96vw] rounded-lg object-contain shadow-2xl"
                />
              )}
            </div>
            <div className="max-w-2xl text-center text-sm text-white/80 px-4">
              <p className="font-medium text-white">{shortModelLabel(lightboxItem.model)}</p>
              <p className="mt-1 text-white/70">{lightboxItem.prompt || '—'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function GalleryTile({
  item,
  index,
  selected,
  onPreview,
  onLoadSettings,
  onDownload
}: {
  item: ProjectGeneration
  index: number
  selected: boolean
  onPreview: () => void
  onLoadSettings: () => void
  onDownload: () => void
}): React.JSX.Element {
  const isVideo = item.type === 'video' || isVideoUrl(item.url)
  const canDrag = !isVideo
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClick = (): void => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      onPreview()
      clickTimer.current = null
    }, 220)
  }

  const handleDoubleClick = (): void => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
    }
    onLoadSettings()
  }

  return (
    <div
      draggable={canDrag}
      onDragStart={(e) => {
        if (!canDrag) {
          e.preventDefault()
          return
        }
        e.stopPropagation()
        setGalleryDragData(e.dataTransfer, item)
      }}
      className={cn(
        'group relative aspect-square rounded-lg border overflow-hidden bg-card cursor-pointer transition-shadow',
        canDrag && 'cursor-grab active:cursor-grabbing',
        selected
          ? 'border-primary ring-2 ring-primary/60 shadow-lg shadow-primary/10'
          : 'border-border hover:border-primary/40'
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {isVideo ? (
        <video
          src={item.url}
          muted
          playsInline
          className="h-full w-full object-cover pointer-events-none select-none"
        />
      ) : (
        <img
          src={item.url}
          alt={item.prompt}
          draggable={false}
          className="h-full w-full object-cover pointer-events-none select-none"
        />
      )}

      <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            isVideo ? 'bg-violet-600/95 text-white' : 'bg-emerald-600/95 text-white'
          )}
        >
          {isVideo ? 'Video' : 'Image'}
        </span>
        <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white">
          #{index}
        </span>
        <span className="rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white/90 max-w-[120px] truncate">
          {shortModelLabel(item.model)}
        </span>
      </div>

      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100">
        <button
          type="button"
          className="rounded-full bg-black/50 p-1 hover:bg-black/70"
          title="Load settings into sidebar"
          onClick={(e) => {
            e.stopPropagation()
            onLoadSettings()
          }}
        >
          <Sparkles size={12} className="text-white" />
        </button>
        <button
          type="button"
          className="rounded-full bg-black/50 p-1 hover:bg-black/70"
          title="Download"
          onClick={(e) => {
            e.stopPropagation()
            onDownload()
          }}
        >
          <Download size={12} className="text-white" />
        </button>
      </div>

      {selected && (
        <span className="absolute bottom-10 left-2 rounded bg-primary/90 px-1.5 py-0.5 text-[9px] font-medium text-white">
          Loaded in sidebar
        </span>
      )}

      {canDrag && (
        <span className="absolute bottom-10 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white/80 opacity-0 group-hover:opacity-100">
          Drag to attach
        </span>
      )}

      {!canDrag && (
        <span className="absolute bottom-10 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white/80 opacity-0 group-hover:opacity-100">
          Double-click to edit
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-2 pt-6">
        <p className="text-[10px] text-white line-clamp-2">{item.prompt || '—'}</p>
      </div>
    </div>
  )
}

function PendingJobTile({ job }: { job: HiggsfieldGenerationJob }): React.JSX.Element {
  const isVideo = job.category === 'video'

  return (
    <div className="relative aspect-square rounded-lg border border-primary/40 overflow-hidden bg-card ring-2 ring-primary/20">
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-background/80 p-3 text-center">
        {job.status === 'queued' ? (
          <Clock size={22} className="text-muted" />
        ) : (
          <Loader2 size={24} className="animate-spin text-primary" />
        )}
        <span className="text-[10px] text-muted line-clamp-3">
          {job.progressMessage ?? (job.status === 'queued' ? 'Queued…' : 'Generating…')}
        </span>
      </div>
      <div className="absolute top-2 left-2 flex flex-col gap-1">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
            isVideo ? 'bg-violet-600/90 text-white' : 'bg-emerald-600/90 text-white'
          )}
        >
          {isVideo ? 'Video' : 'Image'}
        </span>
        <span className="rounded bg-amber-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white uppercase">
          {job.status}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 p-2">
        <p className="text-[10px] text-white line-clamp-2">{job.prompt.trim() || '—'}</p>
      </div>
      {job.status === 'failed' && job.error && (
        <div className="absolute inset-x-1 bottom-12 flex items-start gap-1 rounded bg-destructive/90 px-1 py-0.5 text-[9px] text-white">
          <AlertCircle size={10} className="shrink-0 mt-0.5" />
          <span className="line-clamp-2">{job.error}</span>
        </div>
      )}
    </div>
  )
}
