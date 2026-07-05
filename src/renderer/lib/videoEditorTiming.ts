import type { TimelineClip } from '@shared/types'
import { clipDurationMs } from '@shared/types'

export function clipSourceMsAtTimeline(clip: TimelineClip, timelineMs: number): number {
  return clip.sourceInMs + (timelineMs - clip.timelineStartMs)
}

export function clipTimelineMsAtSource(clip: TimelineClip, sourceMs: number): number {
  return clip.timelineStartMs + (sourceMs - clip.sourceInMs)
}

export function isTimelineMsInClip(clip: TimelineClip, timelineMs: number): boolean {
  const end = clip.timelineStartMs + clipDurationMs(clip)
  return timelineMs >= clip.timelineStartMs && timelineMs < end
}

export function clampTimelineMsToClip(clip: TimelineClip, timelineMs: number): number {
  const start = clip.timelineStartMs
  const end = start + clipDurationMs(clip)
  return Math.min(end - 1, Math.max(start, timelineMs))
}
