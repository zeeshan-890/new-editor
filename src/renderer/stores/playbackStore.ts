import { create } from 'zustand'
import {
  clampTimelineScrollMs,
  zoomTimelineAt
} from '@renderer/lib/timelineView'
import { usePlayheadStore } from './playheadStore'

export type TimelineTool = 'select' | 'split'

interface PlaybackState {
  loopSelection: boolean
  zoom: number
  scrollMs: number
  timelineTool: TimelineTool

  setTimelineTool: (tool: TimelineTool) => void
  setLoopSelection: (loop: boolean) => void
  setZoom: (zoom: number, durationMs?: number) => void
  setScrollMs: (ms: number, durationMs?: number) => void
  zoomIn: (durationMs?: number, anchorMs?: number, anchorViewportRatio?: number) => void
  zoomOut: (durationMs?: number, anchorMs?: number, anchorViewportRatio?: number) => void
  fitTimelineView: () => void
  clampScrollToDuration: (durationMs: number) => void
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  loopSelection: false,
  zoom: 1,
  scrollMs: 0,
  timelineTool: 'select',

  setTimelineTool: (timelineTool) => set({ timelineTool }),
  setLoopSelection: (loopSelection) => set({ loopSelection }),
  setZoom: (zoom, durationMs) =>
    set((s) => {
      const nextZoom = Math.max(0.1, Math.min(100, zoom))
      if (durationMs == null) return { zoom: nextZoom }
      return {
        zoom: nextZoom,
        scrollMs: clampTimelineScrollMs(durationMs, nextZoom, s.scrollMs)
      }
    }),
  setScrollMs: (scrollMs, durationMs) =>
    set((s) => ({
      scrollMs:
        durationMs == null
          ? Math.max(0, scrollMs)
          : clampTimelineScrollMs(durationMs, s.zoom, scrollMs)
    })),
  zoomIn: (durationMs, anchorMs, anchorViewportRatio) =>
    set((s) => {
      if (durationMs == null) {
        return { zoom: Math.min(100, s.zoom * 1.25) }
      }
      const anchor = anchorMs ?? usePlayheadStore.getState().playheadMs
      const visible = durationMs / s.zoom
      const ratio =
        anchorViewportRatio ?? (visible > 0 ? (anchor - s.scrollMs) / visible : 0.5)
      return zoomTimelineAt(durationMs, s.zoom, s.scrollMs, 1.25, anchor, ratio)
    }),
  zoomOut: (durationMs, anchorMs, anchorViewportRatio) =>
    set((s) => {
      if (durationMs == null) {
        return { zoom: Math.max(0.1, s.zoom / 1.25) }
      }
      const anchor = anchorMs ?? usePlayheadStore.getState().playheadMs
      const visible = durationMs / s.zoom
      const ratio =
        anchorViewportRatio ?? (visible > 0 ? (anchor - s.scrollMs) / visible : 0.5)
      return zoomTimelineAt(durationMs, s.zoom, s.scrollMs, 1 / 1.25, anchor, ratio)
    }),
  fitTimelineView: () => {
    usePlayheadStore.getState().resetPlayhead()
    set({ scrollMs: 0, zoom: 1 })
  },
  clampScrollToDuration: (durationMs) =>
    set((s) => ({
      scrollMs: clampTimelineScrollMs(durationMs, s.zoom, s.scrollMs)
    }))
}))
