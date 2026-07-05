import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock, LockOpen, Volume2, VolumeX } from 'lucide-react'
import { useVideoEditorStore } from '@renderer/stores/videoEditorStore'
import { usePlaybackStore } from '@renderer/stores/playbackStore'
import { clipDurationMs } from '@shared/types'
import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'
import { clamp, cn, formatTime } from '@renderer/lib/utils'
import { TimelineClipBlock } from './TimelineClipBlock'

const LAYER_HEIGHT = 56
const TRACK_HEADER_W = 140

const LAYER_STYLE: Record<string, { bar: string; clip: string; label: string }> = {
  video: {
    bar: 'bg-sky-500/10',
    clip: 'border-sky-500/40 bg-sky-500/15 hover:bg-sky-500/20',
    label: 'text-sky-300'
  },
  audio: {
    bar: 'bg-emerald-500/10',
    clip: 'border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/20',
    label: 'text-emerald-300'
  },
  overlay: {
    bar: 'bg-violet-500/10',
    clip: 'border-violet-500/40 bg-violet-500/15 hover:bg-violet-500/20',
    label: 'text-violet-300'
  }
}

export function VideoTimeline(): React.JSX.Element {
  const layers = useVideoEditorStore((s) => s.project.layers)
  const selectedLayerId = useVideoEditorStore((s) => s.project.selectedLayerId)
  const assets = useVideoEditorStore((s) => s.project.assets)
  const selectedClipId = useVideoEditorStore((s) => s.project.selectedClipId)
  const durationMs = useVideoEditorStore((s) => s.durationMs)
  const selectClip = useVideoEditorStore((s) => s.selectClip)
  const selectLayer = useVideoEditorStore((s) => s.selectLayer)
  const toggleLayerMute = useVideoEditorStore((s) => s.toggleLayerMute)
  const toggleLayerLock = useVideoEditorStore((s) => s.toggleLayerLock)
  const moveSelectedClip = useVideoEditorStore((s) => s.moveSelectedClip)
  const trimSelectedClip = useVideoEditorStore((s) => s.trimSelectedClip)
  const pushHistory = useVideoEditorStore((s) => s.pushHistory)

  const zoom = usePlaybackStore((s) => s.zoom)
  const scrollMs = usePlaybackStore((s) => s.scrollMs)
  const playheadMs = usePlaybackStore((s) => s.playheadMs)
  const setPlayheadMs = usePlaybackStore((s) => s.setPlayheadMs)
  const setScrollMs = usePlaybackStore((s) => s.setScrollMs)
  const setZoom = usePlaybackStore((s) => s.setZoom)

  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const dragRef = useRef<{ clipId: string; startX: number; startMs: number } | null>(null)
  const trimRef = useRef<{ edge: 'in' | 'out'; startX: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - TRACK_HEADER_W))
    ro.observe(el)
    setWidth(el.clientWidth - TRACK_HEADER_W)
    return () => ro.disconnect()
  }, [])

  const visibleDurationMs = durationMs / zoom
  const msToX = useCallback(
    (ms: number) => ((ms - scrollMs) / visibleDurationMs) * width,
    [scrollMs, visibleDurationMs, width]
  )
  const xToMs = useCallback(
    (x: number) => scrollMs + (x / width) * visibleDurationMs,
    [scrollMs, visibleDurationMs, width]
  )

  const onWheel = (e: React.WheelEvent): void => {
    e.preventDefault()
    if (e.ctrlKey) {
      setZoom(clamp(zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.05, 50))
    } else {
      const deltaMs = (e.deltaY / width) * visibleDurationMs
      setScrollMs(clamp(scrollMs + deltaMs, 0, Math.max(0, durationMs - visibleDurationMs)))
    }
  }

  return (
    <div ref={containerRef} className="relative flex flex-col min-h-0 border-t border-border bg-card/30">
      <div className="flex shrink-0 border-b border-border">
        <div style={{ width: TRACK_HEADER_W }} className="shrink-0" />
        <div className="flex-1 min-w-0 h-6 relative text-[10px] text-muted" onWheel={onWheel}>
          {Array.from({ length: 12 }).map((_, i) => {
            const ms = scrollMs + (i / 12) * visibleDurationMs
            return (
              <span
                key={i}
                className="absolute top-1 -translate-x-1/2 tabular-nums"
                style={{ left: `${(i / 12) * 100}%` }}
              >
                {formatTime(ms, false)}
              </span>
            )
          })}
        </div>
      </div>

      <div className="relative flex-1 overflow-y-auto min-h-0" onWheel={onWheel}>
        {layers.map((layer) => {
          const style = LAYER_STYLE[layer.type]
          const isSelectedLayer = layer.id === selectedLayerId
          return (
          <div key={layer.id} className="flex border-b border-border/60" style={{ height: LAYER_HEIGHT }}>
            <div
              className={cn(
                'shrink-0 px-1.5 flex flex-col justify-center gap-0.5 border-r border-border',
                style.bar,
                isSelectedLayer && 'ring-1 ring-inset ring-primary/50'
              )}
              style={{ width: TRACK_HEADER_W }}
            >
              <button
                type="button"
                className={cn('text-left text-[10px] font-medium truncate w-full', style.label)}
                onClick={() => selectLayer(layer.id)}
              >
                {layer.name}
              </button>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  className="p-0.5 rounded hover:bg-white/10 text-muted"
                  title={layer.muted ? 'Unmute layer' : 'Mute layer'}
                  onClick={() => toggleLayerMute(layer.id)}
                >
                  {layer.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                </button>
                <button
                  type="button"
                  className="p-0.5 rounded hover:bg-white/10 text-muted"
                  title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                  onClick={() => toggleLayerLock(layer.id)}
                >
                  {layer.locked ? <Lock size={11} /> : <LockOpen size={11} />}
                </button>
                <span className="text-[9px] text-muted ml-auto capitalize">{layer.type}</span>
              </div>
            </div>
            <div
              className={cn('relative flex-1 min-w-0', style.bar)}
              onMouseDown={(e) => {
                if (e.target !== e.currentTarget) return
                selectLayer(layer.id)
                selectClip(null)
                setPlayheadMs(clamp(xToMs(e.nativeEvent.offsetX), 0, durationMs))
              }}
            >
              {layer.clips.map((clip) => {
                const asset = assets.find((a) => a.id === clip.assetId)
                if (!asset) return null
                const left = msToX(clip.timelineStartMs)
                const w = Math.max(24, msToX(clip.timelineStartMs + clipDurationMs(clip)) - left)
                const selected = clip.id === selectedClipId
                return (
                  <TimelineClipBlock
                    key={clip.id}
                    clip={clip}
                    asset={asset}
                    layer={layer}
                    left={left}
                    width={w}
                    selected={selected}
                    style={style}
                    onMouseDown={(e) => {
                      if (layer.locked) return
                      e.stopPropagation()
                      selectClip(clip.id)
                      selectLayer(layer.id)
                      pushHistory()
                      dragRef.current = {
                        clipId: clip.id,
                        startX: e.clientX,
                        startMs: clip.timelineStartMs
                      }
                    }}
                    onTrimIn={(e) => {
                      e.stopPropagation()
                      pushHistory()
                      trimRef.current = { edge: 'in', startX: e.clientX }
                    }}
                    onTrimOut={(e) => {
                      e.stopPropagation()
                      pushHistory()
                      trimRef.current = { edge: 'out', startX: e.clientX }
                    }}
                  />
                )
              })}
            </div>
          </div>
        )})}
      </div>

      <div
        className="pointer-events-none absolute z-20 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]"
        style={{
          left: TRACK_HEADER_W + msToX(playheadMs),
          top: 24,
          bottom: 0
        }}
      />

      <GlobalDragHandler
        dragRef={dragRef}
        trimRef={trimRef}
        xToMs={xToMs}
        msToX={msToX}
        moveSelectedClip={moveSelectedClip}
        trimSelectedClip={trimSelectedClip}
        width={width}
        visibleDurationMs={visibleDurationMs}
      />
    </div>
  )
}

function GlobalDragHandler({
  dragRef,
  trimRef,
  xToMs,
  moveSelectedClip,
  trimSelectedClip,
  width,
  visibleDurationMs
}: {
  dragRef: React.MutableRefObject<{ clipId: string; startX: number; startMs: number } | null>
  trimRef: React.MutableRefObject<{ edge: 'in' | 'out'; startX: number } | null>
  xToMs: (x: number) => number
  msToX: (ms: number) => number
  moveSelectedClip: (ms: number) => void
  trimSelectedClip: (edge: 'in' | 'out', deltaMs: number) => void
  width: number
  visibleDurationMs: number
}): null {
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (dragRef.current) {
        const deltaPx = e.clientX - dragRef.current.startX
        const deltaMs = (deltaPx / width) * visibleDurationMs
        moveSelectedClip(Math.max(0, dragRef.current.startMs + deltaMs))
      }
      if (trimRef.current) {
        const deltaPx = e.clientX - trimRef.current.startX
        const deltaMs = (deltaPx / width) * visibleDurationMs
        trimSelectedClip(trimRef.current.edge, deltaMs)
        trimRef.current.startX = e.clientX
      }
    }
    const onUp = (): void => {
      dragRef.current = null
      trimRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragRef, trimRef, moveSelectedClip, trimSelectedClip, width, visibleDurationMs, xToMs])

  return null
}

export function localMediaUrl(path: string, _type?: string): string {
  return localMediaPathUrl(path)
}
