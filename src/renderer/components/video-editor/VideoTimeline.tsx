import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock, LockOpen, Volume2, VolumeX } from 'lucide-react'
import { useVideoEditorStore } from '@renderer/stores/videoEditorStore'
import { usePlaybackStore } from '@renderer/stores/playbackStore'
import { clipDurationMs } from '@shared/types'
import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'
import { clamp, cn } from '@renderer/lib/utils'
import { TimelineClipBlock } from './TimelineClipBlock'
import { VideoTimeRuler } from './VideoTimeRuler'

const LAYER_HEIGHT = 56
const TRACK_HEADER_W = 140
const RULER_HEIGHT = 24

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
  const moveSelectedClipToPosition = useVideoEditorStore((s) => s.moveSelectedClipToPosition)
  const trimSelectedClip = useVideoEditorStore((s) => s.trimSelectedClip)
  const pushHistory = useVideoEditorStore((s) => s.pushHistory)

  const zoom = usePlaybackStore((s) => s.zoom)
  const scrollMs = usePlaybackStore((s) => s.scrollMs)
  const playheadMs = usePlaybackStore((s) => s.playheadMs)
  const setPlayheadMs = usePlaybackStore((s) => s.setPlayheadMs)
  const setScrollMs = usePlaybackStore((s) => s.setScrollMs)
  const setZoom = usePlaybackStore((s) => s.setZoom)

  const containerRef = useRef<HTMLDivElement>(null)
  const tracksScrollRef = useRef<HTMLDivElement>(null)
  const timelineContentRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [hoverLayerIndex, setHoverLayerIndex] = useState<number | null>(null)
  const dragRef = useRef<{ clipId: string; startX: number; startY: number; startMs: number } | null>(
    null
  )
  const trimRef = useRef<{ edge: 'in' | 'out'; startX: number } | null>(null)

  const layerIndexFromClientY = useCallback(
    (clientY: number): number => {
      const container = tracksScrollRef.current
      if (!container) return 0
      const rect = container.getBoundingClientRect()
      const contentY = clientY - rect.top + container.scrollTop - RULER_HEIGHT
      if (contentY < 0) return -1
      return clamp(Math.floor(contentY / LAYER_HEIGHT), 0, layers.length)
    },
    [layers.length]
  )

  useEffect(() => {
    const el = timelineContentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const visibleDurationMs = durationMs / zoom
  const maxScrollMs = Math.max(0, durationMs - visibleDurationMs)
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
      const rect = timelineContentRef.current?.getBoundingClientRect()
      const cursorX = rect && width > 0 ? clamp(e.clientX - rect.left, 0, width) : width / 2
      const cursorMs = scrollMs + (cursorX / width) * visibleDurationMs
      const nextZoom = clamp(zoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.05, 50)
      const nextVisible = durationMs / nextZoom
      const nextMaxScroll = Math.max(0, durationMs - nextVisible)
      const nextScroll = clamp(cursorMs - (cursorX / width) * nextVisible, 0, nextMaxScroll)
      setZoom(nextZoom)
      setScrollMs(nextScroll)
      return
    }
    const deltaPx = e.deltaX !== 0 ? e.deltaX : e.deltaY
    const deltaMs = width > 0 ? (deltaPx / width) * visibleDurationMs : 0
    setScrollMs(clamp(scrollMs + deltaMs, 0, maxScrollMs))
  }

  const onScrollBar = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setScrollMs(Number(e.target.value))
  }

  return (
    <div ref={containerRef} className="relative flex flex-col min-h-0 border-t border-border bg-card/30">
      <div
        ref={tracksScrollRef}
        className="relative flex-1 overflow-y-auto min-h-0 [scrollbar-gutter:stable]"
        onWheel={onWheel}
      >
        <div className="sticky top-0 z-10 flex shrink-0 border-b border-border bg-card/30">
          <div style={{ width: TRACK_HEADER_W }} className="shrink-0" />
          <div ref={timelineContentRef} className="flex-1 min-w-0">
            <VideoTimeRuler
              width={width}
              scrollMs={scrollMs}
              visibleDurationMs={visibleDurationMs}
              msToX={msToX}
            />
          </div>
        </div>

        {layers.map((layer, layerIndex) => {
          const style = LAYER_STYLE[layer.type]
          const isSelectedLayer = layer.id === selectedLayerId
          const isDropTarget =
            hoverLayerIndex === layerIndex ||
            (hoverLayerIndex === -1 && layerIndex === 0) ||
            (hoverLayerIndex === layers.length && layerIndex === layers.length - 1)
          return (
          <div
            key={layer.id}
            className={cn(
              'flex border-b border-border/60',
              isDropTarget && 'ring-1 ring-inset ring-primary/60 bg-primary/5'
            )}
            style={{ height: LAYER_HEIGHT }}
          >
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
                        startY: e.clientY,
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

      {maxScrollMs > 0 && (
        <div className="flex shrink-0 border-t border-border bg-card/50 py-1">
          <div style={{ width: TRACK_HEADER_W }} className="shrink-0" />
          <input
            type="range"
            min={0}
            max={maxScrollMs}
            step={Math.max(1, Math.round(maxScrollMs / 500))}
            value={scrollMs}
            onChange={onScrollBar}
            className="flex-1 min-w-0 mx-2 h-2 accent-primary cursor-pointer"
            aria-label="Timeline horizontal scroll"
          />
        </div>
      )}

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
        layerIndexFromClientY={layerIndexFromClientY}
        moveSelectedClip={moveSelectedClip}
        moveSelectedClipToPosition={moveSelectedClipToPosition}
        trimSelectedClip={trimSelectedClip}
        setHoverLayerIndex={setHoverLayerIndex}
        width={width}
        visibleDurationMs={visibleDurationMs}
      />
    </div>
  )
}

function GlobalDragHandler({
  dragRef,
  trimRef,
  layerIndexFromClientY,
  moveSelectedClip,
  moveSelectedClipToPosition,
  trimSelectedClip,
  setHoverLayerIndex,
  width,
  visibleDurationMs
}: {
  dragRef: React.MutableRefObject<{
    clipId: string
    startX: number
    startY: number
    startMs: number
  } | null>
  trimRef: React.MutableRefObject<{ edge: 'in' | 'out'; startX: number } | null>
  layerIndexFromClientY: (clientY: number) => number
  moveSelectedClip: (ms: number) => void
  moveSelectedClipToPosition: (ms: number, visualLayerIndex: number) => void
  trimSelectedClip: (edge: 'in' | 'out', deltaMs: number) => void
  setHoverLayerIndex: (index: number | null) => void
  width: number
  visibleDurationMs: number
}): null {
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (dragRef.current) {
        const deltaPx = e.clientX - dragRef.current.startX
        const deltaMs = (deltaPx / width) * visibleDurationMs
        moveSelectedClip(Math.max(0, dragRef.current.startMs + deltaMs))
        setHoverLayerIndex(layerIndexFromClientY(e.clientY))
      }
      if (trimRef.current) {
        const deltaPx = e.clientX - trimRef.current.startX
        const deltaMs = (deltaPx / width) * visibleDurationMs
        trimSelectedClip(trimRef.current.edge, deltaMs)
        trimRef.current.startX = e.clientX
      }
    }
    const onUp = (e: MouseEvent): void => {
      if (dragRef.current) {
        const deltaPx = e.clientX - dragRef.current.startX
        const deltaMs = (deltaPx / width) * visibleDurationMs
        const timelineStartMs = Math.max(0, dragRef.current.startMs + deltaMs)
        const layerIndex = layerIndexFromClientY(e.clientY)
        moveSelectedClipToPosition(timelineStartMs, layerIndex)
      }
      dragRef.current = null
      trimRef.current = null
      setHoverLayerIndex(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [
    dragRef,
    trimRef,
    layerIndexFromClientY,
    moveSelectedClip,
    moveSelectedClipToPosition,
    trimSelectedClip,
    setHoverLayerIndex,
    width,
    visibleDurationMs
  ])

  return null
}

export function localMediaUrl(path: string, _type?: string): string {
  return localMediaPathUrl(path)
}
