import type { PeakLevel } from '@shared/types'

export class AudioPlayer {
  private context: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private buffer: AudioBuffer | null = null
  private startedAt = 0
  private pausedAt = 0
  private playing = false
  private onTimeUpdate: ((timeMs: number) => void) | null = null
  private rafId: number | null = null

  async loadFromUrl(url: string): Promise<void> {
    if (this.context) {
      await this.context.close()
    }
    this.context = new AudioContext()
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    this.buffer = await this.context.decodeAudioData(arrayBuffer)
    this.pausedAt = 0
    this.playing = false
  }

  setOnTimeUpdate(cb: (timeMs: number) => void): void {
    this.onTimeUpdate = cb
  }

  private tick = (): void => {
    if (!this.playing || !this.context) return
    const elapsed = (this.context.currentTime - this.startedAt) * 1000 + this.pausedAt
    const durationMs = (this.buffer?.duration ?? 0) * 1000
    const time = Math.min(elapsed, durationMs)
    this.onTimeUpdate?.(time)
    if (time >= durationMs) {
      this.stop()
      return
    }
    this.rafId = requestAnimationFrame(this.tick)
  }

  play(fromMs?: number): void {
    if (!this.context || !this.buffer) return
    this.stopSource()
    if (fromMs !== undefined) this.pausedAt = fromMs

    this.source = this.context.createBufferSource()
    this.source.buffer = this.buffer
    this.source.connect(this.context.destination)
    const offsetSec = this.pausedAt / 1000
    this.startedAt = this.context.currentTime
    this.source.start(0, offsetSec)
    this.playing = true
    this.source.onended = () => {
      if (this.playing) this.stop()
    }
    this.rafId = requestAnimationFrame(this.tick)
  }

  pause(): void {
    if (!this.playing || !this.context) return
    const elapsed = (this.context.currentTime - this.startedAt) * 1000 + this.pausedAt
    this.pausedAt = elapsed
    this.stopSource()
    this.playing = false
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.onTimeUpdate?.(this.pausedAt)
  }

  stop(): void {
    this.stopSource()
    this.playing = false
    this.pausedAt = 0
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.onTimeUpdate?.(0)
  }

  seek(timeMs: number): void {
    const wasPlaying = this.playing
    this.pause()
    this.pausedAt = timeMs
    this.onTimeUpdate?.(timeMs)
    if (wasPlaying) this.play()
  }

  isPlaying(): boolean {
    return this.playing
  }

  getCurrentTimeMs(): number {
    if (this.playing && this.context) {
      return (this.context.currentTime - this.startedAt) * 1000 + this.pausedAt
    }
    return this.pausedAt
  }

  getDurationMs(): number {
    return (this.buffer?.duration ?? 0) * 1000
  }

  private stopSource(): void {
    try {
      this.source?.stop()
    } catch {
      // already stopped
    }
    this.source?.disconnect()
    this.source = null
  }

  destroy(): void {
    this.stop()
    this.context?.close()
    this.context = null
    this.buffer = null
  }
}

export function buildPreviewSegments(
  durationMs: number,
  removeRanges: Array<{ startMs: number; endMs: number }>
): Array<{ startMs: number; endMs: number }> {
  const sorted = [...removeRanges].sort((a, b) => a.startMs - b.startMs)
  const keep: Array<{ startMs: number; endMs: number }> = []
  let cursor = 0
  for (const r of sorted) {
    if (r.startMs > cursor) keep.push({ startMs: cursor, endMs: r.startMs })
    cursor = Math.max(cursor, r.endMs)
  }
  if (cursor < durationMs) keep.push({ startMs: cursor, endMs: durationMs })
  return keep
}

export type { PeakLevel }
