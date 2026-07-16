import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import {
  Download,
  ImagePlus,
  LogIn,
  RefreshCw,
  Sparkles,
  Trash2,
  Video,
  X,
  Scissors,
  PanelRightOpen
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import {
  allowFileDrop,
  filePathFromDrop,
  imageFilesFromClipboard,
  imageFilesFromPasteEvent,
  imageFilesFromDataTransfer,
  isImageFile
} from '@renderer/lib/dropFiles'
import {
  galleryDragPayloadFromDataTransfer,
  type GalleryDragPayload
} from '@renderer/lib/galleryDrag'
import { Button } from '../common/Button'
import { Label } from '../common/Label'
import { MediaLightbox } from '../common/MediaLightbox'
import { Switch } from '../common/Switch'
import { useProjectTabStore } from '@renderer/stores/projectTabStore'
import { useHiggsfieldStore } from '@renderer/stores/higgsfieldStore'
import { isHiggsfieldAuthFailureMessage } from '@shared/higgsfieldAuth'
import type {
  ProjectGeneration,
  ProjectMedia
} from '@shared/types'
import {
  activeModeDraft,
  clampAutoExtraDurationSeconds,
  createEmptyTabComposerState,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  DEFAULT_ASPECT_RATIO,
  MANUAL_VIDEO_DURATION_SECONDS,
  generateId,
  shortProjectId
} from '@shared/types'
import { pickImageModel, imageModelShortLabel } from '@shared/imageModels'
import {
  attachmentDisplayName,
  buildImageGenerationRequest,
  resolveVideoDurationSeconds,
  validateImageGenerationInput
} from '@shared/imageGeneration'

import {
  importGenerationIntoEditor,
  generationVideoSrc
} from '@renderer/lib/projectEditorMedia'
import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'
import { ProjectGalleryPreview } from './ProjectGalleryPreview'
import { GalleryHeaderCounts } from './GalleryHeaderCounts'
import { useProjectGallery } from '@renderer/hooks/useProjectGallery'
import { PipelineSidebar } from '../pipeline/PipelineSidebar'
import {
  PipelineSegmentTabBar,
  PipelineSegmentTabContent,
  type PipelineSegmentTab
} from '../pipeline/PipelineSegmentTabs'
import {
  getProjectPipeline,
  updateSegmentInPipeline,
  usePipelineStore
} from '@renderer/stores/pipelineStore'
import {
  createEmptyPipelineState,
  normalizePipelineState,
  type ScriptSegment,
  resolvePendingSegmentJobId
} from '@shared/segmentPipeline'
import { findPipelineSegmentForGeneration } from '@shared/pipelineImageRefs'

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

async function downloadGenerations(items: ProjectGeneration[]): Promise<{
  dir: string | null
  saved: number
  failed: string[]
}> {
  if (items.length === 0) return { dir: null, saved: 0, failed: [] }
  if (!window.electronAPI?.saveMediaManyAs) {
    throw new Error('Batch download is unavailable. Fully restart the app (stop npm run dev and start again), then retry.')
  }
  return window.electronAPI.saveMediaManyAs({
    items: items.map((item) => ({
      url: item.localPath ? undefined : item.url,
      localPath: item.localPath,
      defaultName: defaultDownloadName(item)
    }))
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
  const loadSegmentIntoTab = useProjectTabStore((s) => s.loadSegmentIntoTab)
  const updateTabDraft = useProjectTabStore((s) => s.updateTabDraft)
  const updateProjectPipelineState = useProjectTabStore((s) => s.updateProjectPipelineState)
  const approveSegmentImage = useProjectTabStore((s) => s.approveSegmentImage)
  const discardPendingSegmentImage = useProjectTabStore((s) => s.discardPendingSegmentImage)
  const deleteProjectGeneration = useProjectTabStore((s) => s.deleteProjectGeneration)
  const trackJob = useProjectTabStore((s) => s.trackJob)
  const pendingJobProjects = useProjectTabStore((s) => s.pendingJobProjects)
  const pendingJobConfigs = useProjectTabStore((s) => s.pendingJobConfigs)
  const openProjectEditorTab = useProjectTabStore((s) => s.openProjectEditorTab)

  const jobs = useHiggsfieldStore((s) => s.jobs)
  const queueStats = useHiggsfieldStore((s) => s.queueStats)
  const syncJobs = useHiggsfieldStore((s) => s.syncJobs)
  const refreshHiggsfield = useHiggsfieldStore((s) => s.refreshStatus)
  const status = useHiggsfieldStore((s) => s.status)
  const login = useHiggsfieldStore((s) => s.login)
  const workspaces = useHiggsfieldStore((s) => s.workspaces)
  const selectedWorkspaceId = useHiggsfieldStore((s) => s.selectedWorkspaceId)
  const imageModels = useHiggsfieldStore((s) => s.imageModels)
  const hfError = useHiggsfieldStore((s) => s.error)

  const [error, setError] = useState<string | null>(null)
  const [lightboxItem, setLightboxItem] = useState<ProjectGeneration | null>(null)
  const [dragOverTarget, setDragOverTarget] = useState<'attachments' | 'startFrame' | null>(null)
  const [pipelineOpen, setPipelineOpen] = useState(true)
  const [mainTab, setMainTab] = useState<PipelineSegmentTab>('preview')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const startFrameInputRef = useRef<HTMLInputElement>(null)

  const mode = tabDraft.activeMode
  const draft = activeModeDraft(tabDraft)

  useEffect(() => {
    void refreshHiggsfield()
    void syncJobs()
  }, [refreshHiggsfield, syncJobs])

  // Keep freeform composer aligned with Pipeline sidebar defaults
  useEffect(() => {
    if (mode !== 'image') return
    const model = pickImageModel(
      project?.selectedImageModel || project?.pipeline?.imageModel,
      imageModels
    )
    const current = useProjectTabStore.getState().tabDrafts[tabId]?.image
    const aspect =
      project?.pipeline?.styleLock?.aspectRatio ||
      current?.aspectRatio ||
      DEFAULT_ASPECT_RATIO
    if (current?.model === model && current?.aspectRatio === aspect) return
    updateModeDraft(tabId, 'image', { model, aspectRatio: aspect })
  }, [
    mode,
    tabId,
    project?.selectedImageModel,
    project?.pipeline?.imageModel,
    project?.pipeline?.styleLock?.aspectRatio,
    imageModels,
    updateModeDraft
  ])

  useEffect(() => {
    if (mode !== 'video') return
    const model = project?.selectedVideoModel || project?.pipeline?.videoModel || DEFAULT_VIDEO_MODEL
    const current = useProjectTabStore.getState().tabDrafts[tabId]?.video
    if (current?.model === model) return
    updateModeDraft(tabId, 'video', { model })
  }, [mode, tabId, project?.selectedVideoModel, project?.pipeline?.videoModel, updateModeDraft])

  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      event.preventDefault()
    }
    document.addEventListener('dragover', onDragOver)
    return () => document.removeEventListener('dragover', onDragOver)
  }, [])

  const addGenerationToEditor = useCallback(
    async (item: ProjectGeneration): Promise<void> => {
      setError(null)
      try {
        await importGenerationIntoEditor(projectId, item)
        await openProjectEditorTab(projectId)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [openProjectEditorTab, projectId]
  )

  const activeWorkspaceId =
    project?.workspaceId ||
    selectedWorkspaceId ||
    workspaces.find((ws) => ws.name.toLowerCase().includes('ledisa'))?.id ||
    workspaces.find((ws) => ws.isSelected)?.id ||
    workspaces[0]?.id ||
    ''

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

  const onPasteImages = async (
    e: React.ClipboardEvent,
    target: 'attachments' | 'startFrame'
  ): Promise<boolean> => {
    const syncImages = imageFilesFromClipboard(e.clipboardData)
    if (syncImages.length > 0) {
      e.preventDefault()
      for (const file of syncImages) {
        await importImageFile(file, target)
        if (target === 'startFrame') break
      }
      return true
    }

    // Electron clipboard fallback (Win screenshots sometimes skip DataTransfer files)
    if (e.clipboardData.getData('text/plain')) return false
    const images = await imageFilesFromPasteEvent(e.clipboardData)
    if (images.length === 0) return false
    e.preventDefault()
    for (const file of images) {
      await importImageFile(file, target)
      if (target === 'startFrame') break
    }
    return true
  }

  const activeJobs = useMemo(
    () =>
      jobs.filter(
        (job) =>
          pendingJobProjects[job.id] === projectId &&
          (job.status === 'queued' || job.status === 'running')
      ),
    [jobs, pendingJobProjects, projectId]
  )

  const updatePipeline = usePipelineStore((s) => s.updatePipeline)
  const retryPipelineSegment = usePipelineStore((s) => s.retrySegment)

  const pipeline = useMemo(
    () => normalizePipelineState(project?.pipeline ?? createEmptyPipelineState()),
    [project?.pipeline]
  )
  const trackedJobIds = useMemo(
    () => new Set(activeJobs.map((job) => job.id)),
    [activeJobs]
  )
  const pipelineRunningSegments = useMemo(
    () =>
      [...pipeline.segments]
        .filter(
          (segment) =>
            (segment.status === 'image_running' || segment.status === 'video_running') &&
            !(
              (segment.imageJobId && trackedJobIds.has(segment.imageJobId)) ||
              (segment.videoJobId && trackedJobIds.has(segment.videoJobId))
            )
        )
        .sort((a, b) => a.index - b.index),
    [pipeline.segments, trackedJobIds]
  )

  const { lightboxCatalog } = useProjectGallery(projectId)
  const lightboxIndex = lightboxItem
    ? lightboxCatalog.findIndex((item) => item.id === lightboxItem.id)
    : -1

  const openLightbox = useCallback((item: ProjectGeneration): void => {
    setLightboxItem(item)
  }, [])

  const closeLightbox = (): void => {
    setLightboxItem(null)
  }

  const goToPreviousLightbox = (): void => {
    if (lightboxIndex > 0) {
      setLightboxItem(lightboxCatalog[lightboxIndex - 1])
    }
  }

  const goToNextLightbox = (): void => {
    if (lightboxIndex >= 0 && lightboxIndex < lightboxCatalog.length - 1) {
      setLightboxItem(lightboxCatalog[lightboxIndex + 1])
    }
  }

  const lightboxIsVideo =
    lightboxItem != null &&
    (lightboxItem.type === 'video' || isVideoUrl(lightboxItem.url))
  const lightboxMediaSrc = lightboxItem ? generationVideoSrc(lightboxItem) : ''

  const projectQueueStats = {
    queued: activeJobs.filter((j) => j.status === 'queued').length,
    running: activeJobs.filter((j) => j.status === 'running').length
  }
  const pipelineInProgress =
    pipeline.pipelineStatus === 'running' &&
    (projectQueueStats.queued + projectQueueStats.running + pipelineRunningSegments.length > 0 ||
      pipeline.segments.some((s) =>
        ['pending', 'image_running', 'video_running', 'audio_match_done', 'image_done'].includes(s.status)
      ))

  const handleEditPipelineSegment = (
    segmentId: string,
    patch: Partial<ScriptSegment>
  ): void => {
    const current = getProjectPipeline(projectId)
    void updatePipeline(projectId, updateSegmentInPipeline(current, segmentId, patch))
  }

  const handleDownloadSegmentVideo = (segment: ScriptSegment): void => {
    if (!segment.videoLocalPath || !window.electronAPI?.saveMediaAs) return
    void window.electronAPI.saveMediaAs({
      localPath: segment.videoLocalPath,
      defaultName: `segment-${segment.index + 1}.mp4`
    })
  }

  const handleDownloadSegmentImage = (segment: ScriptSegment): void => {
    if (!window.electronAPI?.saveMediaAs) return
    const pending = segment.pendingImageApproval
    const localPath = pending?.localPath ?? segment.imageLocalPath
    const url = localPath ? undefined : pending?.url
    if (!localPath && !url) return
    void window.electronAPI.saveMediaAs({
      localPath,
      url,
      defaultName: `segment-${segment.index + 1}.png`
    })
  }

  const handleAttachSegmentImages = async (
    segmentId: string,
    files: File[]
  ): Promise<void> => {
    if (!window.electronAPI) return
    const current = getProjectPipeline(projectId)
    const nextRefs = [...(current.scriptReferences ?? [])]
    const addedIds: string[] = []

    for (const file of files) {
      if (!isImageFile(file)) continue
      try {
        const path = filePathFromDrop(file)
        const imported = path
          ? await window.electronAPI.importProjectMedia(projectId, path)
          : window.electronAPI.importProjectMediaBytes
            ? await window.electronAPI.importProjectMediaBytes(
                projectId,
                file.name || 'attached-image.png',
                await file.arrayBuffer()
              )
            : null
        if (!imported) continue
        const id = generateId()
        nextRefs.push({
          id,
          localPath: imported.localPath,
          name: imported.name,
          instruction: ''
        })
        addedIds.push(id)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    if (addedIds.length === 0) return

    const segments = current.segments.map((segment) => {
      if (segment.id !== segmentId) return segment
      const existing = new Set(segment.scriptReferenceIds ?? [])
      for (const id of addedIds) existing.add(id)
      return { ...segment, scriptReferenceIds: [...existing] }
    })

    await updatePipeline(projectId, {
      ...current,
      scriptReferences: nextRefs,
      segments
    })
  }

  const handleRemoveSegmentReference = (segmentId: string, referenceId: string): void => {
    const current = getProjectPipeline(projectId)
    void updatePipeline(
      projectId,
      updateSegmentInPipeline(current, segmentId, {
        scriptReferenceIds: (current.segments.find((s) => s.id === segmentId)
          ?.scriptReferenceIds ?? []
        ).filter((id) => id !== referenceId)
      })
    )
  }

  const handleOpenSegmentInSidebar = (segmentId: string, media: 'image' | 'video'): void => {
    void loadSegmentIntoTab(tabId, projectId, segmentId, media)
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

    if (tabState.regenerateSegmentId) {
      const currentProject = useProjectTabStore.getState().projects[projectId]
      const currentPipeline = normalizePipelineState(
        currentProject?.pipeline ?? createEmptyPipelineState()
      )
      const segment = currentPipeline.segments.find((s) => s.id === tabState.regenerateSegmentId)
      if (segment?.pendingImageApproval) {
        discardPendingSegmentImage(projectId, tabState.regenerateSegmentId)
      }
    }

    try {
      const job = await window.electronAPI.enqueueHiggsfieldJob(built.enqueue)
      trackJob(job.id, projectId, built.snapshot)

      if (tabState.regenerateSegmentId && tabState.activeMode === 'image') {
        const currentProject = useProjectTabStore.getState().projects[projectId]
        const currentPipeline = normalizePipelineState(
          currentProject?.pipeline ?? createEmptyPipelineState()
        )
        updateProjectPipelineState(projectId, {
          ...currentPipeline,
          segments: currentPipeline.segments.map((segment) =>
            segment.id === tabState.regenerateSegmentId
              ? {
                  ...segment,
                  status: 'image_running',
                  imageJobId: job.id,
                  error: undefined
                }
              : segment
          )
        })
      } else if (tabState.regenerateSegmentId && tabState.activeMode === 'video') {
        const currentProject = useProjectTabStore.getState().projects[projectId]
        const currentPipeline = normalizePipelineState(
          currentProject?.pipeline ?? createEmptyPipelineState()
        )
        updateProjectPipelineState(projectId, {
          ...currentPipeline,
          segments: currentPipeline.segments.map((segment) =>
            segment.id === tabState.regenerateSegmentId
              ? {
                  ...segment,
                  status: 'video_running',
                  videoJobId: job.id,
                  videoMotionPrompt: built.effectivePrompt || segment.videoMotionPrompt,
                  error: undefined
                }
              : segment
          )
        })
      }
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

  const handleApproveSegmentImage = useCallback(
    (segmentId: string): void => {
      approveSegmentImage(projectId, segmentId)
    },
    [approveSegmentImage, projectId]
  )

  const handleGalleryLoadSettings = useCallback(
    (item: ProjectGeneration): void => {
      void loadGenerationIntoTab(tabId, projectId, item)
    },
    [loadGenerationIntoTab, tabId, projectId]
  )

  const handleGalleryDownload = useCallback((item: ProjectGeneration): void => {
    void downloadGeneration(item)
  }, [])

  const handleGalleryDownloadMany = useCallback(async (items: ProjectGeneration[]): Promise<void> => {
    try {
      const result = await downloadGenerations(items)
      if (result.dir == null) return
      if (result.failed.length > 0) {
        window.alert(
          `Saved ${result.saved} file(s). ${result.failed.length} failed.`
        )
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const handleGalleryAddToEditor = useCallback(
    (item: ProjectGeneration): void => {
      void addGenerationToEditor(item)
    },
    [addGenerationToEditor]
  )

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-sm">
        Loading project…
      </div>
    )
  }

  const regenerateSegment = tabDraft.regenerateSegmentId
    ? pipeline.segments.find((segment) => segment.id === tabDraft.regenerateSegmentId)
    : undefined

  const lightboxPendingSegment =
    lightboxItem != null
      ? pipeline.segments.find((s) => {
          const pendingJobId = resolvePendingSegmentJobId(lightboxItem.id) ?? lightboxItem.id
          return s.pendingImageApproval?.jobId === pendingJobId
        })
      : undefined

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
          <p className="text-[10px] text-muted font-mono" title={project.id}>
            Created {new Date(project.createdAt).toLocaleString()} · ID {shortProjectId(project.id)}
          </p>

          {regenerateSegment?.pendingImageApproval ? (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-2 space-y-2">
              <p className="text-[10px] font-medium text-amber-700 dark:text-amber-200">
                Segment {regenerateSegment.index + 1} — new image ready for approval
              </p>
              <p className="text-[10px] text-muted">
                Approve to replace the current image in the gallery, pipeline, and segment
                references. Generate again to discard this preview and try another version.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => handleApproveSegmentImage(regenerateSegment.id)}
                >
                  Approve & replace
                </Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => void handleGenerate()}>
                  Generate again
                </Button>
              </div>
            </div>
          ) : regenerateSegment && mode === 'image' ? (
            <div className="text-[10px] text-primary rounded border border-primary/30 bg-primary/5 px-2 py-1.5 space-y-1">
              <p>
                Segment {regenerateSegment.index + 1} — edit prompt, context, or references, then
                regenerate. The new image replaces this segment (any clip for this segment is cleared).
              </p>
              <button
                type="button"
                className="text-muted hover:text-foreground underline"
                onClick={() =>
                  updateTabDraft(tabId, { regenerateSegmentId: null, selectedGenerationId: null })
                }
              >
                Exit segment edit
              </button>
            </div>
          ) : regenerateSegment && mode === 'video' ? (
            <div className="text-[10px] text-primary rounded border border-primary/30 bg-primary/5 px-2 py-1.5 space-y-1">
              <p>
                Segment {regenerateSegment.index + 1} — edit motion prompt or start frame, then
                regenerate. The new video replaces this segment in the gallery and Videos tab.
              </p>
              <button
                type="button"
                className="text-muted hover:text-foreground underline"
                onClick={() =>
                  updateTabDraft(tabId, { regenerateSegmentId: null, selectedGenerationId: null })
                }
              >
                Exit segment edit
              </button>
            </div>
          ) : tabDraft.selectedGenerationId ? (
            <p className="text-[10px] text-primary rounded border border-primary/30 bg-primary/5 px-2 py-1">
              Loaded from gallery — edit and queue to generate a new variant
            </p>
          ) : null}

          {status && !status.authenticated && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-2 space-y-2">
              <p className="text-[10px] text-amber-700 dark:text-amber-200">
                {status.statusMessage?.toLowerCase().includes('expired') ||
                (hfError != null && isHiggsfieldAuthFailureMessage(hfError))
                  ? 'Higgsfield session expired — reconnect to keep generating.'
                  : 'Connect Higgsfield to generate images and videos.'}
              </p>
              <Button size="sm" className="w-full" onClick={() => void login()}>
                <LogIn size={14} className="mr-1" /> Reconnect Higgsfield
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => void refreshHiggsfield()}
              >
                <RefreshCw size={14} className="mr-1" /> Refresh account
              </Button>
            </div>
          )}

          {status?.authenticated && hfError && isHiggsfieldAuthFailureMessage(hfError) && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-2 space-y-2">
              <p className="text-[10px] text-amber-700 dark:text-amber-200">{hfError}</p>
              <Button size="sm" className="w-full" onClick={() => void login()}>
                <LogIn size={14} className="mr-1" /> Reconnect Higgsfield
              </Button>
            </div>
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
              onPaste={(e) => {
                if (mode === 'image') void onPasteImages(e, 'attachments')
                else if (mode === 'video') void onPasteImages(e, 'startFrame')
              }}
              rows={4}
              placeholder={
                mode === 'image'
                  ? draft.imageAttachments.length >= 2
                    ? 'e.g. Combine #1 and #2: skeleton from #2 holding a plate with the brain from #1'
                    : 'Describe the image you want… Paste a screenshot to attach it.'
                  : 'Describe the video motion and scene… Paste a screenshot for the start frame.'
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
                tabIndex={0}
                onDragEnterCapture={() => setDragOverTarget('attachments')}
                onDragLeaveCapture={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return
                  setDragOverTarget(null)
                }}
                onDragOverCapture={allowFileDrop}
                onDropCapture={(e) => void onDropFiles(e, 'attachments')}
                onPaste={(e) => void onPasteImages(e, 'attachments')}
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
                <p className="mt-1 text-[10px] text-muted">
                  Drop, browse, or paste a screenshot (Ctrl+V) to attach.
                </p>
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
              <div className="flex items-end gap-2">
                <div className="shrink-0">
                  <Label>Start frame</Label>
                  <div
                    className={cn(
                      'mt-1 h-16 w-16 rounded-md border border-dashed overflow-hidden transition-colors',
                      dragOverTarget === 'startFrame'
                        ? 'border-primary bg-primary/5'
                        : 'border-border'
                    )}
                    tabIndex={0}
                    onDragEnterCapture={() => setDragOverTarget('startFrame')}
                    onDragLeaveCapture={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return
                      setDragOverTarget(null)
                    }}
                    onDragOverCapture={allowFileDrop}
                    onDropCapture={(e) => void onDropFiles(e, 'startFrame')}
                    onPaste={(e) => void onPasteImages(e, 'startFrame')}
                  >
                    {draft.videoStartFrame ? (
                      <div className="relative h-full w-full group">
                        <img
                          src={localMediaPathUrl(
                            draft.videoStartFrame.previewUrl ?? draft.videoStartFrame.localPath
                          )}
                          alt="Start frame"
                          className="h-full w-full object-cover bg-black/20"
                        />
                        <button
                          type="button"
                          className="absolute top-0.5 right-0.5 rounded-full bg-black/70 p-0.5 opacity-0 group-hover:opacity-100"
                          onClick={() => patchDraft({ videoStartFrame: null })}
                        >
                          <X size={10} className="text-white" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        title="Upload or drag starting frame"
                        className="h-full w-full flex flex-col items-center justify-center gap-0.5 text-muted hover:text-primary hover:bg-card"
                        onClick={() => startFrameInputRef.current?.click()}
                      >
                        <ImagePlus size={16} />
                        <span className="text-[9px] leading-none">Add</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <Label>Duration</Label>
                  <div className="mt-1 flex gap-1.5">
                    <select
                      value={draft.durationSource}
                      onChange={(e) =>
                        patchDraft({
                          durationSource: e.target.value as 'manual' | 'script-audio-match'
                        })
                      }
                      className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-1.5 text-xs"
                    >
                      <option value="manual">Manual</option>
                      <option value="script-audio-match" disabled={!draft.scriptMatch}>
                        Auto
                      </option>
                    </select>
                    {draft.durationSource === 'manual' ? (
                      <select
                        value={draft.videoDuration}
                        onChange={(e) => patchDraft({ videoDuration: Number(e.target.value) })}
                        className="h-9 w-[4.5rem] shrink-0 rounded-md border border-border bg-card px-1.5 text-sm"
                      >
                        {MANUAL_VIDEO_DURATION_SECONDS.map((d) => (
                          <option key={d} value={d}>
                            {d}s
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="h-9 min-w-0 flex-1 flex items-center rounded-md border border-border bg-card px-2 text-xs truncate">
                        {draft.scriptMatch
                          ? `${resolveVideoDurationSeconds(draft)}s`
                          : 'Match script first'}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <Button
                className="w-full"
                disabled={!status?.authenticated}
                onClick={() => void handleGenerate()}
              >
                {regenerateSegment
                  ? `Regenerate segment ${regenerateSegment.index + 1} video`
                  : 'Queue video generation'}
              </Button>

              {draft.durationSource === 'script-audio-match' && (
                <div>
                  <Label>Auto extra duration (seconds)</Label>
                  <input
                    type="number"
                    min={0}
                    max={15}
                    step={1}
                    value={draft.autoExtraDurationSeconds}
                    onChange={(e) =>
                      patchDraft({
                        autoExtraDurationSeconds: clampAutoExtraDurationSeconds(
                          Number(e.target.value) || 0
                        )
                      })
                    }
                    className="w-full mt-1 h-9 rounded-md border border-border bg-card px-2 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-muted">
                    Default is 2s. Added only when matched audio duration is at least 3s.
                  </p>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="text-xs text-red-400 rounded border border-destructive/30 bg-destructive/10 p-2">
              {error}
            </p>
          )}

          {(projectQueueStats.running > 0 || projectQueueStats.queued > 0 || pipelineInProgress) && (
            <p className="text-xs text-primary animate-pulse">
              {pipeline.pipelineStatus === 'running' ? 'Pipeline running · ' : ''}
              Background queue · Running {projectQueueStats.running} · Queued {projectQueueStats.queued}
              {pipelineRunningSegments.length > 0
                ? ` · ${pipelineRunningSegments.length} segment${pipelineRunningSegments.length === 1 ? '' : 's'} starting`
                : ''}
              {queueStats.running + queueStats.queued > projectQueueStats.running + projectQueueStats.queued
                ? ` (${queueStats.running + queueStats.queued} total app-wide)`
                : ''}
            </p>
          )}

          {mode === 'image' && (
            <Button
              className="w-full"
              disabled={!status?.authenticated}
              onClick={() => void handleGenerate()}
            >
              {regenerateSegment
                ? regenerateSegment.pendingImageApproval
                  ? 'Generate again'
                  : `Regenerate segment ${regenerateSegment.index + 1} image`
                : 'Queue image generation'}
            </Button>
          )}

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
        <div className="px-4 py-2 border-b border-border flex items-center justify-between shrink-0 gap-2">
          <GalleryHeaderCounts
            projectId={projectId}
            inProgress={activeJobs.length + pipelineRunningSegments.length}
          />
          <div className="flex items-center gap-2 shrink-0">
            {!pipelineOpen && (
              <Button size="sm" variant="outline" onClick={() => setPipelineOpen(true)}>
                <PanelRightOpen size={14} className="mr-1" /> Pipeline
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void openProjectEditorTab(projectId)}>
              <Scissors size={14} className="mr-1" /> Video editor
            </Button>
            <span className="text-[10px] text-muted hidden sm:inline">Shared gallery · composer persists in project</span>
          </div>
        </div>

        <PipelineSegmentTabBar active={mainTab} onChange={setMainTab} />

        <div className="flex-1 min-h-0 flex flex-col">
          {mainTab === 'preview' ? (
            <div className="flex-1 min-h-0 p-4">
              <ProjectGalleryPreview
                projectId={projectId}
                selectedGenerationId={tabDraft.selectedGenerationId}
                onPreview={openLightbox}
                onLoadSettings={handleGalleryLoadSettings}
                onDownload={handleGalleryDownload}
                onDownloadMany={handleGalleryDownloadMany}
                onAddToEditor={handleGalleryAddToEditor}
                onApproveSegment={handleApproveSegmentImage}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
              <PipelineSegmentTabContent
                active={mainTab}
                segments={pipeline.segments}
                characters={pipeline.characters}
                pipeline={pipeline}
                projectId={projectId}
                onEditSegment={handleEditPipelineSegment}
                onRetry={(segmentId, stage) => void retryPipelineSegment(projectId, segmentId, stage)}
                onDownloadImage={handleDownloadSegmentImage}
                onDownloadVideo={handleDownloadSegmentVideo}
                onOpenInSidebar={handleOpenSegmentInSidebar}
                onApproveSegment={handleApproveSegmentImage}
                onAttachSegmentImages={handleAttachSegmentImages}
                onRemoveSegmentReference={handleRemoveSegmentReference}
              />
            </div>
          )}
        </div>
      </main>

      <PipelineSidebar
        projectId={projectId}
        onOpenEditor={() => void openProjectEditorTab(projectId)}
        open={pipelineOpen}
        onToggle={() => setPipelineOpen((value) => !value)}
      />

      {lightboxItem && (
        <MediaLightbox
          onClose={closeLightbox}
          ariaLabel="Generation preview"
          mediaSrc={lightboxMediaSrc}
          isVideo={lightboxIsVideo}
          hasPrevious={lightboxIndex > 0}
          hasNext={lightboxIndex >= 0 && lightboxIndex < lightboxCatalog.length - 1}
          onPrevious={goToPreviousLightbox}
          onNext={goToNextLightbox}
          positionLabel={
            lightboxIndex >= 0
              ? `${lightboxIndex + 1} / ${lightboxCatalog.length}`
              : undefined
          }
        >
          <div className="relative inline-flex max-w-[96vw] max-h-[78vh]">
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-lg border border-white/15 bg-black/55 p-1 shadow-lg backdrop-blur-sm">
              <button
                type="button"
                className="rounded-md p-1.5 text-white/85 hover:bg-white/10 hover:text-white"
                title="Edit & regenerate in sidebar"
                onClick={() => {
                  loadGenerationIntoTab(tabId, projectId, lightboxItem)
                  closeLightbox()
                }}
              >
                <Sparkles size={18} />
              </button>
              <button
                type="button"
                className="rounded-md p-1.5 text-white/85 hover:bg-white/10 hover:text-white"
                title="Add to video editor"
                onClick={() => {
                  void addGenerationToEditor(lightboxItem)
                  closeLightbox()
                }}
              >
                <Scissors size={18} />
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
                title={lightboxIsVideo ? 'Retry video' : 'Retry image'}
                onClick={() => {
                  const segment = findPipelineSegmentForGeneration(pipeline, lightboxItem)
                  if (!segment) {
                    window.alert('This item is not linked to a pipeline segment.')
                    return
                  }
                  closeLightbox()
                  void retryPipelineSegment(
                    projectId,
                    segment.id,
                    lightboxIsVideo ? 'video' : 'image'
                  ).catch((err) => {
                    window.alert(err instanceof Error ? err.message : String(err))
                  })
                }}
              >
                <RefreshCw size={18} />
              </button>
              <button
                type="button"
                className="rounded-md p-1.5 text-white/85 hover:bg-red-600/70 hover:text-white"
                title="Delete from preview"
                onClick={() => {
                  const ok = window.confirm('Delete this item from the preview?')
                  if (!ok) return
                  deleteProjectGeneration(projectId, lightboxItem.id)
                  closeLightbox()
                }}
              >
                <Trash2 size={18} />
              </button>
              <button
                type="button"
                className="rounded-md p-1.5 text-white/85 hover:bg-white/10 hover:text-white"
                title="Close"
                onClick={closeLightbox}
              >
                <X size={18} />
              </button>
            </div>
            {lightboxIsVideo ? (
              <video
                src={lightboxMediaSrc}
                controls
                autoPlay
                playsInline
                preload="metadata"
                className="max-h-[78vh] max-w-[96vw] rounded-lg shadow-2xl"
              />
            ) : (
              <img
                src={lightboxMediaSrc}
                alt={lightboxItem.prompt}
                className="max-h-[78vh] max-w-[96vw] rounded-lg object-contain shadow-2xl"
              />
            )}
          </div>
          <div className="max-w-2xl text-center text-sm text-white/80 px-4 space-y-3">
            <p className="font-medium text-white">{shortModelLabel(lightboxItem.model)}</p>
            <p className="text-white/70">{lightboxItem.prompt || '—'}</p>
            {lightboxPendingSegment && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    handleApproveSegmentImage(lightboxPendingSegment.id)
                    closeLightbox()
                  }}
                >
                  Approve & replace segment {lightboxPendingSegment.index + 1}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/20 text-white hover:bg-white/10"
                  onClick={() => {
                    closeLightbox()
                    void handleGenerate()
                  }}
                >
                  Generate again
                </Button>
              </div>
            )}
          </div>
        </MediaLightbox>
      )}
    </div>
  )
}
