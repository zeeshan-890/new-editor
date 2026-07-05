import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
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
import { exportVideoSequence } from '../video/export'
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
        { name: 'FLAC', extensions: ['flac'] },
        { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'WebM Video', extensions: ['webm'] }
      ]
    })
    return result.canceled ? null : result.filePath
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

  ipcMain.handle(IPC.PROJECT_LOAD, async (_e, projectId: string) => loadProject(projectId))

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
      payload: { assets: MediaAsset[]; layers: TimelineLayer[]; outputPath: string }
    ) => exportVideoSequence(payload.assets, payload.layers, payload.outputPath)
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
