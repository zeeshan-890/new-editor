export function timelineVisibleDurationMs(durationMs: number, zoom: number): number {
  return durationMs / zoom
}

export function timelineMaxScrollMs(durationMs: number, zoom: number): number {
  return Math.max(0, durationMs - timelineVisibleDurationMs(durationMs, zoom))
}

export function clampTimelineScrollMs(
  durationMs: number,
  zoom: number,
  scrollMs: number
): number {
  return Math.max(0, Math.min(timelineMaxScrollMs(durationMs, zoom), scrollMs))
}

/** Zoom while keeping `anchorMs` at the same fraction across the viewport width. */
export function zoomTimelineAt(
  durationMs: number,
  zoom: number,
  scrollMs: number,
  factor: number,
  anchorMs: number,
  anchorViewportRatio: number
): { zoom: number; scrollMs: number } {
  const nextZoom = Math.max(0.1, Math.min(100, zoom * factor))
  const nextVisible = timelineVisibleDurationMs(durationMs, nextZoom)
  const nextScroll = clampTimelineScrollMs(
    durationMs,
    nextZoom,
    anchorMs - anchorViewportRatio * nextVisible
  )
  return { zoom: nextZoom, scrollMs: nextScroll }
}
