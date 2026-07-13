import { ipcMain, dialog, BrowserWindow, shell, clipboard } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type {
  DetectionParams,
  DetectionResult,
  ExportOptions,
  ExportResult,
  LoadedAudioProject,
  Preset,
  EditOperation,
  AppSession,
  GenerationProject,
  MediaAsset,
  TimelineLayer,
  VideoEditorProject,
  VideoFilmstrip,
  WaveformPeaks
} from '../../shared/types'
import { decodeAudio, serializePeaks } from '../audio/decode'
import { generatePeaksFromAudioFile } from '../audio/peaks-from-file'
import { exportAudio } from '../audio/export'
import { applyPaddingToRegions, mergeOverlappingRegions } from '../audio/apply-silence'
import { detectTraditionalSilence } from '../detection/traditional'
import { detectVadSilence } from '../detection/silero-vad'
import { mergeRegionsHybrid } from '../detection/merge-regions'
import {
  formatHiggsfieldError,
  generateHiggsfieldContent,
  getHiggsfieldModelSchema,
  getHiggsfieldStatus,
  listHiggsfieldModels,
  listHiggsfieldVoices,
  listHiggsfieldWorkspaces,
  loginHiggsfield,
  setHiggsfieldWorkspace
} from '../higgsfield/service'
import {
  cancelJob,
  enqueueJob,
  listJobs,
  resolveReferenceUrl,
  setJobUpdateCallback
} from '../higgsfield/queue'
import type {
  HiggsfieldEnqueueRequest,
  HiggsfieldGenerateRequest,
  HiggsfieldModelCategory
} from '../../shared/types'
import { getLogFilePath, logError } from '../logger'
import { probeMediaFile } from '../video/probe'
import { exportTimelineAudioMix, exportVideoSequence } from '../video/export'
import type { VideoExportOptions } from '../../shared/videoExport'
import { filmstripForImage, generateVideoFilmstrip } from '../video/filmstrip'
import { downloadMedia } from '../higgsfield/cli'
import {
  createProject,
  deleteProject,
  importMediaToProject,
  importMediaBytesToProject,
  listProjectSummaries,
  loadProject,
  loadSession,
  saveProject,
  saveSession
} from '../projects/store'
import { hydrateGenerationDraft, ensureGenerationMediaInProject } from '../projects/media'
import { alignScriptAudio } from '../alignment/alignScript'
import { batchMatchScriptAudio } from '../alignment/batchMatchScript'
import { analyzeScript } from '../intelligence/analyzeScript'
import { applyAnalysisToPipeline } from '../intelligence/applyAnalysis'
import { loadLlmSettings, saveLlmSettings } from '../llm/settings'
import {
  loadAssemblyAiSettings,
  saveAssemblyAiSettings
} from '../alignment/assemblyaiSettings'
import { clearTranscriptCache } from '../alignment/transcriptCache'
import {
  getPipelineState,
  handlePipelineJobUpdate,
  markSegmentsTimelinePlaced,
  pausePipeline,
  stopPipeline,
  resumePipeline,
  retrySegment,
  dismissStuckSegment,
  dismissStuckCharacter,
  dismissAllStuckRunning,
  setPipelineNotifyCallback,
  startPipelineImages,
  startPipelineVideos
} from '../pipeline/orchestrator'
import { syncPipelineMasterAudioFromTimeline } from '../pipeline/timelineAudio'
import { setPipelineLogCallback, pipelineDebugLog } from '../pipeline/debugLog'
import {
  normalizePipelineState,
  createEmptyPipelineState,
  normalizeLoadedGenerationProject
} from '../../shared/segmentPipeline'
import type { LlmSettings } from '../../shared/segmentPipeline'

let currentPcmPath: string | null = null
let currentMetadata: LoadedAudioProject['metadata'] | null = null

function getPresetsPath(): string {
  return join(app.getPath('userData'), 'presets.json')
}

async function loadPresetsFile(): Promise<Preset[]> {
  try {
    const raw = await fs.readFile(getPresetsPath(), 'utf-8')
    return JSON.parse(raw) as Preset[]
  } catch {
    return []
  }
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  setJobUpdateCallback((job) => {
    const win = getWindow()
    win?.webContents.send(IPC.HIGGSFIELD_JOB_UPDATED, job)
    void handlePipelineJobUpdate(job)
  })

  setPipelineNotifyCallback((projectId, pipeline) => {
    const win = getWindow()
    win?.webContents.send(IPC.PIPELINE_UPDATED, { projectId, pipeline })
  })

  setPipelineLogCallback((event) => {
    const win = getWindow()
    win?.webContents.send(IPC.PIPELINE_LOG, event)
  })

  ipcMain.handle(IPC.OPEN_FILE, async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win ?? undefined, {
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio',
          extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'aac']
        }
      ]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.SAVE_FILE, async (_e, defaultName: string) => {
    const win = getWindow()
    const result = await dialog.showSaveDialog(win ?? undefined, {
      defaultPath: defaultName,
      filters: [
        { name: 'WAV', extensions: ['wav'] },
        { name: 'MP3', extensions: ['mp3'] },
        { name: 'FLAC', extensions: ['flac'] }
      ]
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle(IPC.SAVE_VIDEO_FILE, async (_e, defaultName: string) => {
    const win = getWindow()
    const baseName = defaultName.replace(/\.[^.]+$/, '')
    const result = await dialog.showSaveDialog(win ?? undefined, {
      defaultPath: `${baseName}.mp4`,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    })
    if (result.canceled || !result.filePath) return null
    const filePath = result.filePath.toLowerCase().endsWith('.mp4')
      ? result.filePath
      : `${result.filePath.replace(/\.[^.]+$/, '')}.mp4`
    return filePath
  })

  ipcMain.handle(IPC.VIDEO_EDITOR_PROJECT_SAVE, async (_e, project: VideoEditorProject) => {
    const win = getWindow()
    const result = await dialog.showSaveDialog(win ?? undefined, {
      defaultPath: `${project.name || 'sequence'}.json`,
      filters: [{ name: 'Video Editor Project', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(result.filePath, JSON.stringify(project, null, 2), 'utf-8')
    return result.filePath
  })

  ipcMain.handle(IPC.OPEN_IMAGE_FILE, async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win ?? undefined, {
      properties: ['openFile'],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif']
        }
      ]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.PROJECT_LIST, async () => listProjectSummaries())

  ipcMain.handle(IPC.PROJECT_LOAD, async (_e, projectId: string) => {
    const project = await loadProject(projectId)
    if (!project?.pipeline) return project
    const pipeline = await getPipelineState(projectId)
    if (!pipeline) return project
    return { ...project, pipeline }
  })

  ipcMain.handle(IPC.PROJECT_SAVE, async (_e, project: GenerationProject) => saveProject(project))

  ipcMain.handle(IPC.PROJECT_CREATE, async (_e, name?: string) => createProject(name))

  ipcMain.handle(IPC.PROJECT_DELETE, async (_e, projectId: string) => deleteProject(projectId))

  ipcMain.handle(IPC.PROJECT_IMPORT_MEDIA, async (_e, projectId: string, sourcePath: string) =>
    importMediaToProject(projectId, sourcePath)
  )

  ipcMain.handle(
    IPC.PROJECT_IMPORT_MEDIA_BYTES,
    async (_e, projectId: string, fileName: string, data: ArrayBuffer) =>
      importMediaBytesToProject(projectId, fileName, data)
  )

  ipcMain.handle(
    IPC.PROJECT_HYDRATE_DRAFT,
    async (_e, projectId: string, generation: import('../../shared/types').ProjectGeneration) =>
      hydrateGenerationDraft(projectId, generation)
  )

  ipcMain.handle(
    IPC.PROJECT_ENSURE_GENERATION_MEDIA,
    async (_e, projectId: string, generation: import('../../shared/types').ProjectGeneration) =>
      ensureGenerationMediaInProject(projectId, generation)
  )

  ipcMain.handle(
    IPC.ALIGN_SCRIPT_AUDIO,
    async (
      _e,
      payload: { audioPath: string; script: string; trimStartMs?: number; trimEndMs?: number }
    ) => alignScriptAudio(payload.audioPath, payload.script, payload.trimStartMs, payload.trimEndMs)
  )

  ipcMain.handle(IPC.BATCH_ALIGN_SCRIPT_AUDIO, async (_e, payload) =>
    batchMatchScriptAudio(payload)
  )

  ipcMain.handle(IPC.LLM_SETTINGS_GET, async () => loadLlmSettings())

  ipcMain.handle(IPC.LLM_SETTINGS_SAVE, async (_e, settings: LlmSettings) =>
    saveLlmSettings(settings)
  )

  ipcMain.handle(IPC.ASSEMBLYAI_SETTINGS_GET, async () => loadAssemblyAiSettings())

  ipcMain.handle(
    IPC.ASSEMBLYAI_SETTINGS_SAVE,
    async (_e, settings: import('../../shared/segmentPipeline').AssemblyAiSettings) => {
      const saved = await saveAssemblyAiSettings(settings)
      clearTranscriptCache()
      return saved
    }
  )

  ipcMain.handle(IPC.LLM_ANALYZE_SCRIPT, async (_e, input: string | import('../../shared/segmentPipeline').AnalyzeScriptInput) =>
    analyzeScript(input)
  )

  ipcMain.handle(IPC.PIPELINE_GET_STATE, async (_e, projectId: string) =>
    getPipelineState(projectId)
  )

  ipcMain.handle(
    IPC.PIPELINE_START,
    async (
      _e,
      payload:
        | string
        | {
            projectId: string
            videoEditor?: VideoEditorProject
            pipeline?: import('../../shared/segmentPipeline').SegmentPipelineState
          }
    ) => {
      const projectId = typeof payload === 'string' ? payload : payload.projectId
      const videoEditor = typeof payload === 'string' ? undefined : payload.videoEditor
      const pipeline = typeof payload === 'string' ? undefined : payload.pipeline
      return startPipelineImages(projectId, videoEditor, pipeline)
    }
  )

  ipcMain.handle(
    IPC.PIPELINE_START_IMAGES,
    async (
      _e,
      payload: {
        projectId: string
        videoEditor?: VideoEditorProject
        pipeline?: import('../../shared/segmentPipeline').SegmentPipelineState
      }
    ) => startPipelineImages(payload.projectId, payload.videoEditor, payload.pipeline)
  )

  ipcMain.handle(
    IPC.PIPELINE_START_VIDEOS,
    async (
      _e,
      payload: {
        projectId: string
        videoEditor?: VideoEditorProject
        pipeline?: import('../../shared/segmentPipeline').SegmentPipelineState
      }
    ) => startPipelineVideos(payload.projectId, payload.videoEditor, payload.pipeline)
  )

  ipcMain.handle(IPC.PIPELINE_PAUSE, async (_e, projectId: string) => pausePipeline(projectId))

  ipcMain.handle(IPC.PIPELINE_STOP, async (_e, projectId: string) => stopPipeline(projectId))

  ipcMain.handle(
    IPC.PIPELINE_RESUME,
    async (
      _e,
      payload:
        | string
        | {
            projectId: string
            videoEditor?: VideoEditorProject
            pipeline?: import('../../shared/segmentPipeline').SegmentPipelineState
          }
    ) => {
      const projectId = typeof payload === 'string' ? payload : payload.projectId
      const videoEditor = typeof payload === 'string' ? undefined : payload.videoEditor
      const pipeline = typeof payload === 'string' ? undefined : payload.pipeline
      return resumePipeline(projectId, videoEditor, pipeline)
    }
  )

  ipcMain.handle(
    IPC.PIPELINE_RETRY_SEGMENT,
    async (_e, payload: { projectId: string; segmentId: string; stage: 'image' | 'video' | 'full' }) =>
      retrySegment(payload.projectId, payload.segmentId, payload.stage)
  )

  ipcMain.handle(
    IPC.PIPELINE_DISMISS_STUCK_SEGMENT,
    async (_e, payload: { projectId: string; segmentId: string }) =>
      dismissStuckSegment(payload.projectId, payload.segmentId)
  )

  ipcMain.handle(
    IPC.PIPELINE_DISMISS_STUCK_CHARACTER,
    async (_e, payload: { projectId: string; characterId: string }) =>
      dismissStuckCharacter(payload.projectId, payload.characterId)
  )

  ipcMain.handle(IPC.PIPELINE_DISMISS_ALL_STUCK, async (_e, projectId: string) =>
    dismissAllStuckRunning(projectId)
  )

  ipcMain.handle(
    IPC.PIPELINE_MARK_TIMELINE,
    async (
      _e,
      payload: { projectId: string; placements: Array<{ segmentId: string; clipId: string }> }
    ) => markSegmentsTimelinePlaced(payload.projectId, payload.placements)
  )

  ipcMain.handle(
    IPC.PROJECT_APPLY_PIPELINE_ANALYSIS,
    async (
      _e,
      payload: {
        projectId: string
        script: string
        pipeline?: import('../../shared/segmentPipeline').SegmentPipelineState
      }
    ) => {
      const loaded = await loadProject(payload.projectId)
      if (!loaded) throw new Error('Project not found.')
      const project = normalizeLoadedGenerationProject(loaded)
      const script = payload.script.trim()
      if (!script) throw new Error('Script is empty.')

      const base = normalizePipelineState(
        payload.pipeline ?? project.pipeline ?? createEmptyPipelineState()
      )
      const analysis = await analyzeScript({
        script,
        creativeInstructions: base.creativeInstructions,
        references: (base.scriptReferences ?? []).map((ref) => ({
          id: ref.id,
          name: ref.name,
          instruction: ref.instruction
        }))
      })
      const pipeline = applyAnalysisToPipeline(
        {
          ...base,
          fullScript: script,
          creativeInstructions: base.creativeInstructions,
          scriptReferences: base.scriptReferences,
          imageModel: base.imageModel ?? project.selectedImageModel,
          videoModel: base.videoModel ?? project.selectedVideoModel,
          workspaceId: base.workspaceId ?? project.workspaceId
        },
        analysis
      )
      pipelineDebugLog(payload.projectId, 'step', 'analyze', 'Script analysis complete', {
        segmentCount: pipeline.segments.length,
        characterCount: pipeline.characters.length,
        creativeInstructions: Boolean(pipeline.creativeInstructions?.trim()),
        scriptReferences: pipeline.scriptReferences?.length ?? 0,
        styleLock: pipeline.styleLock,
        segments: pipeline.segments.map((s) => ({
          n: s.index + 1,
          script: s.scriptText.slice(0, 80),
          imagePrompt: s.imagePrompt.slice(0, 120),
          videoMotion: s.videoMotionPrompt?.slice(0, 80),
          referenceIds: s.scriptReferenceIds,
          characters: s.characters
        })),
        characters: pipeline.characters.map((c) => ({
          name: c.name,
          description: c.description.slice(0, 100)
        }))
      })
      return saveProject({ ...project, pipeline, updatedAt: Date.now() })
    }
  )

  ipcMain.handle(
    IPC.PROJECT_UPDATE_PIPELINE,
    async (_e, payload: { projectId: string; pipeline: import('../../shared/segmentPipeline').SegmentPipelineState }) => {
      const project = await loadProject(payload.projectId)
      if (!project) throw new Error('Project not found.')
      return saveProject({
        ...project,
        pipeline: normalizePipelineState(payload.pipeline),
        updatedAt: Date.now()
      })
    }
  )

  ipcMain.handle(
    IPC.PROJECT_SYNC_PIPELINE_TIMELINE_AUDIO,
    async (
      _e,
      payload: {
        projectId: string
        videoEditor?: VideoEditorProject
        pipeline?: import('../../shared/segmentPipeline').SegmentPipelineState
      }
    ) => syncPipelineMasterAudioFromTimeline(payload.projectId, payload.videoEditor, payload.pipeline)
  )

  ipcMain.handle(
    IPC.PROJECT_MATCH_PIPELINE_SEGMENT_TIMINGS,
    async (
      _e,
      payload: {
        projectId: string
        pipeline?: import('../../shared/segmentPipeline').SegmentPipelineState
      }
    ) => {
      const loaded = await loadProject(payload.projectId)
      if (!loaded) throw new Error('Project not found.')
      const project = normalizeLoadedGenerationProject(loaded)
      const pipeline = normalizePipelineState(
        payload.pipeline ?? project.pipeline ?? createEmptyPipelineState()
      )
      if (!pipeline.masterAudioPath) {
        throw new Error('Sync timeline audio first, then get segment timings.')
      }
      if (pipeline.segments.length === 0) {
        throw new Error('Analyze script first to create segments.')
      }

      // Always recompute from a fresh transcript + sequential matcher (drop stale weighted matches).
      clearTranscriptCache()
      const cleared = {
        ...pipeline,
        segments: pipeline.segments.map((segment) => ({
          ...segment,
          scriptMatch: null
        }))
      }

      const result = await batchMatchScriptAudio({
        audioPath: cleared.masterAudioPath!,
        fullScript: cleared.fullScript,
        segments: cleared.segments.map((s) => ({
          id: s.id,
          scriptText: s.scriptText,
          index: s.index
        })),
        audioDurationMs: cleared.masterAudioDurationMs
      })
      if (result.matches.length === 0) {
        const reason = result.warnings[0] ?? 'Could not extract segment timings from audio.'
        throw new Error(reason)
      }

      const byId = new Map(result.matches.map((m) => [m.segmentId, m.match]))
      const sequentialCount = result.matches.filter(
        (m) => m.match.matchSource === 'sequential' || m.match.matchSource === 'word-aligned'
      ).length
      pipelineDebugLog(payload.projectId, 'step', 'audio', 'Segment timings recomputed', {
        matched: result.matches.length,
        sequential: sequentialCount,
        warnings: result.warnings
      })

      const next = {
        ...cleared,
        lastError: undefined,
        segments: cleared.segments.map((segment) => {
          const match = byId.get(segment.id)
          if (!match) return { ...segment, scriptMatch: null }
          return {
            ...segment,
            scriptMatch: match,
            status: segment.status === 'pending' ? 'audio_match_done' : segment.status
          }
        })
      }

      if (result.warnings.length > 0) {
        pipelineDebugLog(payload.projectId, 'warn', 'audio', 'Segment timing warnings', {
          warnings: result.warnings
        })
      }

      return saveProject({ ...project, pipeline: next, updatedAt: Date.now() })
    }
  )

  ipcMain.handle(IPC.SESSION_LOAD, async () => loadSession())

  ipcMain.handle(IPC.SESSION_SAVE, async (_e, session: AppSession) => {
    await saveSession(session)
    return true
  })

  ipcMain.handle(IPC.OPEN_VIDEO_FILE, async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win ?? undefined, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Video, Image & Audio',
          extensions: [
            'mp4',
            'webm',
            'mov',
            'mkv',
            'avi',
            'm4v',
            'png',
            'jpg',
            'jpeg',
            'webp',
            'gif',
            'wav',
            'mp3',
            'flac',
            'm4a',
            'ogg',
            'aac'
          ]
        }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(IPC.VIDEO_PROBE, async (_e, filePath: string) => probeMediaFile(filePath))

  ipcMain.handle(
    IPC.VIDEO_FILMSTRIP,
    async (
      _e,
      payload: { filePath: string; durationMs: number; type: MediaAsset['type'] }
    ): Promise<VideoFilmstrip> => {
      if (payload.type === 'image') {
        return filmstripForImage(payload.filePath, payload.durationMs)
      }
      return generateVideoFilmstrip(payload.filePath, payload.durationMs)
    }
  )

  ipcMain.handle(
    IPC.VIDEO_EXPORT,
    async (
      _e,
      payload: {
        mode?: 'sync-pipeline-timeline-audio' | 'timeline-audio'
        projectId?: string
        videoEditor?: VideoEditorProject
        pipeline?: import('../../shared/segmentPipeline').SegmentPipelineState
        assets: MediaAsset[]
        layers: TimelineLayer[]
        outputPath: string
        options?: VideoExportOptions
      }
    ) => {
      if (payload.mode === 'timeline-audio') {
        return exportTimelineAudioMix(payload.assets, payload.layers, payload.outputPath)
      }
      if (payload.mode === 'sync-pipeline-timeline-audio') {
        if (!payload.projectId) {
          throw new Error('Project id is required to sync timeline audio.')
        }
        const project = await syncPipelineMasterAudioFromTimeline(
          payload.projectId,
          payload.videoEditor ?? {
            id: payload.projectId,
            name: '',
            assets: payload.assets,
            layers: payload.layers
          },
          payload.pipeline
        )
        return { project }
      }
      return exportVideoSequence(payload.assets, payload.layers, payload.outputPath, payload.options)
    }
  )

  ipcMain.handle(
    IPC.CLIPBOARD_READ_IMAGE,
    async (): Promise<{ data: ArrayBuffer; fileName: string } | null> => {
      const image = clipboard.readImage()
      if (image.isEmpty()) return null
      const png = image.toPNG()
      const copy = new Uint8Array(png.byteLength)
      copy.set(png)
      return {
        data: copy.buffer,
        fileName: `pasted-image-${Date.now()}.png`
      }
    }
  )

  ipcMain.handle(
    IPC.MEDIA_SAVE_AS,
    async (
      _e,
      payload: { url?: string; localPath?: string; defaultName: string }
    ): Promise<string | null> => {
      const win = getWindow()
      const ext = payload.defaultName.includes('.') ? '' : '.mp4'
      const result = await dialog.showSaveDialog(win ?? undefined, {
        defaultPath: payload.defaultName + ext,
        filters: [
          { name: 'Media', extensions: ['mp4', 'webm', 'mov', 'png', 'jpg', 'jpeg', 'webp', 'gif'] }
        ]
      })
      if (result.canceled || !result.filePath) return null

      if (payload.localPath) {
        await fs.copyFile(payload.localPath, result.filePath)
        return result.filePath
      }
      if (payload.url) {
        const temp = await downloadMedia(payload.url)
        await fs.copyFile(temp, result.filePath)
        return result.filePath
      }
      return null
    }
  )

  ipcMain.handle(
    IPC.MEDIA_SAVE_MANY,
    async (
      _e,
      payload: {
        items: Array<{ url?: string; localPath?: string; defaultName: string }>
      }
    ): Promise<{ dir: string | null; saved: number; failed: string[] }> => {
      const win = getWindow()
      const parent = win && !win.isDestroyed() ? win : undefined
      const properties: Array<'openDirectory' | 'createDirectory' | 'promptToCreate'> = [
        'openDirectory'
      ]
      if (process.platform === 'darwin') properties.push('createDirectory')
      if (process.platform === 'win32') properties.push('promptToCreate')

      parent?.focus()
      const dialogOpts = {
        title: 'Choose folder for downloads',
        buttonLabel: 'Download here',
        properties
      }
      const pick = parent
        ? await dialog.showOpenDialog(parent, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts)
      if (pick.canceled || !pick.filePaths[0]) {
        return { dir: null, saved: 0, failed: [] }
      }

      const dir = pick.filePaths[0]
      const usedNames = new Set<string>()
      const failed: string[] = []
      let saved = 0

      const uniquePath = (defaultName: string): string => {
        const base = basename(defaultName) || 'generation.bin'
        const ext = extname(base)
        const stem = ext ? base.slice(0, -ext.length) : base
        let candidate = base
        let n = 1
        while (usedNames.has(candidate.toLowerCase()) || existsSync(join(dir, candidate))) {
          candidate = `${stem}-${n}${ext}`
          n += 1
        }
        usedNames.add(candidate.toLowerCase())
        return join(dir, candidate)
      }

      for (const item of payload.items) {
        const name = item.defaultName || 'generation.bin'
        try {
          const dest = uniquePath(name)
          if (item.localPath && existsSync(item.localPath)) {
            await fs.copyFile(item.localPath, dest)
            saved += 1
            continue
          }
          if (item.url) {
            const temp = await downloadMedia(item.url)
            await fs.copyFile(temp, dest)
            saved += 1
            continue
          }
          failed.push(name)
        } catch (err) {
          failed.push(name)
          logError(
            'media:save-many',
            err instanceof Error ? err.message : String(err),
            { name }
          )
        }
      }

      return { dir, saved, failed }
    }
  )

  ipcMain.handle(IPC.LOAD_AUDIO, async (_e, filePath: string): Promise<LoadedAudioProject> => {
    if (currentPcmPath) {
      await fs.unlink(currentPcmPath).catch(() => {})
    }

    const { metadata, peaks, pcmPath } = await decodeAudio(filePath)
    currentPcmPath = pcmPath
    currentMetadata = metadata

    return {
      metadata,
      peaks: serializePeaks(peaks)
    }
  })

  ipcMain.handle(
    IPC.AUDIO_PEAKS,
    async (_e, filePath: string): Promise<{ sampleRate: number; peaks: WaveformPeaks; durationMs: number }> =>
      generatePeaksFromAudioFile(filePath)
  )

  ipcMain.handle(
    IPC.DETECT_SILENCE,
    async (event, params: DetectionParams): Promise<DetectionResult> => {
      if (!currentPcmPath || !currentMetadata) {
        throw new Error('No audio loaded')
      }

      const win = BrowserWindow.fromWebContents(event.sender)
      const sendProgress = (value: number): void => {
        win?.webContents.send(IPC.DETECTION_PROGRESS, value)
      }

      sendProgress(0.1)

      let regions = detectTraditionalSilence(
        currentPcmPath,
        currentMetadata.sampleRate,
        currentMetadata.durationMs,
        params
      )

      sendProgress(0.4)

      if (params.mode === 'ai-vad' || params.mode === 'hybrid') {
        const vadRegions = await detectVadSilence(
          currentPcmPath,
          currentMetadata.sampleRate,
          currentMetadata.durationMs,
          params
        )

        sendProgress(0.7)

        if (params.mode === 'ai-vad') {
          regions = vadRegions
        } else {
          regions = mergeRegionsHybrid(regions, vadRegions, params.hybridMerge)
        }
      }

      regions = applyPaddingToRegions(
        regions,
        params.prePaddingMs,
        params.postPaddingMs,
        currentMetadata.durationMs
      )
      regions = mergeOverlappingRegions(regions)

      sendProgress(1)

      return { regions }
    }
  )

  ipcMain.handle(
    IPC.EXPORT_AUDIO,
    async (
      _e,
      operations: EditOperation[],
      options: ExportOptions,
      crossfadeMs: number
    ): Promise<ExportResult> => {
      if (!currentMetadata) throw new Error('No audio loaded')
      return exportAudio(
        currentMetadata.filePath,
        currentMetadata.durationMs,
        operations,
        options,
        crossfadeMs
      )
    }
  )

  ipcMain.handle(
    IPC.EXPORT_AUDIO_TEMP,
    async (_e, operations: EditOperation[], crossfadeMs: number): Promise<ExportResult> => {
      if (!currentMetadata) throw new Error('No audio loaded')
      const outputPath = join(tmpdir(), `ve-audio-${Date.now()}.wav`)
      return exportAudio(
        currentMetadata.filePath,
        currentMetadata.durationMs,
        operations,
        { outputPath, format: 'wav' },
        crossfadeMs
      )
    }
  )

  ipcMain.handle(IPC.GET_PRESETS, () => loadPresetsFile())

  ipcMain.handle(IPC.SAVE_PRESETS, async (_e, presets: Preset[]) => {
    await fs.writeFile(getPresetsPath(), JSON.stringify(presets, null, 2), 'utf-8')
    return true
  })

  ipcMain.handle(IPC.HIGGSFIELD_STATUS, async () => {
    try {
      return await getHiggsfieldStatus()
    } catch (err) {
      logError('ipc:higgsfield:status', err)
      throw err
    }
  })

  ipcMain.handle(IPC.HIGGSFIELD_LOGIN, async () => {
    loginHiggsfield()
    return true
  })

  ipcMain.handle(IPC.HIGGSFIELD_MODELS, async (_e, category: HiggsfieldModelCategory) => {
    try {
      return await listHiggsfieldModels(category)
    } catch (err) {
      logError('ipc:higgsfield:models', err, { category })
      throw err
    }
  })

  ipcMain.handle(IPC.HIGGSFIELD_MODEL, async (_e, modelId: string) => {
    try {
      return await getHiggsfieldModelSchema(modelId)
    } catch (err) {
      logError('ipc:higgsfield:model', err, { modelId })
      throw err
    }
  })

  ipcMain.handle(IPC.HIGGSFIELD_VOICES, async () => {
    try {
      return await listHiggsfieldVoices()
    } catch (err) {
      logError('ipc:higgsfield:voices', err)
      throw err
    }
  })

  ipcMain.handle(IPC.HIGGSFIELD_WORKSPACES, async () => {
    try {
      return await listHiggsfieldWorkspaces()
    } catch (err) {
      logError('ipc:higgsfield:workspaces', err)
      throw err
    }
  })

  ipcMain.handle(IPC.HIGGSFIELD_SET_WORKSPACE, async (_e, workspaceId: string) => {
    try {
      return await setHiggsfieldWorkspace(workspaceId)
    } catch (err) {
      logError('ipc:higgsfield:set-workspace', err, { workspaceId })
      throw err
    }
  })

  ipcMain.handle(
    IPC.HIGGSFIELD_GENERATE,
    async (event, request: HiggsfieldGenerateRequest) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      try {
        return await generateHiggsfieldContent(request, (message) => {
          win?.webContents.send(IPC.HIGGSFIELD_PROGRESS, message)
        })
      } catch (err) {
        logError('ipc:higgsfield:generate', err, {
          model: request.model,
          workspaceId: request.workspaceId
        })
        throw new Error(formatHiggsfieldError(err))
      }
    }
  )

  ipcMain.handle(IPC.HIGGSFIELD_ENQUEUE, async (_event, request: HiggsfieldEnqueueRequest) => {
    try {
      return await enqueueJob(request)
    } catch (err) {
      logError('ipc:higgsfield:enqueue', err, { model: request.model })
      throw new Error(formatHiggsfieldError(err))
    }
  })

  ipcMain.handle(IPC.HIGGSFIELD_CANCEL_JOB, (_event, jobId: string) => {
    return cancelJob(jobId)
  })

  ipcMain.handle(IPC.HIGGSFIELD_LIST_JOBS, () => listJobs())

  ipcMain.handle(IPC.HIGGSFIELD_RESOLVE_REFERENCE, async (_event, url: string) => {
    try {
      return await resolveReferenceUrl(url)
    } catch (err) {
      logError('ipc:higgsfield:resolve-reference', err, { url: url.slice(0, 80) })
      throw new Error(formatHiggsfieldError(err))
    }
  })

  ipcMain.handle(IPC.LOG_GET_PATH, () => getLogFilePath())

  ipcMain.handle(IPC.LOG_OPEN, async () => {
    const logPath = getLogFilePath()
    shell.showItemInFolder(logPath)
    return logPath
  })

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_e, url: string) => {
    await shell.openExternal(url)
    return true
  })
}

export function registerMenuIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.on(IPC.MENU_OPEN, () => {
    getWindow()?.webContents.send(IPC.MENU_OPEN)
  })
  ipcMain.on(IPC.MENU_EXPORT, () => {
    getWindow()?.webContents.send(IPC.MENU_EXPORT)
  })
  ipcMain.on(IPC.MENU_UNDO, () => {
    getWindow()?.webContents.send(IPC.MENU_UNDO)
  })
  ipcMain.on(IPC.MENU_REDO, () => {
    getWindow()?.webContents.send(IPC.MENU_REDO)
  })
}
