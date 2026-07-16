import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  DetectionParams,
  DetectionResult,
  EditOperation,
  ExportOptions,
  ExportResult,
  HiggsfieldEnqueueRequest,
  HiggsfieldGenerateRequest,
  HiggsfieldGenerateResult,
  HiggsfieldGenerationJob,
  HiggsfieldModel,
  HiggsfieldModelCategory,
  HiggsfieldModelSchema,
  HiggsfieldStatus,
  HiggsfieldVoice,
  HiggsfieldWorkspace,
  LoadedAudioProject,
  Preset,
  AppSession,
  AppTab,
  GenerationProject,
  ProjectSummary,
  ProjectGeneration,
  MediaAsset,
  TimelineLayer,
  VideoEditorProject,
  VideoFilmstrip,
  WaveformPeaks
} from '../shared/types'
import type {
  LlmSettings,
  AssemblyAiSettings,
  SegmentPipelineState
} from '../shared/segmentPipeline'

export interface ElectronAPI {
  openFile: () => Promise<string | null>
  openImageFile: () => Promise<string | null>
  saveFile: (defaultName: string) => Promise<string | null>
  saveVideoFile: (defaultName: string) => Promise<string | null>
  loadAudio: (filePath: string) => Promise<LoadedAudioProject>
  getAudioPeaks: (filePath: string) => Promise<{ sampleRate: number; peaks: WaveformPeaks; durationMs: number }>
  detectSilence: (params: DetectionParams) => Promise<DetectionResult>
  exportAudio: (
    operations: EditOperation[],
    options: ExportOptions,
    crossfadeMs: number
  ) => Promise<ExportResult>
  exportAudioTemp: (operations: EditOperation[], crossfadeMs: number) => Promise<ExportResult>
  getPresets: () => Promise<Preset[]>
  savePresets: (presets: Preset[]) => Promise<boolean>
  getHiggsfieldStatus: () => Promise<HiggsfieldStatus>
  loginHiggsfield: () => Promise<boolean>
  listHiggsfieldModels: (category: HiggsfieldModelCategory) => Promise<HiggsfieldModel[]>
  getHiggsfieldModel: (modelId: string) => Promise<HiggsfieldModelSchema | null>
  listHiggsfieldVoices: () => Promise<HiggsfieldVoice[]>
  listHiggsfieldWorkspaces: () => Promise<HiggsfieldWorkspace[]>
  setHiggsfieldWorkspace: (workspaceId: string) => Promise<HiggsfieldWorkspace | null>
  generateHiggsfieldContent: (request: HiggsfieldGenerateRequest) => Promise<HiggsfieldGenerateResult>
  enqueueHiggsfieldJob: (request: HiggsfieldEnqueueRequest) => Promise<HiggsfieldGenerationJob>
  cancelHiggsfieldJob: (jobId: string) => Promise<boolean>
  listHiggsfieldJobs: () => Promise<HiggsfieldGenerationJob[]>
  resolveHiggsfieldReference: (url: string) => Promise<{ url: string; localPath: string }>
  getLogFilePath: () => Promise<string>
  openLogFile: () => Promise<string>
  openExternal: (url: string) => Promise<boolean>
  onDetectionProgress: (callback: (value: number) => void) => () => void
  onHiggsfieldProgress: (callback: (message: string) => void) => () => void
  onHiggsfieldJobUpdated: (callback: (job: HiggsfieldGenerationJob) => void) => () => void
  onMenuOpen: (callback: () => void) => () => void
  onMenuExport: (callback: () => void) => () => void
  onMenuUndo: (callback: () => void) => () => void
  onMenuRedo: (callback: () => void) => () => void
  onShowShortcuts: (callback: () => void) => () => void
  getPathForFile: (file: File) => string
  listProjects: () => Promise<ProjectSummary[]>
  loadProject: (projectId: string) => Promise<GenerationProject | null>
  saveProject: (project: GenerationProject) => Promise<GenerationProject>
  createProject: (name?: string) => Promise<GenerationProject>
  deleteProject: (projectId: string) => Promise<boolean>
  importProjectMedia: (projectId: string, sourcePath: string) => Promise<{ localPath: string; name: string }>
  ensureGenerationMedia: (
    projectId: string,
    generation: ProjectGeneration
  ) => Promise<{ localPath: string; name: string }>
  importProjectMediaBytes: (
    projectId: string,
    fileName: string,
    data: ArrayBuffer
  ) => Promise<{ localPath: string; name: string }>
  hydrateGenerationDraft: (
    projectId: string,
    generation: import('../shared/types').ProjectGeneration
  ) => Promise<import('../shared/types').GenerationModeDraft>
  loadSession: () => Promise<AppSession | null>
  saveSession: (session: AppSession) => Promise<boolean>
  openVideoFile: () => Promise<string[]>
  probeMediaFile: (filePath: string) => Promise<Omit<MediaAsset, 'id'>>
  getVideoFilmstrip: (payload: {
    filePath: string
    durationMs: number
    type: MediaAsset['type']
  }) => Promise<VideoFilmstrip>
  exportVideoSequence: (payload: {
    mode?: 'sync-pipeline-timeline-audio' | 'timeline-audio'
    projectId?: string
    videoEditor?: VideoEditorProject
    pipeline?: SegmentPipelineState
    assets: MediaAsset[]
    layers: TimelineLayer[]
    outputPath: string
    options?: import('../shared/videoExport').VideoExportOptions
  }) => Promise<
    | { outputPath: string; durationMs: number }
    | { project: GenerationProject }
  >
  saveMediaAs: (payload: {
    url?: string
    localPath?: string
    defaultName: string
  }) => Promise<string | null>
  saveMediaManyAs: (payload: {
    items: Array<{ url?: string; localPath?: string; defaultName: string }>
  }) => Promise<{ dir: string | null; saved: number; failed: string[] }>
  readClipboardImage: () => Promise<{ data: ArrayBuffer; fileName: string } | null>
  saveVideoEditorProject: (project: VideoEditorProject) => Promise<string | null>
  alignScriptAudio: (payload: {
    audioPath: string
    script: string
    trimStartMs?: number
    trimEndMs?: number
  }) => Promise<import('../shared/types').ScriptAudioMatch>
  getLlmSettings: () => Promise<LlmSettings>
  saveLlmSettings: (settings: LlmSettings) => Promise<LlmSettings>
  getAssemblyAiSettings: () => Promise<AssemblyAiSettings>
  saveAssemblyAiSettings: (settings: AssemblyAiSettings) => Promise<AssemblyAiSettings>
  analyzeScript: (
    input: string | import('../shared/segmentPipeline').AnalyzeScriptInput
  ) => Promise<import('../shared/segmentPipeline').LlmAnalyzeResult>
  applyPipelineAnalysis: (
    projectId: string,
    script: string,
    pipeline?: SegmentPipelineState
  ) => Promise<GenerationProject>
  applyPipelineParts: (
    projectId: string,
    pipeline?: SegmentPipelineState
  ) => Promise<GenerationProject>
  updateProjectPipeline: (projectId: string, pipeline: SegmentPipelineState) => Promise<GenerationProject>
  syncPipelineTimelineAudio: (
    projectId: string,
    videoEditor?: VideoEditorProject,
    pipeline?: SegmentPipelineState
  ) => Promise<GenerationProject>
  matchPipelineSegmentTimings: (
    projectId: string,
    pipeline?: SegmentPipelineState
  ) => Promise<GenerationProject>
  startPipeline: (
    projectId: string,
    videoEditor?: VideoEditorProject,
    pipeline?: SegmentPipelineState
  ) => Promise<SegmentPipelineState>
  startPipelineImages: (
    projectId: string,
    videoEditor?: VideoEditorProject,
    pipeline?: SegmentPipelineState
  ) => Promise<SegmentPipelineState>
  startPipelineVideos: (
    projectId: string,
    videoEditor?: VideoEditorProject,
    pipeline?: SegmentPipelineState
  ) => Promise<SegmentPipelineState>
  pausePipeline: (projectId: string) => Promise<SegmentPipelineState>
  stopPipeline: (projectId: string) => Promise<SegmentPipelineState>
  resumePipeline: (
    projectId: string,
    videoEditor?: VideoEditorProject,
    pipeline?: SegmentPipelineState
  ) => Promise<SegmentPipelineState>
  retryPipelineSegment: (
    projectId: string,
    segmentId: string,
    stage: 'image' | 'video' | 'full'
  ) => Promise<SegmentPipelineState>
  dismissStuckPipelineSegment: (
    projectId: string,
    segmentId: string
  ) => Promise<SegmentPipelineState>
  dismissStuckPipelineCharacter: (
    projectId: string,
    characterId: string
  ) => Promise<SegmentPipelineState>
  dismissAllStuckPipeline: (projectId: string) => Promise<SegmentPipelineState>
  markPipelineTimeline: (
    projectId: string,
    placements: Array<{ segmentId: string; clipId: string }>
  ) => Promise<GenerationProject>
  onPipelineUpdated: (
    callback: (payload: { projectId: string; pipeline: SegmentPipelineState }) => void
  ) => () => void
  onPipelineLog: (
    callback: (event: import('../shared/pipelineDebug').PipelineLogEvent) => void
  ) => () => void
}

function subscribe(channel: string, callback: () => void): () => void {
  const handler = (): void => callback()
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: ElectronAPI = {
  openFile: () => ipcRenderer.invoke(IPC.OPEN_FILE),
  openImageFile: () => ipcRenderer.invoke(IPC.OPEN_IMAGE_FILE),
  saveFile: (defaultName) => ipcRenderer.invoke(IPC.SAVE_FILE, defaultName),
  saveVideoFile: (defaultName) => ipcRenderer.invoke(IPC.SAVE_VIDEO_FILE, defaultName),
  loadAudio: (filePath) => ipcRenderer.invoke(IPC.LOAD_AUDIO, filePath),
  getAudioPeaks: (filePath) => ipcRenderer.invoke(IPC.AUDIO_PEAKS, filePath),
  detectSilence: (params) => ipcRenderer.invoke(IPC.DETECT_SILENCE, params),
  exportAudio: (operations, options, crossfadeMs) =>
    ipcRenderer.invoke(IPC.EXPORT_AUDIO, operations, options, crossfadeMs),
  exportAudioTemp: (operations, crossfadeMs) =>
    ipcRenderer.invoke(IPC.EXPORT_AUDIO_TEMP, operations, crossfadeMs),
  getPresets: () => ipcRenderer.invoke(IPC.GET_PRESETS),
  savePresets: (presets) => ipcRenderer.invoke(IPC.SAVE_PRESETS, presets),
  getHiggsfieldStatus: () => ipcRenderer.invoke(IPC.HIGGSFIELD_STATUS),
  loginHiggsfield: () => ipcRenderer.invoke(IPC.HIGGSFIELD_LOGIN),
  listHiggsfieldModels: (category) => ipcRenderer.invoke(IPC.HIGGSFIELD_MODELS, category),
  getHiggsfieldModel: (modelId) => ipcRenderer.invoke(IPC.HIGGSFIELD_MODEL, modelId),
  listHiggsfieldVoices: () => ipcRenderer.invoke(IPC.HIGGSFIELD_VOICES),
  listHiggsfieldWorkspaces: () => ipcRenderer.invoke(IPC.HIGGSFIELD_WORKSPACES),
  setHiggsfieldWorkspace: (workspaceId) => ipcRenderer.invoke(IPC.HIGGSFIELD_SET_WORKSPACE, workspaceId),
  generateHiggsfieldContent: (request) => ipcRenderer.invoke(IPC.HIGGSFIELD_GENERATE, request),
  enqueueHiggsfieldJob: (request) => ipcRenderer.invoke(IPC.HIGGSFIELD_ENQUEUE, request),
  cancelHiggsfieldJob: (jobId) => ipcRenderer.invoke(IPC.HIGGSFIELD_CANCEL_JOB, jobId),
  listHiggsfieldJobs: () => ipcRenderer.invoke(IPC.HIGGSFIELD_LIST_JOBS),
  resolveHiggsfieldReference: (url) => ipcRenderer.invoke(IPC.HIGGSFIELD_RESOLVE_REFERENCE, url),
  getLogFilePath: () => ipcRenderer.invoke(IPC.LOG_GET_PATH),
  openLogFile: () => ipcRenderer.invoke(IPC.LOG_OPEN),
  openExternal: (url) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
  onDetectionProgress: (callback) => {
    const handler = (_: unknown, value: number): void => callback(value)
    ipcRenderer.on(IPC.DETECTION_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.DETECTION_PROGRESS, handler)
  },
  onHiggsfieldProgress: (callback) => {
    const handler = (_: unknown, message: string): void => callback(message)
    ipcRenderer.on(IPC.HIGGSFIELD_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.HIGGSFIELD_PROGRESS, handler)
  },
  onHiggsfieldJobUpdated: (callback) => {
    const handler = (_: unknown, job: HiggsfieldGenerationJob): void => callback(job)
    ipcRenderer.on(IPC.HIGGSFIELD_JOB_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC.HIGGSFIELD_JOB_UPDATED, handler)
  },
  onMenuOpen: (callback) => subscribe(IPC.MENU_OPEN, callback),
  onMenuExport: (callback) => subscribe(IPC.MENU_EXPORT, callback),
  onMenuUndo: (callback) => subscribe(IPC.MENU_UNDO, callback),
  onMenuRedo: (callback) => subscribe(IPC.MENU_REDO, callback),
  onShowShortcuts: (callback) => subscribe(IPC.SHOW_SHORTCUTS, callback),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  listProjects: () => ipcRenderer.invoke(IPC.PROJECT_LIST),
  loadProject: (projectId) => ipcRenderer.invoke(IPC.PROJECT_LOAD, projectId),
  saveProject: (project) => ipcRenderer.invoke(IPC.PROJECT_SAVE, project),
  createProject: (name) => ipcRenderer.invoke(IPC.PROJECT_CREATE, name),
  deleteProject: (projectId) => ipcRenderer.invoke(IPC.PROJECT_DELETE, projectId),
  importProjectMedia: (projectId, sourcePath) =>
    ipcRenderer.invoke(IPC.PROJECT_IMPORT_MEDIA, projectId, sourcePath),
  ensureGenerationMedia: (projectId, generation) =>
    ipcRenderer.invoke(IPC.PROJECT_ENSURE_GENERATION_MEDIA, projectId, generation),
  importProjectMediaBytes: (projectId, fileName, data) =>
    ipcRenderer.invoke(IPC.PROJECT_IMPORT_MEDIA_BYTES, projectId, fileName, data),
  hydrateGenerationDraft: (projectId, generation) =>
    ipcRenderer.invoke(IPC.PROJECT_HYDRATE_DRAFT, projectId, generation),
  loadSession: () => ipcRenderer.invoke(IPC.SESSION_LOAD),
  saveSession: (session) => ipcRenderer.invoke(IPC.SESSION_SAVE, session),
  openVideoFile: () => ipcRenderer.invoke(IPC.OPEN_VIDEO_FILE),
  probeMediaFile: (filePath) => ipcRenderer.invoke(IPC.VIDEO_PROBE, filePath),
  getVideoFilmstrip: (payload) => ipcRenderer.invoke(IPC.VIDEO_FILMSTRIP, payload),
  exportVideoSequence: (payload) => ipcRenderer.invoke(IPC.VIDEO_EXPORT, payload),
  saveMediaAs: (payload) => ipcRenderer.invoke(IPC.MEDIA_SAVE_AS, payload),
  saveMediaManyAs: (payload) => ipcRenderer.invoke(IPC.MEDIA_SAVE_MANY, payload),
  readClipboardImage: () => ipcRenderer.invoke(IPC.CLIPBOARD_READ_IMAGE),
  saveVideoEditorProject: (project) => ipcRenderer.invoke(IPC.VIDEO_EDITOR_PROJECT_SAVE, project),
  alignScriptAudio: (payload) => ipcRenderer.invoke(IPC.ALIGN_SCRIPT_AUDIO, payload),
  getLlmSettings: () => ipcRenderer.invoke(IPC.LLM_SETTINGS_GET),
  saveLlmSettings: (settings) => ipcRenderer.invoke(IPC.LLM_SETTINGS_SAVE, settings),
  getAssemblyAiSettings: () => ipcRenderer.invoke(IPC.ASSEMBLYAI_SETTINGS_GET),
  saveAssemblyAiSettings: (settings) =>
    ipcRenderer.invoke(IPC.ASSEMBLYAI_SETTINGS_SAVE, settings),
  analyzeScript: (script) => ipcRenderer.invoke(IPC.LLM_ANALYZE_SCRIPT, script),
  applyPipelineAnalysis: (projectId, script, pipeline) =>
    ipcRenderer.invoke(IPC.PROJECT_APPLY_PIPELINE_ANALYSIS, { projectId, script, pipeline }),
  applyPipelineParts: (projectId, pipeline) =>
    ipcRenderer.invoke(IPC.PROJECT_APPLY_PIPELINE_PARTS, { projectId, pipeline }),
  updateProjectPipeline: (projectId, pipeline) =>
    ipcRenderer.invoke(IPC.PROJECT_UPDATE_PIPELINE, { projectId, pipeline }),
  syncPipelineTimelineAudio: (projectId, videoEditor, pipeline) =>
    ipcRenderer.invoke(IPC.PROJECT_SYNC_PIPELINE_TIMELINE_AUDIO, {
      projectId,
      videoEditor,
      pipeline
    }),
  matchPipelineSegmentTimings: (projectId, pipeline) =>
    ipcRenderer.invoke(IPC.PROJECT_MATCH_PIPELINE_SEGMENT_TIMINGS, {
      projectId,
      pipeline
    }),
  startPipeline: (projectId, videoEditor, pipeline) =>
    ipcRenderer.invoke(IPC.PIPELINE_START_IMAGES, { projectId, videoEditor, pipeline }),
  startPipelineImages: (projectId, videoEditor, pipeline) =>
    ipcRenderer.invoke(IPC.PIPELINE_START_IMAGES, { projectId, videoEditor, pipeline }),
  startPipelineVideos: (projectId, videoEditor, pipeline) =>
    ipcRenderer.invoke(IPC.PIPELINE_START_VIDEOS, { projectId, videoEditor, pipeline }),
  pausePipeline: (projectId) => ipcRenderer.invoke(IPC.PIPELINE_PAUSE, projectId),
  stopPipeline: (projectId) => ipcRenderer.invoke(IPC.PIPELINE_STOP, projectId),
  resumePipeline: (projectId, videoEditor, pipeline) =>
    ipcRenderer.invoke(IPC.PIPELINE_RESUME, { projectId, videoEditor, pipeline }),
  retryPipelineSegment: (projectId, segmentId, stage) =>
    ipcRenderer.invoke(IPC.PIPELINE_RETRY_SEGMENT, { projectId, segmentId, stage }),
  dismissStuckPipelineSegment: (projectId, segmentId) =>
    ipcRenderer.invoke(IPC.PIPELINE_DISMISS_STUCK_SEGMENT, { projectId, segmentId }),
  dismissStuckPipelineCharacter: (projectId, characterId) =>
    ipcRenderer.invoke(IPC.PIPELINE_DISMISS_STUCK_CHARACTER, { projectId, characterId }),
  dismissAllStuckPipeline: (projectId) =>
    ipcRenderer.invoke(IPC.PIPELINE_DISMISS_ALL_STUCK, projectId),
  markPipelineTimeline: (projectId, placements) =>
    ipcRenderer.invoke(IPC.PIPELINE_MARK_TIMELINE, { projectId, placements }),
  onPipelineUpdated: (callback) => {
    const handler = (
      _: unknown,
      payload: { projectId: string; pipeline: SegmentPipelineState }
    ): void => callback(payload)
    ipcRenderer.on(IPC.PIPELINE_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC.PIPELINE_UPDATED, handler)
  },
  onPipelineLog: (callback) => {
    const handler = (_: unknown, event: import('../shared/pipelineDebug').PipelineLogEvent): void =>
      callback(event)
    ipcRenderer.on(IPC.PIPELINE_LOG, handler)
    return () => ipcRenderer.removeListener(IPC.PIPELINE_LOG, handler)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
