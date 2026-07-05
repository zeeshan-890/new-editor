import { useHotkeys } from 'react-hotkeys-hook'
import { useVideoEditorStore } from '@renderer/stores/videoEditorStore'
import { usePlaybackStore } from '@renderer/stores/playbackStore'

export function useVideoEditorHotkeys(): void {
  const splitClipAtPlayhead = useVideoEditorStore((s) => s.splitClipAtPlayhead)
  const deleteSelectedClip = useVideoEditorStore((s) => s.deleteSelectedClip)
  const undo = useVideoEditorStore((s) => s.undo)
  const redo = useVideoEditorStore((s) => s.redo)

  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying)
  const setPlayheadMs = usePlaybackStore((s) => s.setPlayheadMs)
  const zoomIn = usePlaybackStore((s) => s.zoomIn)
  const zoomOut = usePlaybackStore((s) => s.zoomOut)

  useHotkeys(
    's,b',
    (e) => {
      e.preventDefault()
      splitClipAtPlayhead()
    },
    [splitClipAtPlayhead]
  )

  useHotkeys(
    'ctrl+b',
    (e) => {
      e.preventDefault()
      splitClipAtPlayhead()
    },
    [splitClipAtPlayhead]
  )

  useHotkeys(
    'delete,backspace,del',
    (e) => {
      e.preventDefault()
      deleteSelectedClip()
    },
    [deleteSelectedClip]
  )

  useHotkeys(
    'ctrl+z',
    (e) => {
      e.preventDefault()
      undo()
    },
    [undo]
  )

  useHotkeys(
    'ctrl+shift+z',
    (e) => {
      e.preventDefault()
      redo()
    },
    [redo]
  )

  useHotkeys(
    'space',
    (e) => {
      e.preventDefault()
      setIsPlaying(!isPlaying)
    },
    [isPlaying, setIsPlaying]
  )

  useHotkeys(
    'home',
    () => {
      setPlayheadMs(0)
    },
    [setPlayheadMs]
  )

  useHotkeys(
    'equal,plus',
    (e) => {
      if (e.ctrlKey) {
        e.preventDefault()
        zoomIn()
      }
    },
    [zoomIn]
  )

  useHotkeys(
    'minus',
    (e) => {
      if (e.ctrlKey) {
        e.preventDefault()
        zoomOut()
      }
    },
    [zoomOut]
  )
}
