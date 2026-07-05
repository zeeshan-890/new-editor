import { useEffect, useRef, useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useEditorStore } from '../stores/editorStore'
import { usePlaybackStore } from '../stores/playbackStore'
import { AudioPlayer } from '../lib/audio/player'

export function useKeyboardShortcuts(
  playerRef: React.RefObject<AudioPlayer | null>,
  onOpen: () => void,
  onExport: () => void
): void {
  const metadata = useEditorStore((s) => s.metadata)
  const regions = useEditorStore((s) => s.regions)
  const selection = useEditorStore((s) => s.selection)
  const splitAt = useEditorStore((s) => s.splitAt)
  const deleteSelection = useEditorStore((s) => s.deleteSelection)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)

  const playheadMs = usePlaybackStore((s) => s.playheadMs)
  const setPlayheadMs = usePlaybackStore((s) => s.setPlayheadMs)
  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying)
  const loopSelection = usePlaybackStore((s) => s.loopSelection)
  const setLoopSelection = usePlaybackStore((s) => s.setLoopSelection)
  const zoomIn = usePlaybackStore((s) => s.zoomIn)
  const zoomOut = usePlaybackStore((s) => s.zoomOut)

  const togglePlay = useCallback(() => {
    const player = playerRef.current
    if (!player || !metadata) return
    if (player.isPlaying()) {
      player.pause()
      setIsPlaying(false)
    } else {
      const from = loopSelection && selection ? selection.startMs : playheadMs
      player.play(from)
      setIsPlaying(true)
    }
  }, [playerRef, metadata, playheadMs, loopSelection, selection, setIsPlaying])

  useHotkeys('space', (e) => {
    e.preventDefault()
    togglePlay()
  }, [togglePlay])

  useHotkeys('escape', () => {
    playerRef.current?.stop()
    setIsPlaying(false)
    setPlayheadMs(0)
  })

  useHotkeys('s,b', (e) => {
    e.preventDefault()
    splitAt(playheadMs)
  }, [playheadMs, splitAt])

  useHotkeys('ctrl+b', (e) => {
    e.preventDefault()
    splitAt(playheadMs)
  }, [playheadMs, splitAt])

  useHotkeys('delete,backspace', (e) => {
    e.preventDefault()
    deleteSelection()
  }, [deleteSelection])

  useHotkeys('ctrl+z', (e) => {
    e.preventDefault()
    undo()
  }, [undo])

  useHotkeys('ctrl+shift+z', (e) => {
    e.preventDefault()
    redo()
  }, [redo])

  useHotkeys('ctrl+o', (e) => {
    e.preventDefault()
    onOpen()
  }, [onOpen])

  useHotkeys('ctrl+e', (e) => {
    e.preventDefault()
    onExport()
  }, [onExport])

  useHotkeys('l', () => setLoopSelection(!loopSelection), [loopSelection, setLoopSelection])

  useHotkeys('home', () => {
    playerRef.current?.seek(0)
    setPlayheadMs(0)
  })

  useHotkeys('end', () => {
    if (metadata) {
      playerRef.current?.seek(metadata.durationMs)
      setPlayheadMs(metadata.durationMs)
    }
  })

  useHotkeys('equal,plus', (e) => {
    if (e.ctrlKey) {
      e.preventDefault()
      zoomIn()
    }
  }, [zoomIn])

  useHotkeys('minus', (e) => {
    if (e.ctrlKey) {
      e.preventDefault()
      zoomOut()
    }
  }, [zoomOut])

  useHotkeys('[', () => {
    const active = regions.filter((r) => !r.removed)
    const prev = [...active].reverse().find((r) => r.endMs < playheadMs)
    if (prev) {
      setPlayheadMs(prev.startMs)
      playerRef.current?.seek(prev.startMs)
    }
  }, [regions, playheadMs, setPlayheadMs, playerRef])

  useHotkeys(']', () => {
    const active = regions.filter((r) => !r.removed)
    const next = active.find((r) => r.startMs > playheadMs)
    if (next) {
      setPlayheadMs(next.startMs)
      playerRef.current?.seek(next.startMs)
    }
  }, [regions, playheadMs, setPlayheadMs, playerRef])
}

export function useAudioPlayer(): React.RefObject<AudioPlayer | null> {
  const playerRef = useRef<AudioPlayer | null>(null)
  const setPlayheadMs = usePlaybackStore((s) => s.setPlayheadMs)
  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying)

  useEffect(() => {
    const player = new AudioPlayer()
    player.setOnTimeUpdate((time) => {
      setPlayheadMs(time)
      if (!player.isPlaying()) setIsPlaying(false)
    })
    playerRef.current = player
    return () => player.destroy()
  }, [setPlayheadMs, setIsPlaying])

  return playerRef
}
