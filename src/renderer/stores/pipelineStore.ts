import { create } from 'zustand'
import type {
  LlmSettings,
  AssemblyAiSettings,
  SegmentPipelineState,
  ScriptSegment
} from '@shared/segmentPipeline'
import {
  createEmptyPipelineState,
  normalizePipelineState,
  allSegmentImagesComplete,
  imagesInFlight
} from '@shared/segmentPipeline'
import { useProjectTabStore } from './projectTabStore'
import { placeSegmentsSequentially } from '@renderer/lib/sequentialTimelinePlace'
import { useVideoEditorStore } from './videoEditorStore'
import { useHiggsfieldStore } from './higgsfieldStore'
import type { GenerationProject, VideoEditorProject } from '@shared/types'
import { DEFAULT_ASPECT_RATIO, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@shared/types'
import type { GenerationComposerSnapshot } from '@shared/types'
import { segmentImageAttachments } from '@shared/pipelineImageRefs'
import { printPipelineStateUpdate } from '@renderer/lib/pipelineConsole'

function getLiveEditorSnapshot(projectId: string): VideoEditorProject | undefined {
  const editor = useVideoEditorStore.getState()
  if (editor.boundProjectId === projectId) {
    return editor.getProjectSnapshot()
  }
  return undefined
}

function resolveVideoEditorForSync(projectId: string): VideoEditorProject {
  const live = getLiveEditorSnapshot(projectId)
  if (live) return live
  const saved = useProjectTabStore.getState().projects[projectId]?.videoEditor
  if (saved) return saved
  throw new Error('Open the video editor and add audio to the timeline first.')
}

async function syncTimelineAudioForProject(
  projectId: string,
  videoEditor: VideoEditorProject,
  pipeline?: SegmentPipelineState
): Promise<GenerationProject> {
  if (!window.electronAPI) {
    throw new Error('Desktop API unavailable. Use the Electron app from npm run dev — not a browser tab.')
  }

  if (window.electronAPI.syncPipelineTimelineAudio) {
    return window.electronAPI.syncPipelineTimelineAudio(projectId, videoEditor, pipeline)
  }

  if (window.electronAPI.exportVideoSequence) {
    const result = await window.electronAPI.exportVideoSequence({
      mode: 'sync-pipeline-timeline-audio',
      projectId,
      videoEditor,
      pipeline,
      assets: videoEditor.assets,
      layers: videoEditor.layers,
      outputPath: ''
    })
    if ('project' in result && result.project) {
      return result.project
    }
  }

  throw new Error('Timeline audio sync is unavailable. Restart the Electron app (npm run dev) and try again.')
}

function pipelineJobSnapshot(
  projectId: string,
  pipeline: SegmentPipelineState,
  type: 'image' | 'video',
  prompt: string
): GenerationComposerSnapshot {
  const project = useProjectTabStore.getState().projects[projectId]
  return {
    type,
    context: '',
    useContextInPrompt: false,
    prompt,
    model:
      type === 'video'
        ? pipeline.videoModel ?? project?.selectedVideoModel ?? DEFAULT_VIDEO_MODEL
        : pipeline.imageModel ?? project?.selectedImageModel ?? DEFAULT_IMAGE_MODEL,
    imageAttachments: [],
    videoStartFrame: null,
    videoDuration: project?.videoDuration ?? 5,
    aspectRatio: pipeline.styleLock?.aspectRatio ?? DEFAULT_ASPECT_RATIO,
    script: '',
    audioReference: null,
    durationSource: 'manual',
    scriptMatch: null,
    linkedClipId: null,
    linkedClipSourceInMs: null,
    linkedClipSourceOutMs: null,
    autoExtraDurationSeconds: pipeline.autoExtraDurationSeconds
  }
}

function pipelineSegmentImageSnapshot(
  projectId: string,
  pipeline: SegmentPipelineState,
  segment: ScriptSegment
): GenerationComposerSnapshot {
  const base = pipelineJobSnapshot(
    projectId,
    pipeline,
    'image',
    `Segment ${segment.index + 1}: ${segment.imagePrompt}`
  )
  return {
    ...base,
    imageAttachments: segmentImageAttachments(pipeline, segment).map((media) => ({ ...media }))
  }
}

function trackPipelineJobs(projectId: string, pipeline: SegmentPipelineState): void {
  const trackJob = useProjectTabStore.getState().trackJob

  for (const character of pipeline.characters) {
    if (!character.anchorImageJobId || character.anchorImagePath) continue
    trackJob(
      character.anchorImageJobId,
      projectId,
      pipelineJobSnapshot(
        projectId,
        pipeline,
        'image',
        `Character anchor: ${character.name}`
      )
    )
  }

  for (const segment of pipeline.segments) {
    if (segment.imageJobId && !segment.imageLocalPath) {
      trackJob(
        segment.imageJobId,
        projectId,
        pipelineSegmentImageSnapshot(projectId, pipeline, segment)
      )
    }
    if (segment.videoJobId && !segment.videoLocalPath) {
      trackJob(
        segment.videoJobId,
        projectId,
        pipelineJobSnapshot(
          projectId,
          pipeline,
          'video',
          `Segment ${segment.index + 1}: ${segment.videoMotionPrompt ?? segment.imagePrompt}`
        )
      )
    }
  }
}

async function persistPipelineToProject(
  projectId: string,
  pipeline: SegmentPipelineState,
  options?: { immediate?: boolean; debounceMs?: number }
): Promise<void> {
  const normalized = normalizePipelineState(pipeline)
  // Always apply to local project state immediately so controlled editors (prompt tabs)
  // update while typing. Project save is already debounced in projectTabStore.
  useProjectTabStore.getState().updateProjectPipelineState(projectId, normalized)
  if (options?.immediate) {
    await useProjectTabStore.getState().saveProjectNow(projectId)
  }
}

export const usePipelineStore = create<{
  llmSettings: LlmSettings | null
  assemblyAiSettings: AssemblyAiSettings | null
  analyzing: boolean
  pipelineRunning: boolean
  assembling: boolean
  syncingAudio: boolean
  matchingTimings: boolean
  lastError: string | null

  loadLlmSettings: () => Promise<void>
  saveLlmSettings: (settings: LlmSettings) => Promise<void>
  loadAssemblyAiSettings: () => Promise<void>
  saveAssemblyAiSettings: (settings: AssemblyAiSettings) => Promise<void>
  analyzeAndApplyScript: (
    projectId: string,
    script: string,
    brief?: {
      creativeInstructions?: string
      scriptReferences?: import('@shared/segmentPipeline').PipelineScriptReference[]
    }
  ) => Promise<void>
  updatePipeline: (projectId: string, pipeline: SegmentPipelineState, options?: { immediate?: boolean; debounceMs?: number }) => Promise<void>
  startPipelineImages: (projectId: string) => Promise<void>
  startPipelineVideos: (projectId: string) => Promise<void>
  pausePipeline: (projectId: string) => Promise<void>
  stopPipeline: (projectId: string) => Promise<void>
  resumePipeline: (projectId: string) => Promise<void>
  retrySegment: (
    projectId: string,
    segmentId: string,
    stage: 'image' | 'video' | 'full'
  ) => Promise<void>
  dismissStuckSegment: (projectId: string, segmentId: string) => Promise<void>
  dismissStuckCharacter: (projectId: string, characterId: string) => Promise<void>
  dismissAllStuck: (projectId: string) => Promise<void>
  syncTimelineAudio: (projectId: string) => Promise<void>
  matchSegmentTimings: (projectId: string) => Promise<void>
  assembleTimeline: (projectId: string) => Promise<void>
  handlePipelineUpdated: (projectId: string, pipeline: SegmentPipelineState) => void
  initSubscriptions: () => () => void
}>((set, get) => ({
  llmSettings: null,
  assemblyAiSettings: null,
  analyzing: false,
  pipelineRunning: false,
  assembling: false,
  syncingAudio: false,
  matchingTimings: false,
  lastError: null,

  loadLlmSettings: async () => {
    if (!window.electronAPI?.getLlmSettings) return
    const settings = await window.electronAPI.getLlmSettings()
    set({ llmSettings: settings })
  },

  saveLlmSettings: async (settings) => {
    if (!window.electronAPI?.saveLlmSettings) return
    const saved = await window.electronAPI.saveLlmSettings(settings)
    set({ llmSettings: saved })
  },

  loadAssemblyAiSettings: async () => {
    if (!window.electronAPI?.getAssemblyAiSettings) return
    const settings = await window.electronAPI.getAssemblyAiSettings()
    set({ assemblyAiSettings: settings })
  },

  saveAssemblyAiSettings: async (settings) => {
    if (!window.electronAPI?.saveAssemblyAiSettings) return
    const saved = await window.electronAPI.saveAssemblyAiSettings(settings)
    set({ assemblyAiSettings: saved })
  },

  analyzeAndApplyScript: async (projectId, script, brief) => {
    if (!window.electronAPI?.applyPipelineAnalysis) {
      throw new Error('Pipeline analysis is unavailable.')
    }
    set({ analyzing: true, lastError: null })
    try {
      const trimmed = script.trim()
      console.log('[Pipeline] Analyze script requested', { projectId, scriptLength: trimmed.length })
      const current = getProjectPipeline(projectId)
      const projectMeta = useProjectTabStore.getState().projects[projectId]
      const pipelineBase = {
        ...current,
        fullScript: trimmed,
        creativeInstructions: brief?.creativeInstructions ?? current.creativeInstructions ?? '',
        scriptReferences: brief?.scriptReferences ?? current.scriptReferences ?? [],
        imageModel: current.imageModel ?? projectMeta?.selectedImageModel ?? DEFAULT_IMAGE_MODEL,
        videoModel: current.videoModel ?? projectMeta?.selectedVideoModel ?? DEFAULT_VIDEO_MODEL,
        workspaceId: current.workspaceId ?? projectMeta?.workspaceId
      }
      const project = await window.electronAPI.applyPipelineAnalysis(
        projectId,
        trimmed,
        pipelineBase
      )
      useProjectTabStore.getState().mergeProject(project)
      await useProjectTabStore.getState().saveProjectNow(projectId)
      const pipeline = getProjectPipeline(projectId)
      printPipelineStateUpdate(projectId, pipeline)
      console.log('[Pipeline] Analyze complete — segments saved to project', {
        segments: pipeline.segments.length,
        characters: pipeline.characters.length
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ lastError: message })
      throw err
    } finally {
      set({ analyzing: false })
    }
  },

  updatePipeline: async (projectId, pipeline, options) => {
    await persistPipelineToProject(projectId, pipeline, options)
  },

  startPipelineImages: async (projectId) => {
    if (!window.electronAPI?.startPipelineImages) {
      throw new Error('Pipeline is unavailable. Restart the Electron app (npm run dev).')
    }
    set({ pipelineRunning: true, lastError: null })
    try {
      await useProjectTabStore.getState().saveProjectNow(projectId)
      const pipeline = getProjectPipeline(projectId)
      console.log('[Pipeline] Generate images requested', {
        projectId,
        segments: pipeline.segments.length,
        status: pipeline.pipelineStatus
      })
      const result = await window.electronAPI.startPipelineImages(
        projectId,
        getLiveEditorSnapshot(projectId),
        pipeline
      )
      get().handlePipelineUpdated(projectId, result)
      trackPipelineJobs(projectId, result)
      printPipelineStateUpdate(projectId, result)
      void useHiggsfieldStore.getState().syncJobs()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ lastError: message, pipelineRunning: false })
      throw err
    } finally {
      const latest = getProjectPipeline(projectId)
      set({
        pipelineRunning:
          latest.pipelineStatus === 'running' || latest.pipelineStatus === 'analyzing'
      })
    }
  },

  startPipelineVideos: async (projectId) => {
    if (!window.electronAPI?.startPipelineVideos) {
      throw new Error('Pipeline is unavailable. Restart the Electron app (npm run dev).')
    }
    set({ pipelineRunning: true, lastError: null })
    try {
      await useProjectTabStore.getState().saveProjectNow(projectId)
      const pipeline = getProjectPipeline(projectId)
      console.log('[Pipeline] Generate videos requested', {
        projectId,
        segments: pipeline.segments.length,
        imagesComplete: allSegmentImagesComplete(pipeline)
      })
      const result = await window.electronAPI.startPipelineVideos(
        projectId,
        getLiveEditorSnapshot(projectId),
        pipeline
      )
      get().handlePipelineUpdated(projectId, result)
      trackPipelineJobs(projectId, result)
      printPipelineStateUpdate(projectId, result)
      void useHiggsfieldStore.getState().syncJobs()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ lastError: message, pipelineRunning: false })
      throw err
    } finally {
      const latest = getProjectPipeline(projectId)
      set({
        pipelineRunning:
          latest.pipelineStatus === 'running' || latest.pipelineStatus === 'analyzing'
      })
    }
  },

  startPipeline: async (projectId) => {
    return get().startPipelineImages(projectId)
  },

  pausePipeline: async (projectId) => {
    if (!window.electronAPI?.pausePipeline) return
    const pipeline = await window.electronAPI.pausePipeline(projectId)
    get().handlePipelineUpdated(projectId, pipeline)
    set({ pipelineRunning: false })
  },

  stopPipeline: async (projectId) => {
    if (!window.electronAPI?.stopPipeline) {
      throw new Error('Pipeline stop is unavailable. Restart the Electron app (npm run dev).')
    }
    set({ lastError: null })
    try {
      const pipeline = await window.electronAPI.stopPipeline(projectId)
      get().handlePipelineUpdated(projectId, pipeline)
      set({ pipelineRunning: false })
      void useHiggsfieldStore.getState().syncJobs()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ lastError: message })
      throw err
    }
  },

  resumePipeline: async (projectId) => {
    if (!window.electronAPI?.resumePipeline) return
    set({ pipelineRunning: true })
    const pipeline = getProjectPipeline(projectId)
    const result = await window.electronAPI.resumePipeline(
      projectId,
      getLiveEditorSnapshot(projectId),
      pipeline
    )
    get().handlePipelineUpdated(projectId, result)
    trackPipelineJobs(projectId, result)
    void useHiggsfieldStore.getState().syncJobs()
  },

  retrySegment: async (projectId, segmentId, stage) => {
    if (!window.electronAPI?.retryPipelineSegment) return
    set({ pipelineRunning: true, lastError: null })
    try {
      // Flush prompt/script edits so main loads the latest text before regenerating.
      await useProjectTabStore.getState().saveProjectNow(projectId)
      const pipeline = await window.electronAPI.retryPipelineSegment(projectId, segmentId, stage)
      get().handlePipelineUpdated(projectId, pipeline)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ lastError: message })
      throw err
    }
  },

  dismissStuckSegment: async (projectId, segmentId) => {
    if (!window.electronAPI?.dismissStuckPipelineSegment) {
      throw new Error('Clear stuck is unavailable. Restart the Electron app (npm run dev).')
    }
    const pipeline = await window.electronAPI.dismissStuckPipelineSegment(projectId, segmentId)
    get().handlePipelineUpdated(projectId, pipeline)
  },

  dismissStuckCharacter: async (projectId, characterId) => {
    if (!window.electronAPI?.dismissStuckPipelineCharacter) {
      throw new Error('Clear stuck is unavailable. Restart the Electron app (npm run dev).')
    }
    const pipeline = await window.electronAPI.dismissStuckPipelineCharacter(projectId, characterId)
    get().handlePipelineUpdated(projectId, pipeline)
  },

  dismissAllStuck: async (projectId) => {
    if (!window.electronAPI?.dismissAllStuckPipeline) {
      throw new Error('Clear stuck is unavailable. Restart the Electron app (npm run dev).')
    }
    const pipeline = await window.electronAPI.dismissAllStuckPipeline(projectId)
    get().handlePipelineUpdated(projectId, pipeline)
  },

  syncTimelineAudio: async (projectId) => {
    set({ syncingAudio: true, lastError: null })
    try {
      const videoEditor = resolveVideoEditorForSync(projectId)
      const pipeline = getProjectPipeline(projectId)
      const project = await syncTimelineAudioForProject(projectId, videoEditor, pipeline)
      useProjectTabStore.getState().mergeProject(project)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ lastError: message })
      throw err
    } finally {
      set({ syncingAudio: false })
    }
  },

  matchSegmentTimings: async (projectId) => {
    if (!window.electronAPI?.matchPipelineSegmentTimings) {
      throw new Error('Timing extraction is unavailable. Restart the Electron app (npm run dev).')
    }
    set({ matchingTimings: true, lastError: null })
    try {
      const pipeline = getProjectPipeline(projectId)
      const project = await window.electronAPI.matchPipelineSegmentTimings(projectId, pipeline)
      useProjectTabStore.getState().mergeProject(project)
      await useProjectTabStore.getState().saveProjectNow(projectId)
      printPipelineStateUpdate(projectId, normalizePipelineState(project.pipeline))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ lastError: message })
      throw err
    } finally {
      set({ matchingTimings: false })
    }
  },

  assembleTimeline: async (projectId) => {
    const project = useProjectTabStore.getState().projects[projectId]
    const pipeline = normalizePipelineState(project?.pipeline)
    const segments = pipeline.segments.filter((s) => s.videoLocalPath)

    if (segments.length === 0) {
      throw new Error('No completed videos to assemble.')
    }

    set({ assembling: true, lastError: null })
    try {
      if (project) {
        useVideoEditorStore.getState().loadFromGenerationProject(
          projectId,
          project.name,
          project.videoEditor
        )
      }

      const placements = await placeSegmentsSequentially(segments, { addSyncMarkers: true })

      useProjectTabStore.getState().saveVideoEditorForProject(projectId)

      if (window.electronAPI?.markPipelineTimeline) {
        const updated = await window.electronAPI.markPipelineTimeline(projectId, placements)
        useProjectTabStore.getState().mergeProject(updated)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ lastError: message })
      throw err
    } finally {
      set({ assembling: false })
    }
  },

  handlePipelineUpdated: (projectId, pipeline) => {
    const syncRunningFlag = (status: SegmentPipelineState['pipelineStatus'] | undefined): void => {
      set({
        pipelineRunning: status === 'running' || status === 'analyzing'
      })
    }

    if (!pipeline) {
      syncRunningFlag(undefined)
      return
    }

    const normalized = normalizePipelineState(pipeline)
    const current = getProjectPipeline(projectId)

    // Refuse corrupt IPC payloads that would wipe analyzed segments.
    if (current.segments.length > 0 && normalized.segments.length === 0) {
      syncRunningFlag(current.pipelineStatus)
      return
    }

    useProjectTabStore.getState().updateProjectPipelineState(projectId, normalized)
    trackPipelineJobs(projectId, normalized)
    void useHiggsfieldStore.getState().syncJobs()
    printPipelineStateUpdate(projectId, normalized)

    syncRunningFlag(normalized.pipelineStatus)
  },

  initSubscriptions: () => {
    const unsub = window.electronAPI?.onPipelineUpdated?.((payload) => {
      get().handlePipelineUpdated(payload.projectId, payload.pipeline)
    })
    return () => unsub?.()
  }
}))

export function getProjectPipeline(projectId: string): SegmentPipelineState {
  const project = useProjectTabStore.getState().projects[projectId]
  return normalizePipelineState(project?.pipeline ?? createEmptyPipelineState())
}

export function updateSegmentInPipeline(
  pipeline: SegmentPipelineState,
  segmentId: string,
  patch: Partial<ScriptSegment>
): SegmentPipelineState {
  return {
    ...pipeline,
    segments: pipeline.segments.map((s) => (s.id === segmentId ? { ...s, ...patch } : s))
  }
}
