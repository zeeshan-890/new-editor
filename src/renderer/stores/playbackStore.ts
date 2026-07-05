import { create } from 'zustand'

interface PlaybackState {
  playheadMs: number
  isPlaying: boolean
  loopSelection: boolean
  zoom: number
  scrollMs: number

  setPlayheadMs: (ms: number) => void
  setIsPlaying: (playing: boolean) => void
  setLoopSelection: (loop: boolean) => void
  setZoom: (zoom: number) => void
  setScrollMs: (ms: number) => void
  zoomIn: () => void
  zoomOut: () => void
  fitTimelineView: () => void
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  playheadMs: 0,
  isPlaying: false,
  loopSelection: false,
  zoom: 1,
  scrollMs: 0,

  setPlayheadMs: (playheadMs) => set({ playheadMs }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setLoopSelection: (loopSelection) => set({ loopSelection }),
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(100, zoom)) }),
  setScrollMs: (scrollMs) => set({ scrollMs: Math.max(0, scrollMs) }),
  zoomIn: () => set((s) => ({ zoom: Math.min(100, s.zoom * 1.25) })),
  zoomOut: () => set((s) => ({ zoom: Math.max(0.1, s.zoom / 1.25) })),
  fitTimelineView: () => set({ scrollMs: 0, playheadMs: 0, zoom: 1 })
}))
