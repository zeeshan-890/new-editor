import { Loader2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'
import type { CharacterProfile, ScriptSegment } from '@shared/segmentPipeline'
import {
  STATUS_LABELS,
  characterNames,
  formatAudioMatchMeta,
  isRunningStatus,
  sortSegments,
  statusClass
} from './pipelineSegmentUi'

export type PipelineSegmentTab = 'preview' | 'images' | 'script' | 'prompt' | 'videos' | 'audio'

export const PIPELINE_SEGMENT_TABS: Array<{ id: PipelineSegmentTab; label: string }> = [
  { id: 'preview', label: 'Preview' },
  { id: 'images', label: 'Images' },
  { id: 'script', label: 'Script' },
  { id: 'prompt', label: 'Prompt' },
  { id: 'videos', label: 'Videos' },
  { id: 'audio', label: 'Audio' }
]

export function PipelineSegmentEmptyState(): React.JSX.Element {
  return (
    <p className="text-xs text-muted py-6 text-center">
      No segments yet. Analyze your script in the pipeline sidebar to create segments.
    </p>
  )
}

export function PipelineSegmentTabBar({
  active,
  onChange
}: {
  active: PipelineSegmentTab
  onChange: (tab: PipelineSegmentTab) => void
}): React.JSX.Element {
  return (
    <div className="flex border-b border-border overflow-x-auto shrink-0 px-4">
      {PIPELINE_SEGMENT_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            'shrink-0 px-3 py-2 text-xs font-medium transition-colors',
            active === tab.id
              ? 'text-primary border-b-2 border-primary bg-background/40'
              : 'text-muted hover:text-foreground'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function SegmentStatusBadge({ segment }: { segment: ScriptSegment }): React.JSX.Element {
  return (
    <span className={`inline-flex items-center gap-1 ${statusClass(segment.status)}`}>
      {isRunningStatus(segment.status) && (
        <Loader2 size={10} className="animate-spin shrink-0" />
      )}
      {STATUS_LABELS[segment.status] ?? segment.status}
    </span>
  )
}

function RetryActions({
  segmentId,
  onRetry
}: {
  segmentId: string
  onRetry: (segmentId: string, stage: 'image' | 'video' | 'full') => void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className="text-[10px] text-primary hover:underline"
        onClick={() => onRetry(segmentId, 'image')}
      >
        Retry image
      </button>
      <button
        type="button"
        className="text-[10px] text-primary hover:underline"
        onClick={() => onRetry(segmentId, 'video')}
      >
        Retry video
      </button>
    </div>
  )
}

function SegmentMediaThumb({
  segment,
  media
}: {
  segment: ScriptSegment
  media: 'image' | 'video'
}): React.JSX.Element | null {
  const path = media === 'image' ? segment.imageLocalPath : segment.videoLocalPath
  if (!path) return null
  const src = localMediaPathUrl(path)
  if (media === 'video') {
    return (
      <video
        src={src}
        muted
        playsInline
        preload="metadata"
        className="h-14 w-20 rounded border border-border object-cover bg-black/40"
      />
    )
  }
  return (
    <img
      src={src}
      alt={`Segment ${segment.index + 1}`}
      className="h-14 w-20 rounded border border-border object-cover bg-black/40"
    />
  )
}

function ImagesTab({
  segments,
  characters,
  onEditSegment,
  onRetry
}: {
  segments: ScriptSegment[]
  characters: CharacterProfile[]
  onEditSegment: (segmentId: string, patch: Partial<ScriptSegment>) => void
  onRetry: (segmentId: string, stage: 'image' | 'video' | 'full') => void
}): React.JSX.Element {
  const sorted = sortSegments(segments)

  return (
    <div className="space-y-2">
      {sorted.map((segment) => (
        <div key={segment.id} className="rounded-md border border-border p-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium text-muted">Segment {segment.index + 1}</span>
            <SegmentStatusBadge segment={segment} />
          </div>
          <div className="flex gap-2">
            <SegmentMediaThumb segment={segment} media="image" />
            <div className="min-w-0 flex-1 space-y-1 text-[10px]">
              <p>
                <span className="text-muted">Characters:</span> {characterNames(segment, characters)}
              </p>
              <p>
                <span className="text-muted">Continuity:</span>{' '}
                {segment.continuityFromPrevious ? 'continues previous' : 'new scene'}
              </p>
              <p className="truncate">
                <span className="text-muted">Refs:</span>{' '}
                {segment.scriptReferenceIds?.length
                  ? segment.scriptReferenceIds.join(', ')
                  : '—'}
              </p>
              <p className="truncate">
                <span className="text-muted">Image path:</span>{' '}
                {segment.imageLocalPath ?? '—'}
              </p>
              {segment.imageJobId && (
                <p className="truncate">
                  <span className="text-muted">Job:</span> {segment.imageJobId}
                </p>
              )}
            </div>
          </div>
          <label className="block text-[10px] text-muted">Image prompt</label>
          <textarea
            value={segment.imagePrompt}
            onChange={(e) => onEditSegment(segment.id, { imagePrompt: e.target.value })}
            rows={3}
            className="w-full rounded border border-border bg-background px-2 py-1 text-[10px] resize-y"
          />
          <RetryActions segmentId={segment.id} onRetry={onRetry} />
          {segment.error && <p className="text-[9px] text-red-400">{segment.error}</p>}
        </div>
      ))}
    </div>
  )
}

function ScriptTab({
  segments,
  onEditSegment
}: {
  segments: ScriptSegment[]
  onEditSegment: (segmentId: string, patch: Partial<ScriptSegment>) => void
}): React.JSX.Element {
  const sorted = sortSegments(segments)

  return (
    <div className="space-y-2">
      {sorted.map((segment) => (
        <div key={segment.id} className="rounded-md border border-border p-2 space-y-1">
          <span className="text-[10px] font-medium text-muted">Segment {segment.index + 1}</span>
          <textarea
            value={segment.scriptText}
            onChange={(e) =>
              onEditSegment(segment.id, { scriptText: e.target.value, scriptMatch: null })
            }
            rows={4}
            className="w-full rounded border border-border bg-background px-2 py-1 text-[10px] resize-y"
          />
        </div>
      ))}
    </div>
  )
}

function PromptTab({
  segments,
  onEditSegment
}: {
  segments: ScriptSegment[]
  onEditSegment: (segmentId: string, patch: Partial<ScriptSegment>) => void
}): React.JSX.Element {
  const sorted = sortSegments(segments)

  return (
    <div className="space-y-2">
      {sorted.map((segment) => (
        <div key={segment.id} className="rounded-md border border-border p-2 space-y-2">
          <span className="text-[10px] font-medium text-muted">Segment {segment.index + 1}</span>
          <div>
            <label className="text-[10px] text-muted">Image prompt</label>
            <textarea
              value={segment.imagePrompt}
              onChange={(e) => onEditSegment(segment.id, { imagePrompt: e.target.value })}
              rows={3}
              className="w-full rounded border border-border bg-background px-2 py-1 text-[10px] resize-y"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted">Video motion prompt</label>
            <textarea
              value={segment.videoMotionPrompt ?? ''}
              onChange={(e) => onEditSegment(segment.id, { videoMotionPrompt: e.target.value })}
              rows={2}
              placeholder="Visible subject action + slow camera push-in…"
              className="w-full rounded border border-border bg-background px-2 py-1 text-[10px] resize-y"
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function VideosTab({
  segments,
  onEditSegment,
  onRetry
}: {
  segments: ScriptSegment[]
  onEditSegment: (segmentId: string, patch: Partial<ScriptSegment>) => void
  onRetry: (segmentId: string, stage: 'image' | 'video' | 'full') => void
}): React.JSX.Element {
  const sorted = sortSegments(segments)

  return (
    <div className="space-y-2">
      {sorted.map((segment) => (
        <div key={segment.id} className="rounded-md border border-border p-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium text-muted">Segment {segment.index + 1}</span>
            <SegmentStatusBadge segment={segment} />
          </div>
          <div className="flex gap-2">
            <SegmentMediaThumb segment={segment} media="video" />
            <div className="min-w-0 flex-1 space-y-1 text-[10px]">
              <p>
                <span className="text-muted">Duration:</span>{' '}
                {segment.scriptMatch
                  ? `${(segment.scriptMatch.durationMs / 1000).toFixed(2)}s`
                  : '—'}
              </p>
              <p className="truncate">
                <span className="text-muted">Video path:</span>{' '}
                {segment.videoLocalPath ?? '—'}
              </p>
              {segment.videoJobId && (
                <p className="truncate">
                  <span className="text-muted">Job:</span> {segment.videoJobId}
                </p>
              )}
              {segment.timelineClipId && (
                <p className="truncate">
                  <span className="text-muted">Timeline clip:</span> {segment.timelineClipId}
                </p>
              )}
            </div>
          </div>
          <label className="text-[10px] text-muted">Video motion prompt</label>
          <textarea
            value={segment.videoMotionPrompt ?? ''}
            onChange={(e) => onEditSegment(segment.id, { videoMotionPrompt: e.target.value })}
            rows={2}
            className="w-full rounded border border-border bg-background px-2 py-1 text-[10px] resize-y"
          />
          <RetryActions segmentId={segment.id} onRetry={onRetry} />
          {segment.error && <p className="text-[9px] text-red-400">{segment.error}</p>}
        </div>
      ))}
    </div>
  )
}

function AudioTab({ segments }: { segments: ScriptSegment[] }): React.JSX.Element {
  const sorted = sortSegments(segments)

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-[11px]">
        <thead className="bg-card/80 text-muted">
          <tr>
            <th className="px-2 py-1.5 font-medium">#</th>
            <th className="px-2 py-1.5 font-medium">Script</th>
            <th className="px-2 py-1.5 font-medium">Start</th>
            <th className="px-2 py-1.5 font-medium">End</th>
            <th className="px-2 py-1.5 font-medium">Duration</th>
            <th className="px-2 py-1.5 font-medium">Source</th>
            <th className="px-2 py-1.5 font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((segment) => (
            <tr key={segment.id} className="border-t border-border align-top">
              <td className="px-2 py-2 text-muted">{segment.index + 1}</td>
              <td className="px-2 py-2 max-w-[120px] text-[10px]">{segment.scriptText}</td>
              <td className="px-2 py-2 whitespace-nowrap text-muted">
                {segment.scriptMatch
                  ? `${(segment.scriptMatch.startMs / 1000).toFixed(2)}s`
                  : '—'}
              </td>
              <td className="px-2 py-2 whitespace-nowrap text-muted">
                {segment.scriptMatch
                  ? `${(segment.scriptMatch.endMs / 1000).toFixed(2)}s`
                  : '—'}
              </td>
              <td className="px-2 py-2 whitespace-nowrap text-muted">
                {segment.scriptMatch
                  ? `${(segment.scriptMatch.durationMs / 1000).toFixed(2)}s`
                  : '—'}
              </td>
              <td className="px-2 py-2 whitespace-nowrap text-muted">
                {formatAudioMatchMeta(segment)?.split(' · ')[0] ?? '—'}
              </td>
              <td className="px-2 py-2 whitespace-nowrap text-muted">
                {segment.scriptMatch
                  ? `${(segment.scriptMatch.confidence * 100).toFixed(1)}%`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-2 py-2 text-[9px] text-muted border-t border-border">
        {sorted.filter((s) => s.scriptMatch).length}/{sorted.length} segments timed
      </p>
    </div>
  )
}

export function PipelineSegmentTabContent({
  active,
  segments,
  characters,
  onEditSegment,
  onRetry
}: {
  active: PipelineSegmentTab
  segments: ScriptSegment[]
  characters: CharacterProfile[]
  onEditSegment: (segmentId: string, patch: Partial<ScriptSegment>) => void
  onRetry: (segmentId: string, stage: 'image' | 'video' | 'full') => void
}): React.JSX.Element {
  if (active === 'preview') return <></>
  if (segments.length === 0) return <PipelineSegmentEmptyState />

  if (active === 'images') {
    return (
      <ImagesTab
        segments={segments}
        characters={characters}
        onEditSegment={onEditSegment}
        onRetry={onRetry}
      />
    )
  }
  if (active === 'script') {
    return <ScriptTab segments={segments} onEditSegment={onEditSegment} />
  }
  if (active === 'prompt') {
    return <PromptTab segments={segments} onEditSegment={onEditSegment} />
  }
  if (active === 'videos') {
    return (
      <VideosTab segments={segments} onEditSegment={onEditSegment} onRetry={onRetry} />
    )
  }
  return <AudioTab segments={segments} />
}
