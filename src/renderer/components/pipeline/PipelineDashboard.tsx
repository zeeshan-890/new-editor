import { useEffect, useRef, useState } from 'react'
import {
  Loader2,
  Pause,
  Play,
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
import { LlmSettingsPanel } from './LlmSettingsPanel'
import { AssemblyAiSettingsPanel } from './AssemblyAiSettingsPanel'
import { ScriptBriefPanel } from './ScriptBriefPanel'
import { useCreativeInstructionsDraft } from '@renderer/hooks/useCreativeInstructionsDraft'
import { imageFilesFromClipboard, imageFilesFromPasteEvent } from '@renderer/lib/dropFiles'
import {
  createEmptyPipelineState,
  normalizePipelineState,
  pipelineProgress,
  allSegmentImagesComplete,
  imagesInFlight,
  anchorsInFlight,
  videosInFlight,
  pendingImageSegmentCount,
  pendingVideoSegmentCount
} from '@shared/segmentPipeline'
import {
  getProjectPipeline,
  usePipelineStore
} from '@renderer/stores/pipelineStore'
import { useProjectTabStore } from '@renderer/stores/projectTabStore'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, generateId } from '@shared/types'

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
  const updatePipeline = usePipelineStore((s) => s.updatePipeline)
  const startPipelineImages = usePipelineStore((s) => s.startPipelineImages)
  const startPipelineVideos = usePipelineStore((s) => s.startPipelineVideos)
  const pausePipeline = usePipelineStore((s) => s.pausePipeline)
  const resumePipeline = usePipelineStore((s) => s.resumePipeline)
  const syncTimelineAudio = usePipelineStore((s) => s.syncTimelineAudio)
  const matchSegmentTimings = usePipelineStore((s) => s.matchSegmentTimings)
  const assembleTimeline = usePipelineStore((s) => s.assembleTimeline)

  const [scriptDraft, setScriptDraft] = useState(() => pipeline.fullScript)
  const [localError, setLocalError] = useState<string | null>(null)
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false)
  const scriptSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scriptDirtyRef = useRef(false)

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
  }, [loadLlmSettings, loadAssemblyAiSettings])

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

  const handleStartImages = async (): Promise<void> => {
    setLocalError(null)
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
    try {
      await startPipelineVideos(projectId)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
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

  const canStartImageBatch =
    pendingImages > 0 && !batchBusy && pipeline.pipelineStatus !== 'paused'

  const canStartVideoBatch =
    imagesComplete &&
    pendingVideos > 0 &&
    Boolean(pipeline.masterAudioPath) &&
    timingsReady &&
    !batchBusy &&
    pipeline.pipelineStatus !== 'paused'

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
        ? `${progress.imagesDone}/${progress.totalSegments} images ready — finish all image batches first.`
        : !pipeline.masterAudioPath
          ? 'Sync timeline audio before generating videos (needed for clip duration).'
          : !timingsReady
            ? 'Get segment timings first to extract timestamps/durations for videos.'
          : pendingVideos === 0
            ? progress.videosDone >= progress.totalSegments
              ? 'All segment videos are done or failed.'
              : 'No segments are ready for video — ensure each segment has an approved image.'
            : batchBusy
              ? 'Wait for the current batch to finish downloading.'
              : null

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
          onClick={() => setLlmSettingsOpen((v) => !v)}
          aria-expanded={llmSettingsOpen}
        >
          <div>
            <p className="text-xs font-medium">Model settings</p>
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
              Analyzed {new Date(pipeline.analyzedAt).toLocaleString()}
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

      <div className="space-y-1">
        <Label>Full script</Label>
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
        <Button
          size="sm"
          variant="outline"
          disabled={!canMatchTimings}
          title={
            !pipeline.masterAudioPath
              ? 'Sync timeline audio first, then extract segment timings.'
              : pipeline.segments.length === 0
                ? 'Analyze script first.'
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
          <Button size="sm" onClick={() => void pausePipeline(projectId)}>
            <Pause size={14} className="mr-1" /> Pause
          </Button>
        ) : pipeline.pipelineStatus === 'paused' ? (
          <Button size="sm" onClick={() => void resumePipeline(projectId)}>
            <Play size={14} className="mr-1" /> Resume
          </Button>
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
            {canStartImageBatch && (
              <Button
                size="sm"
                disabled={Boolean(imagesBlockedReason && !canStartImageBatch)}
                title={
                  imagesBlockedReason ??
                  'Starts image generation (10 at a time). Next batches and failed images retry automatically.'
                }
                onClick={() => void handleStartImages()}
              >
                <Image size={14} className="mr-1" /> {imageButtonLabel}
              </Button>
            )}
            {canStartVideoBatch && (
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
            {!canStartVideoBatch &&
              imagesComplete &&
              Boolean(pipeline.masterAudioPath) &&
              pendingVideos > 0 &&
              pipeline.pipelineStatus !== 'paused' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled
                  title={videosBlockedReason ?? 'Videos cannot start yet'}
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

      {imagesBlockedReason && !canStartImageBatch && pipeline.pipelineStatus !== 'paused' && !(pipeline.pipelineStatus === 'running' && batchBusy) && pendingImages > 0 && (
        <p className="text-[10px] text-muted">{imagesBlockedReason}</p>
      )}
      {videosBlockedReason &&
        !canStartVideoBatch &&
        pipeline.pipelineStatus !== 'paused' &&
        !(pipeline.pipelineStatus === 'running' && batchBusy) &&
        imagesComplete &&
        Boolean(pipeline.masterAudioPath) &&
        (pendingVideos > 0 || progress.videosDone < progress.totalSegments) && (
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
