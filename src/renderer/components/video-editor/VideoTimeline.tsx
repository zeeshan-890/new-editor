import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock, LockOpen, Volume2, VolumeX } from 'lucide-react'
import { useVideoEditorStore, EMPTY_SILENCE_REGIONS, EMPTY_TIMELINE_MARKERS } from '@renderer/stores/videoEditorStore'
import { usePlayheadStore } from '@renderer/stores/playheadStore'
import { usePlaybackStore } from '@renderer/stores/playbackStore'
import { clipDurationMs, type MediaAsset, type TimelineClip } from '@shared/types'
import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'
import { clamp, cn } from '@renderer/lib/utils'
import {
  clampTimelineScrollMs,
  timelineMaxScrollMs,
  timelineVisibleDurationMs,
  zoomTimelineAt
} from '@renderer/lib/timelineView'
import { MemoTimelineClipBlock } from './TimelineClipBlock'
import { VideoTimeRuler } from './VideoTimeRuler'

const LAYER_HEIGHT = 56
const TRACK_HEADER_W = 140
const RULER_HEIGHT = 24

function previewTrimClip(
  clip: TimelineClip,
  asset: MediaAsset,
  edge: 'in' | 'out',
  deltaMs: number
): TimelineClip {
  if (edge === 'in') {
    const nextIn = clamp(clip.sourceInMs + deltaMs, 0, clip.sourceOutMs - 100)
    const deltaTimeline = nextIn - clip.sourceInMs
    return {
      ...clip,
      sourceInMs: nextIn,
      timelineStartMs: clip.timelineStartMs + deltaTimeline
    }
  }
  const nextOut = clamp(clip.sourceOutMs + deltaMs, clip.sourceInMs + 100, asset.durationMs)
  return { ...clip, sourceOutMs: nextOut }
}

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
  const markers = useVideoEditorStore((s) => s.project.markers ?? EMPTY_TIMELINE_MARKERS)
  const selectedLayerId = useVideoEditorStore((s) => s.project.selectedLayerId)
  const assets = useVideoEditorStore((s) => s.project.assets)
  const selectedClipId = useVideoEditorStore((s) => s.project.selectedClipId)
  const durationMs = useVideoEditorStore((s) => s.durationMs)
  const selectClip = useVideoEditorStore((s) => s.selectClip)
  const selectLayer = useVideoEditorStore((s) => s.selectLayer)
  const toggleLayerMute = useVideoEditorStore((s) => s.toggleLayerMute)
  const toggleLayerLock = useVideoEditorStore((s) => s.toggleLayerLock)
  const moveSelectedClipToPosition = useVideoEditorStore((s) => s.moveSelectedClipToPosition)
  const peekSelectedClipDropTarget = useVideoEditorStore((s) => s.peekSelectedClipDropTarget)
  const trimSelectedClip = useVideoEditorStore((s) => s.trimSelectedClip)
  const splitAllAtTime = useVideoEditorStore((s) => s.splitAllAtTime)
  const pushHistory = useVideoEditorStore((s) => s.pushHistory)

  const zoom = usePlaybackStore((s) => s.zoom)
  const scrollMs = usePlaybackStore((s) => s.scrollMs)
  const timelineTool = usePlaybackStore((s) => s.timelineTool)
  const setPlayheadMs = usePlayheadStore((s) => s.setPlayheadMs)
  const setScrollMs = usePlaybackStore((s) => s.setScrollMs)
  const setZoom = usePlaybackStore((s) => s.setZoom)
  const clampScrollToDuration = usePlaybackStore((s) => s.clampScrollToDuration)

  const containerRef = useRef<HTMLDivElement>(null)
  const tracksScrollRef = useRef<HTMLDivElement>(null)
  const timelineContentRef = useRef<HTMLDivElement>(null)
  const resizeRafRef = useRef<number | null>(null)
  const [width, setWidth] = useState(800)
  const [hoverLayerIndex, setHoverLayerIndex] = useState<number | null>(null)
  const [isDraggingClip, setIsDraggingClip] = useState(false)
  const [dragPreviewMs, setDragPreviewMs] = useState<number | null>(null)
  const [trimPreview, setTrimPreview] = useState<{ edge: 'in' | 'out'; deltaMs: number } | null>(null)
  const dragRef = useRef<{ clipId: string; startX: number; startY: number; startMs: number } | null>(
    null
  )
  const trimRef = useRef<{ edge: 'in' | 'out'; startX: number } | null>(null)
  const scrubRef = useRef(false)
  const playheadRef = useRef<HTMLDivElement>(null)

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
    const ro = new ResizeObserver(() => {
      if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current)
      resizeRafRef.current = requestAnimationFrame(() => {
        setWidth(el.clientWidth)
      })
    })
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => {
      ro.disconnect()
      if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current)
    }
  }, [])

  useEffect(() => {
    clampScrollToDuration(durationMs)
  }, [durationMs, zoom, clampScrollToDuration])

  const visibleDurationMs = timelineVisibleDurationMs(durationMs, zoom)
  const maxScrollMs = timelineMaxScrollMs(durationMs, zoom)
  const msToX = useCallback(
    (ms: number) => ((ms - scrollMs) / visibleDurationMs) * width,
    [scrollMs, visibleDurationMs, width]
  )
  const xToMs = useCallback(
    (x: number) => scrollMs + (x / width) * visibleDurationMs,
    [scrollMs, visibleDurationMs, width]
  )

  const msFromClientX = useCallback(
    (clientX: number): number => {
      const rect = timelineContentRef.current?.getBoundingClientRect()
      if (!rect || width <= 0) return 0
      const x = clientX - rect.left
      return clamp(xToMs(x), 0, durationMs)
    },
    [durationMs, width, xToMs]
  )

  const seekToClientX = useCallback(
    (clientX: number): number => {
      const ms = msFromClientX(clientX)
      setPlayheadMs(ms)
      return ms
    },
    [msFromClientX, setPlayheadMs]
  )

  const splitAtClientX = useCallback(
    (clientX: number): void => {
      const ms = seekToClientX(clientX)
      splitAllAtTime(ms)
    },
    [seekToClientX, splitAllAtTime]
  )

  const onWheel = (e: React.WheelEvent): void => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const rect = timelineContentRef.current?.getBoundingClientRect()
      const cursorX = rect && width > 0 ? clamp(e.clientX - rect.left, 0, width) : width / 2
      const cursorMs = scrollMs + (cursorX / width) * visibleDurationMs
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      const ratio = width > 0 ? cursorX / width : 0.5
      const next = zoomTimelineAt(durationMs, zoom, scrollMs, factor, cursorMs, ratio)
      setZoom(next.zoom, durationMs)
      setScrollMs(next.scrollMs, durationMs)
      return
    }
    const deltaPx = e.deltaX !== 0 ? e.deltaX : e.deltaY
    const deltaMs = width > 0 ? (deltaPx / width) * visibleDurationMs : 0
    setScrollMs(clampTimelineScrollMs(durationMs, zoom, scrollMs + deltaMs), durationMs)
  }

  const onScrollBar = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setScrollMs(Number(e.target.value))
  }

  const assetsById = useMemo(() => {
    const entries = assets.map((asset) => [asset.id, asset] as const)
    return Object.fromEntries(entries)
  }, [assets])

  const setPlayheadPosition = useCallback(
    (playheadMs: number) => {
      const el = playheadRef.current
      if (!el) return
      const left = TRACK_HEADER_W + clamp(msToX(playheadMs), 0, width)
      el.style.left = `${left}px`
    },
    [msToX, width]
  )

  useEffect(() => {
    setPlayheadPosition(usePlayheadStore.getState().playheadMs)
  }, [setPlayheadPosition, scrollMs, zoom, width])

  useEffect(() => {
    const unsubscribe = usePlayheadStore.subscribe((state) => {
      setPlayheadPosition(state.playheadMs)
    })
    return unsubscribe
  }, [setPlayheadPosition])

  const draggingClipInfo = useMemo(() => {
    if (!selectedClipId || !isDraggingClip) return null
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const clip = layer.clips.find((c) => c.id === selectedClipId)
      if (!clip) continue
      const asset = assetsById[clip.assetId]
      if (!asset) return null
      return { clip, asset, sourceLayerIndex: i }
    }
    return null
  }, [selectedClipId, isDraggingClip, layers, assetsById])

  const dropTarget =
    isDraggingClip && hoverLayerIndex !== null
      ? peekSelectedClipDropTarget(hoverLayerIndex)
      : null

  const ghostLayerIndex =
    dropTarget && draggingClipInfo
      ? dropTarget.createNew
        ? dropTarget.insertIndex
        : hoverLayerIndex
      : null

  const showGhost =
    draggingClipInfo &&
    ghostLayerIndex !== null &&
    ghostLayerIndex !== draggingClipInfo.sourceLayerIndex

  const ghostStyle = draggingClipInfo
    ? LAYER_STYLE[
        draggingClipInfo.asset.type === 'audio'
          ? 'audio'
          : draggingClipInfo.asset.type === 'image'
            ? 'overlay'
            : 'video'
      ]
    : null

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex flex-col min-h-0 min-w-0 overflow-hidden border-t border-border bg-card/30',
        timelineTool === 'split' ? 'cursor-col-resize' : 'cursor-default'
      )}
    >
      <div
        ref={tracksScrollRef}
        className="relative flex-1 min-w-0 overflow-x-hidden overflow-y-auto min-h-0 [scrollbar-gutter:stable]"
        onWheel={onWheel}
      >
        <div className="sticky top-0 z-10 flex shrink-0 border-b border-border bg-card/30">
          <div style={{ width: TRACK_HEADER_W }} className="shrink-0" />
          <div ref={timelineContentRef} className="flex-1 min-w-0 overflow-hidden">
            <div
              className={cn('h-6', timelineTool === 'split' ? 'cursor-col-resize' : 'cursor-pointer')}
              onMouseDown={(e) => {
                e.preventDefault()
                if (timelineTool === 'split') {
                  splitAtClientX(e.clientX)
                  return
                }
                scrubRef.current = true
                seekToClientX(e.clientX)
              }}
            >
              <VideoTimeRuler
                width={width}
                scrollMs={scrollMs}
                visibleDurationMs={visibleDurationMs}
                markers={markers}
              />
            </div>
          </div>
        </div>

        {layers.map((layer, layerIndex) => {
          const style = LAYER_STYLE[layer.type]
          const isSelectedLayer = layer.id === selectedLayerId
          const visibleStartMs = scrollMs - visibleDurationMs * 0.1
          const visibleEndMs = scrollMs + visibleDurationMs * 1.1
          const visibleClips = layer.clips.filter((clip) => {
            const clipStart = clip.timelineStartMs
            const clipEnd = clip.timelineStartMs + clipDurationMs(clip)
            return clipEnd >= visibleStartMs && clipStart <= visibleEndMs
          })
          const isDropTarget =
            hoverLayerIndex !== null &&
            (hoverLayerIndex === layerIndex ||
              (dropTarget?.createNew && dropTarget.insertIndex === layerIndex))
          const showLayerGhost = showGhost && ghostLayerIndex === layerIndex && ghostStyle
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
              className={cn(
                'relative flex-1 min-w-0 overflow-hidden',
                style.bar,
                timelineTool === 'split' ? 'cursor-col-resize' : 'cursor-pointer'
              )}
              onMouseDown={(e) => {
                if (e.target !== e.currentTarget) return
                e.preventDefault()
                selectLayer(layer.id)
                selectClip(null)
                if (timelineTool === 'split') {
                  splitAtClientX(e.clientX)
                  return
                }
                scrubRef.current = true
                seekToClientX(e.clientX)
              }}
            >
              {showLayerGhost && draggingClipInfo && ghostStyle && (
                <div
                  className={cn(
                    'absolute top-1 bottom-1 rounded border-2 border-dashed pointer-events-none opacity-70 z-10',
                    ghostStyle.clip
                  )}
                  style={{
                    left: msToX(dragPreviewMs ?? draggingClipInfo.clip.timelineStartMs),
                    width: Math.max(
                      24,
                      msToX(
                        (dragPreviewMs ?? draggingClipInfo.clip.timelineStartMs) +
                          clipDurationMs(draggingClipInfo.clip)
                      ) - msToX(dragPreviewMs ?? draggingClipInfo.clip.timelineStartMs)
                    )
                  }}
                >
                  <span className={cn('absolute left-1 top-0.5 text-[9px] truncate max-w-full', ghostStyle.label)}>
                    {dropTarget?.createNew ? `New ${dropTarget.layerType} layer` : draggingClipInfo.asset.name}
                  </span>
                </div>
              )}
              {visibleClips.map((clip) => {
                const asset = assetsById[clip.assetId]
                if (!asset) return null
                const selected = clip.id === selectedClipId
                const displayClip =
                  selected && trimPreview
                    ? previewTrimClip(clip, asset, trimPreview.edge, trimPreview.deltaMs)
                    : clip
                const effectiveStartMs =
                  isDraggingClip && selected && dragPreviewMs !== null
                    ? dragPreviewMs
                    : displayClip.timelineStartMs
                const left = msToX(effectiveStartMs)
                const w = Math.max(24, msToX(effectiveStartMs + clipDurationMs(displayClip)) - left)
                const isDragSource =
                  isDraggingClip &&
                  showGhost &&
                  draggingClipInfo?.sourceLayerIndex === layerIndex &&
                  selected
                return (
                  <MemoTimelineClipBlock
                    key={clip.id}
                    clip={displayClip}
                    asset={asset}
                    layer={layer}
                    left={left}
                    width={w}
                    selected={selected}
                    style={style}
                    className={isDragSource ? 'opacity-40' : undefined}
                    onMouseDown={(e) => {
                      if (layer.locked) return
                      e.stopPropagation()
                      const clickMs = seekToClientX(e.clientX)
                      if (timelineTool === 'split') {
                        selectClip(clip.id)
                        selectLayer(layer.id)
                        splitAllAtTime(clickMs)
                        return
                      }
                      selectClip(clip.id)
                      selectLayer(layer.id)
                      dragRef.current = {
                        clipId: clip.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        startMs: clip.timelineStartMs
                      }
                      setIsDraggingClip(true)
                    }}
                    onTrimIn={(e) => {
                      e.stopPropagation()
                      selectClip(clip.id)
                      selectLayer(layer.id)
                      trimRef.current = { edge: 'in', startX: e.clientX }
                      setTrimPreview({ edge: 'in', deltaMs: 0 })
                    }}
                    onTrimOut={(e) => {
                      e.stopPropagation()
                      selectClip(clip.id)
                      selectLayer(layer.id)
                      trimRef.current = { edge: 'out', startX: e.clientX }
                      setTrimPreview({ edge: 'out', deltaMs: 0 })
                    }}
                  />
                )
              })}
            </div>
          </div>
        )})}

        {isDraggingClip && hoverLayerIndex === layers.length && dropTarget?.createNew && ghostStyle && draggingClipInfo && (
          <div
            className="flex border-b border-border/60 ring-1 ring-inset ring-primary/60 bg-primary/5"
            style={{ height: LAYER_HEIGHT }}
          >
            <div
              className={cn(
                'shrink-0 px-1.5 flex items-center border-r border-border text-[10px]',
                ghostStyle.bar,
                ghostStyle.label
              )}
              style={{ width: TRACK_HEADER_W }}
            >
              New {dropTarget.layerType} layer
            </div>
            <div className={cn('relative flex-1 min-w-0 overflow-hidden', ghostStyle.bar)}>
              <div
                className={cn(
                  'absolute top-1 bottom-1 rounded border-2 border-dashed pointer-events-none opacity-70',
                  ghostStyle.clip
                )}
                style={{
                  left: msToX(dragPreviewMs ?? draggingClipInfo.clip.timelineStartMs),
                  width: Math.max(
                    24,
                    msToX(
                      (dragPreviewMs ?? draggingClipInfo.clip.timelineStartMs) +
                        clipDurationMs(draggingClipInfo.clip)
                    ) - msToX(dragPreviewMs ?? draggingClipInfo.clip.timelineStartMs)
                  )
                }}
              />
            </div>
          </div>
        )}
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
        ref={playheadRef}
        className="pointer-events-none absolute z-20 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]"
        style={{ top: 24, bottom: 0 }}
      />

      <GlobalDragHandler
        dragRef={dragRef}
        trimRef={trimRef}
        scrubRef={scrubRef}
        layerIndexFromClientY={layerIndexFromClientY}
        moveSelectedClipToPosition={moveSelectedClipToPosition}
        trimSelectedClip={trimSelectedClip}
        pushHistory={pushHistory}
        seekToClientX={seekToClientX}
        setHoverLayerIndex={setHoverLayerIndex}
        setIsDraggingClip={setIsDraggingClip}
        setDragPreviewMs={setDragPreviewMs}
        setTrimPreview={setTrimPreview}
        width={width}
        visibleDurationMs={visibleDurationMs}
      />
    </div>
  )
}

function GlobalDragHandler({
  dragRef,
  trimRef,
  scrubRef,
  layerIndexFromClientY,
  moveSelectedClipToPosition,
  trimSelectedClip,
  pushHistory,
  seekToClientX,
  setHoverLayerIndex,
  setIsDraggingClip,
  setDragPreviewMs,
  setTrimPreview,
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
  scrubRef: React.MutableRefObject<boolean>
  layerIndexFromClientY: (clientY: number) => number
  moveSelectedClipToPosition: (ms: number, visualLayerIndex: number) => void
  trimSelectedClip: (edge: 'in' | 'out', deltaMs: number) => void
  pushHistory: () => void
  seekToClientX: (clientX: number) => number
  setHoverLayerIndex: (index: number | null) => void
  setIsDraggingClip: (dragging: boolean) => void
  setDragPreviewMs: (ms: number | null) => void
  setTrimPreview: (preview: { edge: 'in' | 'out'; deltaMs: number } | null) => void
  width: number
  visibleDurationMs: number
}): null {
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (scrubRef.current) {
        seekToClientX(e.clientX)
      }
      if (dragRef.current) {
        const deltaPx = e.clientX - dragRef.current.startX
        const deltaMs = (deltaPx / width) * visibleDurationMs
        setDragPreviewMs(Math.max(0, dragRef.current.startMs + deltaMs))
        setHoverLayerIndex(layerIndexFromClientY(e.clientY))
      }
      if (trimRef.current) {
        const deltaPx = e.clientX - trimRef.current.startX
        const deltaMs = (deltaPx / width) * visibleDurationMs
        setTrimPreview({ edge: trimRef.current.edge, deltaMs })
      }
    }
    const onUp = (e: MouseEvent): void => {
      if (scrubRef.current) {
        scrubRef.current = false
      }
      if (dragRef.current) {
        const deltaPx = e.clientX - dragRef.current.startX
        const deltaMs = (deltaPx / width) * visibleDurationMs
        const moved = Math.abs(deltaPx) > 3 || Math.abs(e.clientY - dragRef.current.startY) > 3
        if (moved) {
          pushHistory()
          const timelineStartMs = Math.max(0, dragRef.current.startMs + deltaMs)
          const layerIndex = layerIndexFromClientY(e.clientY)
          moveSelectedClipToPosition(timelineStartMs, layerIndex)
        }
      }
      if (trimRef.current) {
        const deltaPx = e.clientX - trimRef.current.startX
        const deltaMs = (deltaPx / width) * visibleDurationMs
        if (Math.abs(deltaMs) >= 1) {
          pushHistory()
          trimSelectedClip(trimRef.current.edge, deltaMs)
        }
      }
      dragRef.current = null
      trimRef.current = null
      setHoverLayerIndex(null)
      setIsDraggingClip(false)
      setDragPreviewMs(null)
      setTrimPreview(null)
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
    scrubRef,
    layerIndexFromClientY,
    moveSelectedClipToPosition,
    trimSelectedClip,
    pushHistory,
    seekToClientX,
    setHoverLayerIndex,
    setIsDraggingClip,
    setDragPreviewMs,
    setTrimPreview,
    width,
    visibleDurationMs
  ])

  return null
}

export function localMediaUrl(path: string, _type?: string): string {
  return localMediaPathUrl(path)
}
