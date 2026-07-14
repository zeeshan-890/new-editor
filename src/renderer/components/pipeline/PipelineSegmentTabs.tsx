import { useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'
import type { CharacterProfile, ScriptSegment } from '@shared/segmentPipeline'
import { MediaLightbox } from '../common/MediaLightbox'
import { PipelinePromptTab } from './PipelinePromptTab'
import {
  STATUS_LABELS,
  characterNames,
  formatAudioMatchMeta,
  isRunningStatus,
  sortSegments,
  statusClass
} from './pipelineSegmentUi'
import type { SegmentPipelineState } from '@shared/segmentPipeline'

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
  onRetry,
  onOpenInSidebar
}: {
  segmentId: string
  onRetry: (segmentId: string, stage: 'image' | 'video' | 'full') => void
  onOpenInSidebar?: (segmentId: string, media: 'image' | 'video') => void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {onOpenInSidebar && (
        <button
          type="button"
          className="text-[10px] text-primary hover:underline"
          onClick={() => onOpenInSidebar(segmentId, 'image')}
        >
          Open in sidebar
        </button>
      )}
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

function VideoSegmentActions({
  segment,
  onRetry,
  onDownload,
  onOpenInSidebar
}: {
  segment: ScriptSegment
  onRetry: (segmentId: string, stage: 'image' | 'video' | 'full') => void
  onDownload?: (segment: ScriptSegment) => void
  onOpenInSidebar?: (segmentId: string, media: 'image' | 'video') => void
}): React.JSX.Element {
  const canDownload = Boolean(segment.videoLocalPath && onDownload)
  return (
    <div className="flex flex-wrap gap-2">
      {onOpenInSidebar && (
        <button
          type="button"
          className="text-[10px] text-primary hover:underline"
          onClick={() => onOpenInSidebar(segment.id, 'video')}
        >
          Open in sidebar
        </button>
      )}
      <button
        type="button"
        className="text-[10px] text-primary hover:underline"
        onClick={() => onRetry(segment.id, 'image')}
      >
        Retry image
      </button>
      <button
        type="button"
        className="text-[10px] text-primary hover:underline"
        onClick={() => onRetry(segment.id, 'video')}
      >
        Retry video
      </button>
      {canDownload && (
        <button
          type="button"
          className="text-[10px] text-primary hover:underline"
          onClick={() => onDownload?.(segment)}
        >
          Download video
        </button>
      )}
    </div>
  )
}

function SegmentMediaThumb({
  segment,
  media,
  onOpen
}: {
  segment: ScriptSegment
  media: 'image' | 'video'
  onOpen?: (segment: ScriptSegment) => void
}): React.JSX.Element | null {
  const path = media === 'image' ? segment.imageLocalPath : segment.videoLocalPath
  if (!path) return null
  const src = localMediaPathUrl(path)
  const clickable = Boolean(onOpen)
  const wrap = (child: React.ReactNode): React.JSX.Element =>
    clickable ? (
      <button
        type="button"
        onClick={() => onOpen?.(segment)}
        title={media === 'video' ? 'Play video' : 'Open image'}
        className="relative shrink-0 rounded border border-border overflow-hidden group cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/50"
      >
        {child}
        {media === 'video' && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/40 transition-colors">
            <span className="rounded-full bg-black/60 p-1.5 text-white">
              <Play size={14} fill="currentColor" />
            </span>
          </span>
        )}
      </button>
    ) : (
      <>{child}</>
    )

  if (media === 'video') {
    return wrap(
      <video
        src={src}
        muted
        playsInline
        preload="metadata"
        className="h-14 w-20 object-cover bg-black/40 pointer-events-none"
      />
    )
  }
  return wrap(
    <img
      src={src}
      alt={`Segment ${segment.index + 1}`}
      className="h-14 w-20 object-cover bg-black/40"
    />
  )
}

function SegmentVideoPlayer({
  segment,
  segments,
  onClose,
  onChange,
  onOpenInSidebar
}: {
  segment: ScriptSegment
  segments: ScriptSegment[]
  onClose: () => void
  onChange: (segment: ScriptSegment) => void
  onOpenInSidebar?: (segmentId: string, media: 'image' | 'video') => void
}): React.JSX.Element | null {
  const path = segment.videoLocalPath
  if (!path) return null
  const playable = segments.filter((s) => s.videoLocalPath)
  const index = playable.findIndex((s) => s.id === segment.id)
  const src = localMediaPathUrl(path)

  return (
    <MediaLightbox
      onClose={onClose}
      ariaLabel={`Segment ${segment.index + 1} video`}
      mediaSrc={src}
      isVideo
      hasPrevious={index > 0}
      hasNext={index >= 0 && index < playable.length - 1}
      onPrevious={() => {
        if (index > 0) onChange(playable[index - 1])
      }}
      onNext={() => {
        if (index >= 0 && index < playable.length - 1) onChange(playable[index + 1])
      }}
      positionLabel={`${index + 1} / ${playable.length}`}
    >
      <video
        key={segment.id}
        src={src}
        controls
        autoPlay
        playsInline
        className="max-h-[78vh] max-w-[96vw] rounded-lg bg-black shadow-2xl"
      />
      <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-white/80">
        <span>Segment {segment.index + 1}</span>
        {onOpenInSidebar && (
          <button
            type="button"
            className="rounded-md border border-white/20 px-2 py-1 text-white/90 hover:bg-white/10"
            onClick={() => {
              onOpenInSidebar(segment.id, 'video')
              onClose()
            }}
          >
            Open in sidebar
          </button>
        )}
      </div>
    </MediaLightbox>
  )
}

function ImagesTab({
  segments,
  characters,
  onEditSegment,
  onRetry,
  onOpenInSidebar,
  onApproveSegment
}: {
  segments: ScriptSegment[]
  characters: CharacterProfile[]
  onEditSegment: (segmentId: string, patch: Partial<ScriptSegment>) => void
  onRetry: (segmentId: string, stage: 'image' | 'video' | 'full') => void
  onOpenInSidebar?: (segmentId: string, media: 'image' | 'video') => void
  onApproveSegment?: (segmentId: string) => void
}): React.JSX.Element {
  const sorted = sortSegments(segments)
  const [preview, setPreview] = useState<{
    segment: ScriptSegment
    kind: 'current' | 'pending'
  } | null>(null)

  const previewSrc = (() => {
    if (!preview) return null
    if (preview.kind === 'pending') {
      const pending = preview.segment.pendingImageApproval
      if (!pending) return null
      return pending.localPath ? localMediaPathUrl(pending.localPath) : pending.url || null
    }
    return preview.segment.imageLocalPath
      ? localMediaPathUrl(preview.segment.imageLocalPath)
      : null
  })()

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted">
        Edit prompts here. After regenerate, review the pending image and Approve & replace.
      </p>
      {sorted.map((segment) => {
        const pending = segment.pendingImageApproval
        const pendingSrc = pending
          ? pending.localPath
            ? localMediaPathUrl(pending.localPath)
            : pending.url || null
          : null

        return (
          <div
            key={segment.id}
            className={cn(
              'rounded-md border p-2 space-y-2',
              pending ? 'border-amber-500/50 bg-amber-500/5' : 'border-border'
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium text-muted">Segment {segment.index + 1}</span>
              <SegmentStatusBadge segment={segment} />
            </div>

            {pending && pendingSrc ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-[9px] uppercase tracking-wide text-muted">Current</p>
                    {segment.imageLocalPath ? (
                      <button
                        type="button"
                        onClick={() => setPreview({ segment, kind: 'current' })}
                        className="block rounded border border-border overflow-hidden focus:outline-none focus:ring-1 focus:ring-primary/40"
                        title="View current image"
                      >
                        <img
                          src={localMediaPathUrl(segment.imageLocalPath)}
                          alt={`Segment ${segment.index + 1} current`}
                          className="h-20 w-28 object-cover bg-black/40"
                        />
                      </button>
                    ) : (
                      <div className="h-20 w-28 rounded border border-dashed border-border flex items-center justify-center text-[9px] text-muted">
                        None
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-[9px] uppercase tracking-wide text-amber-500">New (pending)</p>
                    <button
                      type="button"
                      onClick={() => setPreview({ segment, kind: 'pending' })}
                      className="relative block rounded border-2 border-amber-500/60 overflow-hidden ring-1 ring-amber-500/20 focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                      title="View regenerated image"
                    >
                      <img
                        src={pendingSrc}
                        alt={`Segment ${segment.index + 1} pending approval`}
                        className="h-20 w-28 object-cover bg-black/40"
                      />
                      <span className="absolute top-1 left-1 rounded bg-amber-600/95 px-1 py-0.5 text-[8px] font-semibold text-white uppercase">
                        Review
                      </span>
                    </button>
                  </div>
                </div>
                <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-2 space-y-2">
                  <p className="text-[10px] text-amber-700 dark:text-amber-200">
                    New image ready — approve to replace the current segment image, or open in
                    sidebar to generate again.
                  </p>
                  {pending.imagePrompt && (
                    <p className="text-[10px] text-muted line-clamp-2" title={pending.imagePrompt}>
                      Prompt: {pending.imagePrompt}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {onApproveSegment && (
                      <button
                        type="button"
                        className="rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:opacity-90"
                        onClick={() => onApproveSegment(segment.id)}
                      >
                        Approve & replace
                      </button>
                    )}
                    {onOpenInSidebar && (
                      <button
                        type="button"
                        className="rounded border border-border px-2 py-1 text-[10px] text-primary hover:bg-card"
                        onClick={() => onOpenInSidebar(segment.id, 'image')}
                      >
                        Open in sidebar
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-[10px] text-primary hover:underline"
                      onClick={() => onRetry(segment.id, 'image')}
                    >
                      Retry image
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <SegmentMediaThumb
                  segment={segment}
                  media="image"
                  onOpen={
                    segment.imageLocalPath
                      ? () => setPreview({ segment, kind: 'current' })
                      : undefined
                  }
                />
                <div className="min-w-0 flex-1 space-y-1 text-[10px]">
                  <p>
                    <span className="text-muted">Characters:</span>{' '}
                    {characterNames(segment, characters)}
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
            )}

            <label className="block text-[10px] font-medium text-foreground">Image prompt</label>
            <textarea
              value={pending?.imagePrompt ?? segment.imagePrompt}
              onChange={(e) => {
                const value = e.target.value
                if (pending) {
                  onEditSegment(segment.id, {
                    imagePrompt: value,
                    pendingImageApproval: { ...pending, imagePrompt: value }
                  })
                } else {
                  onEditSegment(segment.id, { imagePrompt: value })
                }
              }}
              rows={4}
              spellCheck
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-[11px] leading-snug resize-y focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            {!pending && (
              <RetryActions
                segmentId={segment.id}
                onRetry={onRetry}
                onOpenInSidebar={onOpenInSidebar}
              />
            )}
            {segment.error && <p className="text-[9px] text-red-400">{segment.error}</p>}
          </div>
        )
      })}

      {preview && previewSrc && (
        <MediaLightbox
          onClose={() => setPreview(null)}
          ariaLabel={
            preview.kind === 'pending'
              ? `Segment ${preview.segment.index + 1} pending image`
              : `Segment ${preview.segment.index + 1} image`
          }
          mediaSrc={previewSrc}
          isVideo={false}
        >
          <img
            src={previewSrc}
            alt={`Segment ${preview.segment.index + 1}`}
            className="max-h-[78vh] max-w-[96vw] rounded-lg object-contain shadow-2xl"
          />
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-white/80">
            <span>
              Segment {preview.segment.index + 1}
              {preview.kind === 'pending' ? ' · Pending approval' : ''}
            </span>
            {preview.kind === 'pending' && onApproveSegment && (
              <button
                type="button"
                className="rounded-md bg-primary px-2 py-1 text-primary-foreground hover:opacity-90"
                onClick={() => {
                  onApproveSegment(preview.segment.id)
                  setPreview(null)
                }}
              >
                Approve & replace
              </button>
            )}
            {onOpenInSidebar && (
              <button
                type="button"
                className="rounded-md border border-white/20 px-2 py-1 text-white/90 hover:bg-white/10"
                onClick={() => {
                  onOpenInSidebar(preview.segment.id, 'image')
                  setPreview(null)
                }}
              >
                Open in sidebar
              </button>
            )}
          </div>
        </MediaLightbox>
      )}
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

function VideosTab({
  segments,
  onEditSegment,
  onRetry,
  onDownloadVideo,
  onOpenInSidebar
}: {
  segments: ScriptSegment[]
  onEditSegment: (segmentId: string, patch: Partial<ScriptSegment>) => void
  onRetry: (segmentId: string, stage: 'image' | 'video' | 'full') => void
  onDownloadVideo?: (segment: ScriptSegment) => void
  onOpenInSidebar?: (segmentId: string, media: 'image' | 'video') => void
}): React.JSX.Element {
  const sorted = sortSegments(segments)
  const [playing, setPlaying] = useState<ScriptSegment | null>(null)

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted">
        Click a thumbnail to play. Open in sidebar to edit motion/start frame and regenerate.
      </p>
      {sorted.map((segment) => (
        <div key={segment.id} className="rounded-md border border-border p-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium text-muted">Segment {segment.index + 1}</span>
            <SegmentStatusBadge segment={segment} />
          </div>
          <div className="flex gap-2">
            <SegmentMediaThumb
              segment={segment}
              media="video"
              onOpen={segment.videoLocalPath ? setPlaying : undefined}
            />
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
          <label className="block text-[10px] font-medium text-foreground">Video motion prompt</label>
          <textarea
            value={segment.videoMotionPrompt ?? ''}
            onChange={(e) => onEditSegment(segment.id, { videoMotionPrompt: e.target.value })}
            rows={3}
            spellCheck
            placeholder="Visible subject action + slow camera push-in…"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-[11px] leading-snug resize-y focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <VideoSegmentActions
            segment={segment}
            onRetry={onRetry}
            onDownload={onDownloadVideo}
            onOpenInSidebar={onOpenInSidebar}
          />
          {segment.error && <p className="text-[9px] text-red-400">{segment.error}</p>}
        </div>
      ))}
      {playing?.videoLocalPath && (
        <SegmentVideoPlayer
          segment={playing}
          segments={sorted}
          onClose={() => setPlaying(null)}
          onChange={setPlaying}
          onOpenInSidebar={onOpenInSidebar}
        />
      )}
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
  pipeline,
  projectId,
  onEditSegment,
  onRetry,
  onDownloadImage,
  onDownloadVideo,
  onOpenInSidebar,
  onApproveSegment,
  onAttachSegmentImages,
  onRemoveSegmentReference
}: {
  active: PipelineSegmentTab
  segments: ScriptSegment[]
  characters: CharacterProfile[]
  pipeline: SegmentPipelineState
  projectId: string
  onEditSegment: (segmentId: string, patch: Partial<ScriptSegment>) => void
  onRetry: (segmentId: string, stage: 'image' | 'video' | 'full') => void
  onDownloadImage?: (segment: ScriptSegment) => void
  onDownloadVideo?: (segment: ScriptSegment) => void
  onOpenInSidebar?: (segmentId: string, media: 'image' | 'video') => void
  onApproveSegment?: (segmentId: string) => void
  onAttachSegmentImages: (segmentId: string, files: File[]) => void | Promise<void>
  onRemoveSegmentReference: (segmentId: string, referenceId: string) => void
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
        onOpenInSidebar={onOpenInSidebar}
        onApproveSegment={onApproveSegment}
      />
    )
  }
  if (active === 'script') {
    return <ScriptTab segments={segments} onEditSegment={onEditSegment} />
  }
  if (active === 'prompt') {
    return (
      <PipelinePromptTab
        projectId={projectId}
        pipeline={pipeline}
        onEditSegment={onEditSegment}
        onRetry={onRetry}
        onDownloadImage={onDownloadImage}
        onDownloadVideo={onDownloadVideo}
        onOpenInSidebar={onOpenInSidebar}
        onApproveSegment={onApproveSegment}
        onAttachSegmentImages={onAttachSegmentImages}
        onRemoveSegmentReference={onRemoveSegmentReference}
      />
    )
  }
  if (active === 'videos') {
    return (
      <VideosTab
        segments={segments}
        onEditSegment={onEditSegment}
        onRetry={onRetry}
        onDownloadVideo={onDownloadVideo}
        onOpenInSidebar={onOpenInSidebar}
      />
    )
  }
  return <AudioTab segments={segments} />
}
