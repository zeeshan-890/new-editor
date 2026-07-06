import { useHotkeys } from 'react-hotkeys-hook'
import { useVideoEditorStore } from '@renderer/stores/videoEditorStore'
import { usePlaybackStore } from '@renderer/stores/playbackStore'
import {
  VIDEO_EDITOR_FRAME_MS,
  VIDEO_EDITOR_MULTI_FRAME_STEP
} from '@shared/types'

const HOTKEY_OPTS = { enableOnFormTags: false, preventDefault: true } as const

export function useVideoEditorHotkeys(options?: { onExport?: () => void }): void {
  const splitClipAtPlayhead = useVideoEditorStore((s) => s.splitClipAtPlayhead)
  const deleteSelectedClip = useVideoEditorStore((s) => s.deleteSelectedClip)
  const undo = useVideoEditorStore((s) => s.undo)
  const redo = useVideoEditorStore((s) => s.redo)
  const copySelectedClip = useVideoEditorStore((s) => s.copySelectedClip)
  const pasteClipAtPlayhead = useVideoEditorStore((s) => s.pasteClipAtPlayhead)
  const duplicateSelectedClip = useVideoEditorStore((s) => s.duplicateSelectedClip)
  const selectAdjacentLayer = useVideoEditorStore((s) => s.selectAdjacentLayer)
  const addMarkerAtPlayhead = useVideoEditorStore((s) => s.addMarkerAtPlayhead)
  const saveProjectToFile = useVideoEditorStore((s) => s.saveProjectToFile)

  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying)
  const playheadMs = usePlaybackStore((s) => s.playheadMs)
  const setPlayheadMs = usePlaybackStore((s) => s.setPlayheadMs)
  const durationMs = useVideoEditorStore((s) => s.durationMs)
  const zoomIn = usePlaybackStore((s) => s.zoomIn)
  const zoomOut = usePlaybackStore((s) => s.zoomOut)

  const nudgePlayhead = (deltaMs: number): void => {
    setPlayheadMs(Math.max(0, Math.min(durationMs, playheadMs + deltaMs)))
  }

  useHotkeys('mod+b', () => splitClipAtPlayhead(), { ...HOTKEY_OPTS }, [splitClipAtPlayhead])

  useHotkeys('delete,backspace', () => deleteSelectedClip(), { ...HOTKEY_OPTS }, [deleteSelectedClip])

  useHotkeys('mod+z', () => undo(), { ...HOTKEY_OPTS }, [undo])

  useHotkeys('mod+shift+z', () => redo(), { ...HOTKEY_OPTS }, [redo])

  useHotkeys('mod+c', () => copySelectedClip(), { ...HOTKEY_OPTS }, [copySelectedClip])

  useHotkeys('mod+v', () => pasteClipAtPlayhead(), { ...HOTKEY_OPTS }, [pasteClipAtPlayhead])

  useHotkeys('mod+d', () => duplicateSelectedClip(), { ...HOTKEY_OPTS }, [duplicateSelectedClip])

  useHotkeys(
    'space',
    () => setIsPlaying(!isPlaying),
    { ...HOTKEY_OPTS },
    [isPlaying, setIsPlaying]
  )

  useHotkeys(
    'left',
    () => nudgePlayhead(-VIDEO_EDITOR_FRAME_MS),
    { enableOnFormTags: false, preventDefault: true },
    [playheadMs, durationMs, setPlayheadMs]
  )

  useHotkeys(
    'right',
    () => nudgePlayhead(VIDEO_EDITOR_FRAME_MS),
    { enableOnFormTags: false, preventDefault: true },
    [playheadMs, durationMs, setPlayheadMs]
  )

  useHotkeys(
    'shift+left',
    () => nudgePlayhead(-VIDEO_EDITOR_FRAME_MS * VIDEO_EDITOR_MULTI_FRAME_STEP),
    { ...HOTKEY_OPTS },
    [playheadMs, durationMs, setPlayheadMs]
  )

  useHotkeys(
    'shift+right',
    () => nudgePlayhead(VIDEO_EDITOR_FRAME_MS * VIDEO_EDITOR_MULTI_FRAME_STEP),
    { ...HOTKEY_OPTS },
    [playheadMs, durationMs, setPlayheadMs]
  )

  useHotkeys('home', () => setPlayheadMs(0), { enableOnFormTags: false }, [setPlayheadMs])

  useHotkeys(
    'end',
    () => setPlayheadMs(durationMs),
    { enableOnFormTags: false },
    [durationMs, setPlayheadMs]
  )

  useHotkeys('up', () => selectAdjacentLayer(-1), { ...HOTKEY_OPTS }, [selectAdjacentLayer])

  useHotkeys('down', () => selectAdjacentLayer(1), { ...HOTKEY_OPTS }, [selectAdjacentLayer])

  useHotkeys('m', () => addMarkerAtPlayhead(), { ...HOTKEY_OPTS }, [addMarkerAtPlayhead])

  useHotkeys(
    'mod+s',
    () => {
      void saveProjectToFile()
    },
    { ...HOTKEY_OPTS },
    [saveProjectToFile]
  )

  useHotkeys(
    'mod+e',
    () => options?.onExport?.(),
    { ...HOTKEY_OPTS },
    [options?.onExport]
  )

  useHotkeys(
    'equal,plus',
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomIn(durationMs)
      }
    },
    { enableOnFormTags: false },
    [zoomIn, durationMs]
  )

  useHotkeys(
    'minus',
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomOut(durationMs)
      }
    },
    { enableOnFormTags: false },
    [zoomOut, durationMs]
  )
}
