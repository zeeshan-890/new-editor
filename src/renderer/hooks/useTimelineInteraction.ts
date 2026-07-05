import { useCallback, useRef } from 'react'
import { usePlaybackStore } from '../stores/playbackStore'
import { useEditorStore } from '../stores/editorStore'
import { clamp } from '../lib/utils'

export function useTimelineInteraction(containerWidth: number): {
  msToX: (ms: number) => number
  xToMs: (x: number) => number
  visibleDurationMs: number
  onWheel: (e: React.WheelEvent) => void
  onMouseDown: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
  onMouseUp: () => void
  isDragging: boolean
  isSelecting: boolean
} {
  const metadata = useEditorStore((s) => s.metadata)
  const setSelection = useEditorStore((s) => s.setSelection)
  const zoom = usePlaybackStore((s) => s.zoom)
  const scrollMs = usePlaybackStore((s) => s.scrollMs)
  const setScrollMs = usePlaybackStore((s) => s.setScrollMs)
  const setZoom = usePlaybackStore((s) => s.setZoom)
  const setPlayheadMs = usePlaybackStore((s) => s.setPlayheadMs)

  const dragRef = useRef<{ startX: number; startScroll: number } | null>(null)
  const selectRef = useRef<{ startMs: number } | null>(null)
  const isDragging = useRef(false)
  const isSelecting = useRef(false)

  const durationMs = metadata?.durationMs ?? 1
  const visibleDurationMs = durationMs / zoom

  const msToX = useCallback(
    (ms: number) => {
      if (containerWidth <= 0) return 0
      return ((ms - scrollMs) / visibleDurationMs) * containerWidth
    },
    [containerWidth, scrollMs, visibleDurationMs]
  )

  const xToMs = useCallback(
    (x: number) => {
      if (containerWidth <= 0) return 0
      return scrollMs + (x / containerWidth) * visibleDurationMs
    },
    [containerWidth, scrollMs, visibleDurationMs]
  )

  const onWheel = (e: React.WheelEvent): void => {
    e.preventDefault()
    if (e.ctrlKey) {
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      setZoom(clamp(zoom * factor, 0.1, 100))
    } else if (e.shiftKey) {
      const deltaMs = (e.deltaY / containerWidth) * visibleDurationMs
      setScrollMs(clamp(scrollMs + deltaMs, 0, Math.max(0, durationMs - visibleDurationMs)))
    } else {
      const deltaMs = (e.deltaY / containerWidth) * visibleDurationMs
      setScrollMs(clamp(scrollMs + deltaMs, 0, Math.max(0, durationMs - visibleDurationMs)))
    }
  }

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      isDragging.current = true
      dragRef.current = { startX: e.clientX, startScroll: scrollMs }
      return
    }

    if (e.button === 0) {
      const ms = clamp(xToMs(e.nativeEvent.offsetX), 0, durationMs)
      if (e.altKey) {
        isSelecting.current = true
        selectRef.current = { startMs: ms }
        setSelection({ startMs: ms, endMs: ms })
      } else {
        setPlayheadMs(ms)
      }
    }
  }

  const onMouseMove = (e: React.MouseEvent): void => {
    if (isDragging.current && dragRef.current) {
      const dx = e.clientX - dragRef.current.startX
      const deltaMs = -(dx / containerWidth) * visibleDurationMs
      setScrollMs(
        clamp(
          dragRef.current.startScroll + deltaMs,
          0,
          Math.max(0, durationMs - visibleDurationMs)
        )
      )
    }

    if (isSelecting.current && selectRef.current) {
      const ms = clamp(xToMs(e.nativeEvent.offsetX), 0, durationMs)
      const start = Math.min(selectRef.current.startMs, ms)
      const end = Math.max(selectRef.current.startMs, ms)
      setSelection({ startMs: start, endMs: end })
    }
  }

  const onMouseUp = (): void => {
    isDragging.current = false
    isSelecting.current = false
    dragRef.current = null
    selectRef.current = null
  }

  return {
    msToX,
    xToMs,
    visibleDurationMs,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    isDragging: isDragging.current,
    isSelecting: isSelecting.current
  }
}
