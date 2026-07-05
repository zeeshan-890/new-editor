export const IPC = {
  OPEN_FILE: 'dialog:open-file',
  SAVE_FILE: 'dialog:save-file',
  LOAD_AUDIO: 'audio:load',
  DETECT_SILENCE: 'detection:run',
  EXPORT_AUDIO: 'audio:export',
  GET_PRESETS: 'presets:get',
  SAVE_PRESETS: 'presets:save',
  SHOW_SHORTCUTS: 'help:shortcuts',
  MENU_OPEN: 'menu:open',
  MENU_EXPORT: 'menu:export',
  MENU_UNDO: 'menu:undo',
  MENU_REDO: 'menu:redo',
  DETECTION_PROGRESS: 'detection:progress'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
