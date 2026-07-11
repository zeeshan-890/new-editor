import { create } from 'zustand'

interface PlayheadState {
  playheadMs: number
  isPlaying: boolean
  setPlayheadMs: (ms: number) => void
  setIsPlaying: (playing: boolean) => void
  resetPlayhead: () => void
}

/** High-frequency transport clock — isolated from timeline view / project stores. */
export const usePlayheadStore = create<PlayheadState>((set) => ({
  playheadMs: 0,
  isPlaying: false,
  setPlayheadMs: (playheadMs) => set({ playheadMs }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  resetPlayhead: () => set({ playheadMs: 0, isPlaying: false })
}))
