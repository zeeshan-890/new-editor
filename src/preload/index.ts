import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  DetectionParams,
  DetectionResult,
  EditOperation,
  ExportOptions,
  ExportResult,
  LoadedAudioProject,
  Preset
} from '../shared/types'

export interface ElectronAPI {
  openFile: () => Promise<string | null>
  saveFile: (defaultName: string) => Promise<string | null>
  loadAudio: (filePath: string) => Promise<LoadedAudioProject>
  detectSilence: (params: DetectionParams) => Promise<DetectionResult>
  exportAudio: (
    operations: EditOperation[],
    options: ExportOptions,
    crossfadeMs: number
  ) => Promise<ExportResult>
  getPresets: () => Promise<Preset[]>
  savePresets: (presets: Preset[]) => Promise<boolean>
  onDetectionProgress: (callback: (value: number) => void) => () => void
  onMenuOpen: (callback: () => void) => () => void
  onMenuExport: (callback: () => void) => () => void
  onMenuUndo: (callback: () => void) => () => void
  onMenuRedo: (callback: () => void) => () => void
  onShowShortcuts: (callback: () => void) => () => void
  getPathForFile: (file: File) => string
}

function subscribe(channel: string, callback: () => void): () => void {
  const handler = (): void => callback()
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: ElectronAPI = {
  openFile: () => ipcRenderer.invoke(IPC.OPEN_FILE),
  saveFile: (defaultName) => ipcRenderer.invoke(IPC.SAVE_FILE, defaultName),
  loadAudio: (filePath) => ipcRenderer.invoke(IPC.LOAD_AUDIO, filePath),
  detectSilence: (params) => ipcRenderer.invoke(IPC.DETECT_SILENCE, params),
  exportAudio: (operations, options, crossfadeMs) =>
    ipcRenderer.invoke(IPC.EXPORT_AUDIO, operations, options, crossfadeMs),
  getPresets: () => ipcRenderer.invoke(IPC.GET_PRESETS),
  savePresets: (presets) => ipcRenderer.invoke(IPC.SAVE_PRESETS, presets),
  onDetectionProgress: (callback) => {
    const handler = (_: unknown, value: number): void => callback(value)
    ipcRenderer.on(IPC.DETECTION_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC.DETECTION_PROGRESS, handler)
  },
  onMenuOpen: (callback) => subscribe(IPC.MENU_OPEN, callback),
  onMenuExport: (callback) => subscribe(IPC.MENU_EXPORT, callback),
  onMenuUndo: (callback) => subscribe(IPC.MENU_UNDO, callback),
  onMenuRedo: (callback) => subscribe(IPC.MENU_REDO, callback),
  onShowShortcuts: (callback) => subscribe(IPC.SHOW_SHORTCUTS, callback),
  getPathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('electronAPI', api)

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
