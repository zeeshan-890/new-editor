import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2,
  Pause,
  Play,
  Square,
  Film,
  Sparkles,
  RefreshCw,
  PanelRightClose,
  Image,
  Video,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { Button } from '../common/Button'
import { Label } from '../common/Label'
import { Select } from '../common/Select'
import { LlmSettingsPanel } from './LlmSettingsPanel'
import { AssemblyAiSettingsPanel } from './AssemblyAiSettingsPanel'
import { ScriptBriefPanel } from './ScriptBriefPanel'
import { useCreativeInstructionsDraft } from '@renderer/hooks/useCreativeInstructionsDraft'
import { imageFilesFromClipboard, imageFilesFromPasteEvent } from '@renderer/lib/dropFiles'
import {
  createEmptyPipelineState,
  createEmptyScriptPart,
  normalizePipelineState,
  pipelineProgress,
  allSegmentImagesComplete,
  imagesInFlight,
  anchorsInFlight,
  videosInFlight,
  pendingImageSegmentCount,
  pendingVideoSegmentCount,
  scriptPartsToFullScript,
  type PipelineScriptMode,
  type ScriptPart
} from '@shared/segmentPipeline'
import { ScriptPartsEditor } from './ScriptPartsEditor'
import { cn } from '@renderer/lib/utils'
import {
  getProjectPipeline,
  usePipelineStore
} from '@renderer/stores/pipelineStore'
import { useProjectTabStore } from '@renderer/stores/projectTabStore'
import { useHiggsfieldStore } from '@renderer/stores/higgsfieldStore'
import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  IMAGE_ASPECT_RATIOS,
  generateId,
  resolveImageModelId
} from '@shared/types'
import { sortImageModels, pickImageModel, imageModelShortLabel } from '@shared/imageModels'

export function PipelineDashboard({
  projectId,
  onOpenEditor,
  onCollapse
}: {
  projectId: string
  onOpenEditor: () => void
  onCollapse?: () => void
}): React.JSX.Element {
  const project = useProjectTabStore((s) => s.projects[projectId])
  const updateProject = useProjectTabStore((s) => s.updateProject)
  const pipeline = normalizePipelineState(project?.pipeline ?? createEmptyPipelineState())
  const progress = pipelineProgress(pipeline)

  const analyzing = usePipelineStore((s) => s.analyzing)
  const pipelineRunning = usePipelineStore((s) => s.pipelineRunning)
  const assembling = usePipelineStore((s) => s.assembling)
  const syncingAudio = usePipelineStore((s) => s.syncingAudio)
  const matchingTimings = usePipelineStore((s) => s.matchingTimings)
  const lastError = usePipelineStore((s) => s.lastError)
  const llmSettings = usePipelineStore((s) => s.llmSettings)
  const loadLlmSettings = usePipelineStore((s) => s.loadLlmSettings)
  const loadAssemblyAiSettings = usePipelineStore((s) => s.loadAssemblyAiSettings)

  const analyzeAndApplyScript = usePipelineStore((s) => s.analyzeAndApplyScript)
  const enrichAndApplyScriptParts = usePipelineStore((s) => s.enrichAndApplyScriptParts)
  const updatePipeline = usePipelineStore((s) => s.updatePipeline)
  const startPipelineImages = usePipelineStore((s) => s.startPipelineImages)
  const startPipelineVideos = usePipelineStore((s) => s.startPipelineVideos)
  const pausePipeline = usePipelineStore((s) => s.pausePipeline)
  const stopPipeline = usePipelineStore((s) => s.stopPipeline)
  const resumePipeline = usePipelineStore((s) => s.resumePipeline)
  const syncTimelineAudio = usePipelineStore((s) => s.syncTimelineAudio)
  const matchSegmentTimings = usePipelineStore((s) => s.matchSegmentTimings)
  const assembleTimeline = usePipelineStore((s) => s.assembleTimeline)

  const workspaces = useHiggsfieldStore((s) => s.workspaces)
  const selectedWorkspaceId = useHiggsfieldStore((s) => s.selectedWorkspaceId)
  const setSelectedWorkspaceId = useHiggsfieldStore((s) => s.setSelectedWorkspaceId)
  const imageModels = useHiggsfieldStore((s) => s.imageModels)
  const videoModels = useHiggsfieldStore((s) => s.videoModels)
  const hfStatus = useHiggsfieldStore((s) => s.status)
  const loadModels = useHiggsfieldStore((s) => s.loadModels)

  const [scriptDraft, setScriptDraft] = useState(() => pipeline.fullScript)
  const [localError, setLocalError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false)
  const [generationDefaultsOpen, setGenerationDefaultsOpen] = useState(false)
  const scriptSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scriptDirtyRef = useRef(false)

  const sortedImageModels = useMemo(() => sortImageModels(imageModels), [imageModels])
  const imageModelId = useMemo(
    () =>
      pickImageModel(
        resolveImageModelId(project?.selectedImageModel || pipeline.imageModel || DEFAULT_IMAGE_MODEL),
        imageModels
      ),
    [project?.selectedImageModel, pipeline.imageModel, imageModels]
  )
  const videoModelId =
    project?.selectedVideoModel || pipeline.videoModel || DEFAULT_VIDEO_MODEL
  const aspectRatio = pipeline.styleLock.aspectRatio || DEFAULT_ASPECT_RATIO

  const activeWorkspaceId = useMemo(() => {
    if (project?.workspaceId && workspaces.some((w) => w.id === project.workspaceId)) {
      return project.workspaceId
    }
    if (selectedWorkspaceId && workspaces.some((w) => w.id === selectedWorkspaceId)) {
      return selectedWorkspaceId
    }
    const ledisa = workspaces.find((w) => w.name.toLowerCase().includes('ledisa'))
    if (ledisa) return ledisa.id
    return workspaces.find((w) => w.isSelected)?.id || workspaces[0]?.id || ''
  }, [project?.workspaceId, selectedWorkspaceId, workspaces])

  // Keep project + Higgsfield session on the same active workspace (prefer Ledisa)
  useEffect(() => {
    if (!project || workspaces.length === 0) return

    if (project.workspaceId && workspaces.some((w) => w.id === project.workspaceId)) {
      if (selectedWorkspaceId !== project.workspaceId) {
        void setSelectedWorkspaceId(project.workspaceId)
      }
      return
    }

    const preferred =
      workspaces.find((w) => w.name.toLowerCase().includes('ledisa')) ||
      workspaces.find((w) => w.isSelected) ||
      workspaces[0]
    if (!preferred) return
    updateProject(projectId, { workspaceId: preferred.id })
    if (selectedWorkspaceId !== preferred.id) {
      void setSelectedWorkspaceId(preferred.id)
    }
  }, [
    project,
    projectId,
    workspaces,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    updateProject
  ])

  const applyGenerationDefaults = (patch: {
    workspaceId?: string
    selectedImageModel?: string
    selectedVideoModel?: string
    aspectRatio?: string
  }): void => {
    const nextAspect = patch.aspectRatio ?? aspectRatio
    const nextImage = patch.selectedImageModel ?? imageModelId
    const nextVideo = patch.selectedVideoModel ?? videoModelId
    const current = getProjectPipeline(projectId)
    updateProject(projectId, {
      ...(patch.workspaceId !== undefined ? { workspaceId: patch.workspaceId } : {}),
      ...(patch.selectedImageModel !== undefined
        ? { selectedImageModel: patch.selectedImageModel }
        : {}),
      ...(patch.selectedVideoModel !== undefined
        ? { selectedVideoModel: patch.selectedVideoModel }
        : {})
    })
    void updatePipeline(
      projectId,
      {
        ...current,
        imageModel: nextImage,
        videoModel: nextVideo,
        workspaceId: patch.workspaceId ?? current.workspaceId ?? project?.workspaceId,
        styleLock: {
          ...current.styleLock,
          aspectRatio: nextAspect
        }
      },
      { debounceMs: 0 }
    )
  }

  const saveCreativeInstructions = (value: string): void => {
    const current = getProjectPipeline(projectId)
    void updatePipeline(projectId, { ...current, creativeInstructions: value }, { debounceMs: 0 })
  }

  const [instructionsDraft, setInstructionsDraft] = useCreativeInstructionsDraft(
    pipeline.creativeInstructions ?? '',
    projectId,
    saveCreativeInstructions
  )

  useEffect(() => {
    setScriptDraft(pipeline.fullScript)
    setLocalError(null)
    setStopping(false)
    scriptDirtyRef.current = false
  }, [projectId])

  useEffect(() => {
    if (scriptDirtyRef.current) return
    setScriptDraft((current) =>
      current === pipeline.fullScript ? current : pipeline.fullScript
    )
  }, [pipeline.fullScript])

  useEffect(() => {
    void loadLlmSettings()
    void loadAssemblyAiSettings()
    void loadModels('image')
    void loadModels('video')
  }, [loadLlmSettings, loadAssemblyAiSettings, loadModels])

  useEffect(() => {
    usePipelineStore.setState({
      pipelineRunning:
        pipeline.pipelineStatus === 'running' || pipeline.pipelineStatus === 'analyzing'
    })
  }, [projectId, pipeline.pipelineStatus])

  // Soft-reconcile orphaned Pause after restart — only when there is no active phase
  // (a real batch always sets activePhase; mid-batch gaps must not auto-dismiss).
  useEffect(() => {
    if (pipeline.pipelineStatus !== 'running' && pipeline.pipelineStatus !== 'paused') return
    if (pipeline.activePhase) return
    if (imagesInFlight(pipeline) || videosInFlight(pipeline) || anchorsInFlight(pipeline)) return
    if (!window.electronAPI?.dismissAllStuckPipeline) return
    void window.electronAPI.dismissAllStuckPipeline(projectId).then((next) => {
      usePipelineStore.getState().handlePipelineUpdated(projectId, next)
    })
  }, [projectId, pipeline.pipelineStatus, pipeline.activePhase])

  const persistScriptDraft = (value: string, immediate = false): void => {
    const current = getProjectPipeline(projectId)
    void updatePipeline(projectId, { ...current, fullScript: value }, { immediate, debounceMs: 0 })
    if (scriptDraft === value) {
      scriptDirtyRef.current = false
    }
  }

  useEffect(() => {
    if (!scriptDirtyRef.current) return
    if (scriptDraft === pipeline.fullScript) {
      scriptDirtyRef.current = false
      return
    }
    if (scriptSaveTimerRef.current) clearTimeout(scriptSaveTimerRef.current)
    scriptSaveTimerRef.current = setTimeout(() => {
      scriptSaveTimerRef.current = null
      persistScriptDraft(scriptDraft)
    }, 600)
    return () => {
      if (scriptSaveTimerRef.current) clearTimeout(scriptSaveTimerRef.current)
    }
  }, [scriptDraft, pipeline.fullScript, projectId])

  const normalizePastedScript = (text: string): string =>
    text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u00A0/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')

  const handleScriptChange = (value: string): void => {
    scriptDirtyRef.current = true
    setScriptDraft(value)
  }

  const handleScriptPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const syncImages = imageFilesFromClipboard(event.clipboardData)
    const attachImages = async (images: File[]): Promise<void> => {
      if (!window.electronAPI?.importProjectMediaBytes) return
      const current = getProjectPipeline(projectId) ?? createEmptyPipelineState()
      const nextRefs = [...(current.scriptReferences ?? [])]
      for (const file of images) {
        const imported = await window.electronAPI.importProjectMediaBytes(
          projectId,
          file.name || 'pasted-image.png',
          await file.arrayBuffer()
        )
        nextRefs.push({
          id: generateId(),
          localPath: imported.localPath,
          name: imported.name,
          instruction: ''
        })
      }
      handleReferencesChange(nextRefs)
    }

    if (syncImages.length > 0) {
      event.preventDefault()
      void attachImages(syncImages)
      return
    }

    const pasted = event.clipboardData.getData('text/plain')
    if (pasted) {
      event.preventDefault()
      scriptDirtyRef.current = true

      const textarea = event.currentTarget
      const start = textarea.selectionStart ?? scriptDraft.length
      const end = textarea.selectionEnd ?? scriptDraft.length
      const normalized = normalizePastedScript(pasted)
      const next = `${scriptDraft.slice(0, start)}${normalized}${scriptDraft.slice(end)}`
      setScriptDraft(next)

      const cursor = start + normalized.length
      requestAnimationFrame(() => {
        textarea.selectionStart = cursor
        textarea.selectionEnd = cursor
      })
      return
    }

    void (async () => {
      const images = await imageFilesFromPasteEvent(event.clipboardData)
      if (images.length > 0) await attachImages(images)
    })()
  }

  const handleScriptBlur = (): void => {
    if (!scriptDirtyRef.current || scriptDraft === pipeline.fullScript) return
    if (scriptSaveTimerRef.current) {
      clearTimeout(scriptSaveTimerRef.current)
      scriptSaveTimerRef.current = null
    }
    persistScriptDraft(scriptDraft, true)
  }

  const error = localError ?? lastError

  const handleAnalyze = async (): Promise<void> => {
    setLocalError(null)
    try {
      await analyzeAndApplyScript(projectId, scriptDraft, {
        creativeInstructions: instructionsDraft,
        scriptReferences: pipeline.scriptReferences ?? []
      })
      setScriptDraft(getProjectPipeline(projectId).fullScript)
      scriptDirtyRef.current = false
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const scriptMode: PipelineScriptMode = pipeline.scriptMode === 'parts' ? 'parts' : 'full'
  const scriptParts: ScriptPart[] = pipeline.scriptParts ?? []

  const setScriptMode = (mode: PipelineScriptMode): void => {
    const current = getProjectPipeline(projectId)
    const nextParts =
      mode === 'parts' && (!current.scriptParts || current.scriptParts.length === 0)
        ? [createEmptyScriptPart(0)]
        : current.scriptParts
    void updatePipeline(
      projectId,
      { ...current, scriptMode: mode, scriptParts: nextParts },
      { immediate: true, debounceMs: 0 }
    )
  }

  const handlePartsChange = (parts: ScriptPart[]): void => {
    const current = getProjectPipeline(projectId)
    const clipById = new Map(
      parts.flatMap((p) => p.clips.map((c) => [c.id, { part: p, clip: c }] as const))
    )
    // Keep narration in sync; image/video prompts stay agent-owned until rebuild.
    const segments = current.segments.map((seg) => {
      if (!seg.sourceClipId) return seg
      const linked = clipById.get(seg.sourceClipId)
      if (!linked) return seg
      return {
        ...seg,
        scriptText: linked.part.scriptText.trim() || seg.scriptText
      }
    })
    void updatePipeline(
      projectId,
      {
        ...current,
        scriptMode: 'parts',
        scriptParts: parts,
        fullScript: scriptPartsToFullScript(parts),
        segments
      },
      { debounceMs: 0 }
    )
    setScriptDraft(scriptPartsToFullScript(parts))
  }

  const handlePartsBlur = (): void => {
    void useProjectTabStore.getState().saveProjectNow(projectId)
  }

  const handleBuildFromParts = async (): Promise<void> => {
    setLocalError(null)
    try {
      const current = getProjectPipeline(projectId)
      const scriptReferences = current.scriptReferences ?? []
      await updatePipeline(
        projectId,
        {
          ...current,
          scriptMode: 'parts',
          scriptParts,
          fullScript: scriptPartsToFullScript(scriptParts),
          creativeInstructions: instructionsDraft,
          scriptReferences
        },
        { immediate: true, debounceMs: 0 }
      )
      await enrichAndApplyScriptParts(projectId, {
        creativeInstructions: instructionsDraft,
        scriptReferences
      })
      setScriptDraft(getProjectPipeline(projectId).fullScript)
      scriptDirtyRef.current = false
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleReferencesChange = (
    scriptReferences: import('@shared/segmentPipeline').PipelineScriptReference[]
  ): void => {
    const current = getProjectPipeline(projectId)
    void updatePipeline(projectId, { ...current, scriptReferences }, { debounceMs: 0 })
  }

  const handleSyncTimelineAudio = async (): Promise<void> => {
    setLocalError(null)
    try {
      await syncTimelineAudio(projectId)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleMatchTimings = async (): Promise<void> => {
    setLocalError(null)
    try {
      await matchSegmentTimings(projectId)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const audioSyncedLabel =
    pipeline.masterAudioSyncedAt != null
      ? new Date(pipeline.masterAudioSyncedAt).toLocaleTimeString()
      : null

  const handleStopPipeline = async (): Promise<void> => {
    setLocalError(null)
    setStopping(true)
    try {
      await stopPipeline(projectId)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setStopping(false)
    }
  }

  const total = progress.totalSegments || 1
  const imagesComplete = allSegmentImagesComplete(pipeline)
  const pendingImages = pendingImageSegmentCount(pipeline)
  const pendingVideos = pendingVideoSegmentCount(pipeline)
  const timingsDone = pipeline.segments.filter((s) => s.scriptMatch != null).length
  const timingsPending = Math.max(0, pipeline.segments.length - timingsDone)
  const timingsReady = pipeline.segments.length > 0 && timingsPending === 0
  const batchBusy =
    imagesInFlight(pipeline) || anchorsInFlight(pipeline) || videosInFlight(pipeline)
  const stuckRunningIdle = pipeline.pipelineStatus === 'running' && !batchBusy

  const imageButtonLabel =
    progress.imagesDone === 0 ? 'Generate images' : 'Continue images'
  const videoButtonLabel =
    progress.videosDone === 0 ? 'Generate videos' : 'Continue videos'

  /** Show enabled whenever remaining work exists (not mid-batch). */
  const showImageAction = pendingImages > 0 && !batchBusy
  const showVideoAction = pendingVideos > 0 && !batchBusy

  const canMatchTimings =
    pipeline.segments.length > 0 &&
    Boolean(pipeline.masterAudioPath) &&
    !batchBusy &&
    !matchingTimings &&
    pipeline.pipelineStatus !== 'paused'

  const imagesBlockedReason =
    pipeline.segments.length === 0
      ? 'Analyze your script first to create segments.'
      : pendingImages === 0
        ? 'All segment images are done or failed.'
        : batchBusy
          ? 'Wait for the current batch to finish downloading.'
          : analyzing
            ? 'Wait for script analysis to finish.'
            : syncingAudio
              ? 'Wait for timeline audio sync to finish.'
              : null

  const videosBlockedReason =
    pipeline.segments.length === 0
      ? 'Analyze your script first to create segments.'
      : !imagesComplete
        ? `${progress.imagesDone}/${progress.totalSegments} images ready — finish remaining images first.`
        : !pipeline.masterAudioPath
          ? 'Sync timeline audio before generating videos (needed for clip duration).'
          : !timingsReady
            ? 'Get segment timings first to extract timestamps/durations for videos.'
            : pendingVideos === 0
              ? progress.videosDone >= progress.totalSegments
                ? 'All segment videos are done or failed.'
                : 'No segments are ready for video — ensure each segment has an image.'
              : batchBusy
                ? 'Wait for the current batch to finish downloading.'
                : null

  const handleStartImages = async (): Promise<void> => {
    setLocalError(null)
    if (batchBusy) {
      setLocalError('Wait for the current batch to finish.')
      return
    }
    const current = getProjectPipeline(projectId)
    await updatePipeline(
      projectId,
      {
        ...current,
        fullScript: scriptDraft,
        imageModel: project?.selectedImageModel ?? DEFAULT_IMAGE_MODEL,
        videoModel: project?.selectedVideoModel ?? DEFAULT_VIDEO_MODEL,
        workspaceId: project?.workspaceId
      },
      { immediate: true }
    )
    try {
      await startPipelineImages(projectId)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleStartVideos = async (): Promise<void> => {
    setLocalError(null)
    if (videosBlockedReason) {
      setLocalError(videosBlockedReason)
      return
    }
    try {
      await startPipelineVideos(projectId)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleUnlockPipeline = (): void => {
    if (!window.electronAPI?.dismissAllStuckPipeline) return
    void window.electronAPI.dismissAllStuckPipeline(projectId).then((next) => {
      usePipelineStore.getState().handlePipelineUpdated(projectId, next)
    })
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Film size={16} className="text-primary shrink-0" />
          <h2 className="text-sm font-semibold truncate">Script-to-Video Pipeline</h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="outline" onClick={onOpenEditor}>
            Open editor
          </Button>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              title="Close sidebar"
              aria-label="Close pipeline sidebar"
              className="p-1.5 rounded-md text-muted hover:text-foreground hover:bg-card border border-transparent hover:border-border"
            >
              <PanelRightClose size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border bg-card/50">
        <button
          type="button"
          className="w-full flex items-center justify-between px-3 py-2 text-left"
          onClick={() => setGenerationDefaultsOpen((v) => !v)}
          aria-expanded={generationDefaultsOpen}
        >
          <div className="min-w-0">
            <p className="text-xs font-medium">Generation defaults</p>
            <p className="text-[10px] text-muted mt-0.5 truncate">
              {[
                workspaces.find((w) => w.id === activeWorkspaceId)?.name ||
                  hfStatus?.selectedWorkspace?.name,
                imageModelShortLabel(imageModelId),
                videoModels.find((m) => m.id === videoModelId)?.name || videoModelId,
                aspectRatio
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {generationDefaultsOpen ? (
            <ChevronUp size={14} className="text-muted shrink-0" />
          ) : (
            <ChevronDown size={14} className="text-muted shrink-0" />
          )}
        </button>
        {generationDefaultsOpen && (
          <div className="px-3 pb-3 space-y-2.5">
            <div>
              <Label>Workspace</Label>
              {workspaces.length === 0 ? (
                <p className="text-xs text-muted mt-1">No workspaces — reconnect Higgsfield.</p>
              ) : (
                <Select
                  value={activeWorkspaceId}
                  onChange={(id) => {
                    applyGenerationDefaults({ workspaceId: id })
                    void setSelectedWorkspaceId(id)
                  }}
                  options={workspaces.map((ws) => ({
                    value: ws.id,
                    label: `${ws.name} (${Math.floor(ws.credits).toLocaleString()} credits)`
                  }))}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Image model</Label>
                <Select
                  value={imageModelId}
                  onChange={(id) => applyGenerationDefaults({ selectedImageModel: id })}
                  options={(sortedImageModels.length > 0
                    ? sortedImageModels
                    : [{ id: imageModelId, name: imageModelId }]
                  ).map((m) => ({
                    value: m.id,
                    label: imageModelShortLabel(m.id)
                  }))}
                />
              </div>
              <div>
                <Label>Video model</Label>
                <Select
                  value={videoModelId}
                  onChange={(id) => applyGenerationDefaults({ selectedVideoModel: id })}
                  options={(videoModels.length > 0
                    ? videoModels
                    : [{ id: videoModelId, name: videoModelId }]
                  ).map((m) => ({
                    value: m.id,
                    label: m.name || m.id
                  }))}
                />
              </div>
            </div>

            <div>
              <Label>Aspect ratio</Label>
              <Select
                value={aspectRatio}
                onChange={(ratio) => applyGenerationDefaults({ aspectRatio: ratio })}
                options={IMAGE_ASPECT_RATIOS.map((ratio) => ({
                  value: ratio,
                  label: ratio === DEFAULT_ASPECT_RATIO ? `${ratio} (default)` : ratio
                }))}
              />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-md border border-border bg-card/50">
        <button
          type="button"
          className="w-full flex items-center justify-between px-3 py-2 text-left"
          onClick={() => setLlmSettingsOpen((v) => !v)}
          aria-expanded={llmSettingsOpen}
        >
          <div>
            <p className="text-xs font-medium">LLM / AssemblyAI settings</p>
            <p className="text-[10px] text-muted mt-0.5">
              {llmSettings?.model ? `Current: ${llmSettings.model}` : 'Configure API key, base URL, and model'}
            </p>
          </div>
          {llmSettingsOpen ? (
            <ChevronUp size={14} className="text-muted shrink-0" />
          ) : (
            <ChevronDown size={14} className="text-muted shrink-0" />
          )}
        </button>
        {llmSettingsOpen && (
          <div className="px-3 pb-3">
            <AssemblyAiSettingsPanel />
            <LlmSettingsPanel />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className={`rounded border px-2 py-1 ${pipeline.masterAudioPath ? 'border-green-500/40' : 'border-border'}`}>
          1. Timeline audio {pipeline.masterAudioPath ? '✓' : 'optional for images'}
          {audioSyncedLabel && (
            <span className="block text-[9px] text-muted truncate">Synced {audioSyncedLabel}</span>
          )}
        </div>
        <div className={`rounded border px-2 py-1 ${scriptDraft.trim() ? 'border-green-500/40' : 'border-border'}`}>
          2. Script {scriptDraft.trim() ? '✓' : '—'}
        </div>
        <div className={`rounded border px-2 py-1 ${pipeline.segments.length ? 'border-green-500/40' : 'border-border'}`}>
          3. Segments {pipeline.segments.length || '—'}
          {pipeline.analyzedAt != null && pipeline.segments.length > 0 && (
            <span className="block text-[9px] text-muted truncate">
              {scriptMode === 'parts' ? 'Built' : 'Analyzed'}{' '}
              {new Date(pipeline.analyzedAt).toLocaleString()}
            </span>
          )}
        </div>
        <div className={`rounded border px-2 py-1 ${imagesComplete ? 'border-green-500/40' : 'border-border'}`}>
          4. Images {progress.imagesDone}/{progress.totalSegments || '—'}
        </div>
        <div className={`rounded border px-2 py-1 ${timingsReady ? 'border-green-500/40' : 'border-border'}`}>
          5. Timings {timingsDone}/{progress.totalSegments || '—'}
        </div>
        <div className={`rounded border px-2 py-1 ${pipeline.pipelineStatus === 'complete' ? 'border-green-500/40' : 'border-border'}`}>
          6. Videos {progress.videosDone}/{progress.totalSegments || '—'}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>{scriptMode === 'parts' ? 'Script parts' : 'Full script'}</Label>
          <div className="flex rounded-md border border-border overflow-hidden">
            {(['full', 'parts'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setScriptMode(mode)}
                className={cn(
                  'px-2.5 py-1 text-[10px] font-medium capitalize transition-colors',
                  scriptMode === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted hover:text-foreground hover:bg-card'
                )}
              >
                {mode === 'full' ? 'Full script' : 'Parts'}
              </button>
            ))}
          </div>
        </div>

        {scriptMode === 'full' ? (
          <textarea
            value={scriptDraft}
            onChange={(e) => handleScriptChange(e.target.value)}
            onPaste={handleScriptPaste}
            onBlur={handleScriptBlur}
            rows={8}
            spellCheck
            placeholder="Paste your complete narration script here…"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs resize-y min-h-[120px] focus:outline-none focus:ring-1 focus:ring-primary"
          />
        ) : (
          <ScriptPartsEditor
            parts={scriptParts}
            segments={pipeline.segments}
            onChange={handlePartsChange}
            onPersist={handlePartsBlur}
          />
        )}
      </div>

      <ScriptBriefPanel
        projectId={projectId}
        creativeInstructions={instructionsDraft}
        scriptReferences={pipeline.scriptReferences ?? []}
        onCreativeInstructionsChange={setInstructionsDraft}
        onReferencesChange={handleReferencesChange}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={syncingAudio}
          onClick={() => void handleSyncTimelineAudio()}
        >
          {syncingAudio ? (
            <Loader2 size={14} className="mr-1 animate-spin" />
          ) : (
            <RefreshCw size={14} className="mr-1" />
          )}
          Sync from editor timeline
        </Button>
        {scriptMode === 'full' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={analyzing || !scriptDraft.trim()}
            onClick={() => void handleAnalyze()}
          >
            {analyzing ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Sparkles size={14} className="mr-1" />
            )}
            Analyze script
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={analyzing || !scriptParts.some((p) => p.scriptText.trim())}
            title="Agents invent clips where you leave them empty, write image/video prompts, then build segments. Full script = all parts combined."
            onClick={() => void handleBuildFromParts()}
          >
            {analyzing ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Sparkles size={14} className="mr-1" />
            )}
            Build from parts
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!canMatchTimings}
          title={
            !pipeline.masterAudioPath
              ? 'Sync timeline audio first, then extract segment timings.'
              : pipeline.segments.length === 0
                ? scriptMode === 'parts'
                  ? 'Build from parts first.'
                  : 'Analyze script first.'
                : 'Extract timestamps/durations from audio for each segment'
          }
          onClick={() => void handleMatchTimings()}
        >
          {matchingTimings ? (
            <Loader2 size={14} className="mr-1 animate-spin" />
          ) : (
            <RefreshCw size={14} className="mr-1" />
          )}
          Get segment timings
        </Button>
        {pipeline.pipelineStatus === 'running' && batchBusy ? (
          <>
            <Button size="sm" onClick={() => void pausePipeline(projectId)}>
              <Pause size={14} className="mr-1" /> Pause
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={stopping}
              title="Fully stop the pipeline and cancel in-flight jobs"
              onClick={() => void handleStopPipeline()}
            >
              {stopping ? (
                <Loader2 size={14} className="mr-1 animate-spin" />
              ) : (
                <Square size={14} className="mr-1" />
              )}
              Stop
            </Button>
          </>
        ) : pipeline.pipelineStatus === 'paused' ? (
          <>
            <Button size="sm" onClick={() => void resumePipeline(projectId)}>
              <Play size={14} className="mr-1" /> Resume
            </Button>
            {showVideoAction && (
              <Button
                size="sm"
                variant="outline"
                title={videosBlockedReason ?? 'Continue video generation from where you left off'}
                onClick={() => void handleStartVideos()}
              >
                <Video size={14} className="mr-1" /> {videoButtonLabel}
              </Button>
            )}
            {showImageAction && (
              <Button
                size="sm"
                title={imagesBlockedReason ?? 'Continue image generation'}
                onClick={() => void handleStartImages()}
              >
                <Image size={14} className="mr-1" /> {imageButtonLabel}
              </Button>
            )}
            <Button
              size="sm"
              variant="destructive"
              disabled={stopping}
              title="Fully stop the pipeline and cancel in-flight jobs"
              onClick={() => void handleStopPipeline()}
            >
              {stopping ? (
                <Loader2 size={14} className="mr-1 animate-spin" />
              ) : (
                <Square size={14} className="mr-1" />
              )}
              Stop
            </Button>
          </>
        ) : (
          <>
            {stuckRunningIdle && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleUnlockPipeline}
                title="Pipeline thinks it is running but nothing is generating — unlock to continue"
              >
                Unlock
              </Button>
            )}
            {(pipeline.pipelineStatus === 'running' || stuckRunningIdle) && (
              <Button
                size="sm"
                variant="destructive"
                disabled={stopping}
                title="Fully stop the pipeline and cancel in-flight jobs"
                onClick={() => void handleStopPipeline()}
              >
                {stopping ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : (
                  <Square size={14} className="mr-1" />
                )}
                Stop
              </Button>
            )}
            {showImageAction && (
              <Button
                size="sm"
                title={
                  imagesBlockedReason ??
                  'Starts image generation (10 at a time). Next batches and failed images retry automatically.'
                }
                onClick={() => void handleStartImages()}
              >
                <Image size={14} className="mr-1" /> {imageButtonLabel}
              </Button>
            )}
            {showVideoAction && (
              <Button
                size="sm"
                variant="outline"
                title={
                  videosBlockedReason ??
                  'Starts video generation (5 at a time). Next batches and failed videos retry automatically.'
                }
                onClick={() => void handleStartVideos()}
              >
                <Video size={14} className="mr-1" /> {videoButtonLabel}
              </Button>
            )}
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={assembling || progress.videosDone === 0}
          onClick={() => void assembleTimeline(projectId)}
        >
          {assembling ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Film size={14} className="mr-1" />}
          Assemble timeline
        </Button>
      </div>

      {imagesBlockedReason && showImageAction && videosBlockedReason == null && (
        <p className="text-[10px] text-muted">{imagesBlockedReason}</p>
      )}
      {videosBlockedReason && showVideoAction && (
        <p className="text-[10px] text-muted">{videosBlockedReason}</p>
      )}

      {error && (
        <p className="text-xs text-red-400 rounded border border-red-500/30 bg-red-500/5 px-2 py-1">
          {error}
        </p>
      )}
    </div>
  )
}
