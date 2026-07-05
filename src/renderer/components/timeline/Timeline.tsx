import { useEffect, useRef, useState } from 'react'
import { TimeRuler } from './TimeRuler'
import { WaveformCanvas } from './WaveformCanvas'
import { useTimelineInteraction } from '@renderer/hooks/useTimelineInteraction'
import { useEditorStore } from '@renderer/stores/editorStore'
import { usePlaybackStore } from '@renderer/stores/playbackStore'

interface TimelineProps {
  onSeek: (ms: number) => void
}

export function Timeline({ onSeek }: TimelineProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const metadata = useEditorStore((s) => s.metadata)
  const playheadMs = usePlaybackStore((s) => s.playheadMs)

  const {
    msToX,
    xToMs,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp
  } = useTimelineInteraction(width)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width)
    })
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    onSeek(playheadMs)
  }, [playheadMs, onSeek])

  if (!metadata) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-sm border border-dashed border-border rounded-lg m-4">
        Open an audio file or drag and drop to begin
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col min-h-0 select-none"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <TimeRuler width={width} />
      <div className="flex-1 min-h-[200px] bg-background/50">
        <WaveformCanvas width={width} height={280} msToX={msToX} />
      </div>
      <div className="text-[10px] text-muted px-2 py-1 border-t border-border">
        Alt+drag to select · Shift+drag or middle-click to pan · Scroll to zoom (Ctrl+scroll)
      </div>
    </div>
  )
}
