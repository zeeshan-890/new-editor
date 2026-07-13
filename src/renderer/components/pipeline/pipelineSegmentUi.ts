import type { CharacterProfile, ScriptSegment, SegmentStatus } from '@shared/segmentPipeline'

export function formatAudioRef(segment: ScriptSegment): string {
  if (!segment.scriptMatch) return '—'
  const start = (segment.scriptMatch.startMs / 1000).toFixed(2)
  const end = (segment.scriptMatch.endMs / 1000).toFixed(2)
  const duration = (segment.scriptMatch.durationMs / 1000).toFixed(2)
  return `${start}s – ${end}s (${duration}s)`
}

export function formatAudioMatchMeta(segment: ScriptSegment): string | null {
  if (!segment.scriptMatch) return null
  const source = segment.scriptMatch.matchSource ?? 'sequential'
  const sourceLabel =
    source === 'word-aligned'
      ? 'sequential'
      : source === 'forced-align'
        ? 'sequential'
        : source === 'weighted-fallback'
          ? 'legacy-weighted'
          : source === 'equal-fallback'
            ? 'legacy-split'
            : source === 'sequential'
              ? 'sequential'
              : source
  const confidence = `${(segment.scriptMatch.confidence * 100).toFixed(1)}%`
  return `${sourceLabel} · ${confidence}`
}

export function characterNames(segment: ScriptSegment, characters: CharacterProfile[]): string {
  if (segment.characters.length === 0) return '—'
  return segment.characters
    .map((id) => {
      const ch = characters.find((c) => c.id === id)
      if (!ch) return id
      return ch.role ? `${ch.name} (${ch.role})` : ch.name
    })
    .join(', ')
}

export const STATUS_LABELS: Record<SegmentStatus, string> = {
  pending: 'Waiting',
  anchor_running: 'Anchors…',
  image_running: 'Generating image',
  image_pending_approval: 'Awaiting approval',
  image_done: 'Image ready',
  audio_match_done: 'Audio synced',
  video_running: 'Generating video',
  video_done: 'Video ready',
  timeline_placed: 'On timeline',
  failed: 'Failed'
}

export function statusClass(status: SegmentStatus): string {
  if (status === 'failed') return 'text-red-400'
  if (status === 'timeline_placed' || status === 'video_done') return 'text-green-400'
  if (status === 'image_done' || status === 'audio_match_done') return 'text-emerald-400'
  if (status === 'image_pending_approval') return 'text-amber-400'
  if (
    status === 'image_running' ||
    status === 'video_running' ||
    status === 'anchor_running'
  ) {
    return 'text-primary'
  }
  return 'text-muted'
}

export function isRunningStatus(status: SegmentStatus): boolean {
  return (
    status === 'image_running' ||
    status === 'video_running' ||
    status === 'anchor_running'
  )
}

export function sortSegments(segments: ScriptSegment[]): ScriptSegment[] {
  return [...segments].sort((a, b) => a.index - b.index)
}
