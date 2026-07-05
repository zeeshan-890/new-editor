import { ipcMain, dialog, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type {
  DetectionParams,
  DetectionResult,
  ExportOptions,
  ExportResult,
  LoadedAudioProject,
  Preset,
  EditOperation
} from '../../shared/types'
import { decodeAudio, serializePeaks } from '../audio/decode'
import { exportAudio } from '../audio/export'
import { applyPaddingToRegions, mergeOverlappingRegions } from '../audio/apply-silence'
import { detectTraditionalSilence } from '../detection/traditional'
import { detectVadSilence } from '../detection/silero-vad'
import { mergeRegionsHybrid } from '../detection/merge-regions'

let currentPcmPath: string | null = null
let currentMetadata: LoadedAudioProject['metadata'] | null = null

const PRESETS_PATH = join(app.getPath('userData'), 'presets.json')

async function loadPresetsFile(): Promise<Preset[]> {
  try {
    const raw = await fs.readFile(PRESETS_PATH, 'utf-8')
    return JSON.parse(raw) as Preset[]
  } catch {
    return []
  }
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
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

  ipcMain.handle(IPC.GET_PRESETS, () => loadPresetsFile())

  ipcMain.handle(IPC.SAVE_PRESETS, async (_e, presets: Preset[]) => {
    await fs.writeFile(PRESETS_PATH, JSON.stringify(presets, null, 2), 'utf-8')
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
