import { memo, useCallback, useMemo } from 'react'
import {
  Clock,
  Download,
  Loader2,
  Scissors,
  Sparkles
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '../common/Button'
import { setGalleryDragData } from '@renderer/lib/galleryDrag'
import { generationVideoSrc } from '@renderer/lib/projectEditorMedia'
import { useProjectGallery } from '@renderer/hooks/useProjectGallery'
import type { GalleryEntry } from '@renderer/lib/projectGallerySections'
import type { CharacterProfile, ScriptSegment } from '@shared/segmentPipeline'
import type {
  GenerationComposerSnapshot,
  HiggsfieldGenerationJob,
  ProjectGeneration
} from '@shared/types'
import { imageModelShortLabel } from '@shared/imageModels'
import { LazyGalleryMedia } from './LazyGalleryMedia'
import { GalleryVirtualScroll } from './GalleryVirtualScroll'

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url)
}

function shortModelLabel(model: string): string {
  return imageModelShortLabel(model)
}

function galleryEntryKey(entry: GalleryEntry): string {
  switch (entry.kind) {
    case 'pending-job':
      return `job-${entry.job.id}`
    case 'segment-running':
      return `seg-run-${entry.segment.id}`
    case 'character-running':
      return `char-run-${entry.character.id}`
    case 'segment-media':
      return `seg-${entry.media}-${entry.segment.id}`
    case 'character-media':
      return `char-${entry.character.id}`
    case 'segment-pending-approval':
      return `seg-pending-${entry.segment.id}`
    case 'generation':
      return `gen-${entry.item.id}`
  }
}

const MemoGalleryTile = memo(function GalleryTile({
  item,
  indexLabel,
  selected,
  onPreview,
  onLoadSettings,
  onDownload,
  onAddToEditor
}: {
  item: ProjectGeneration
  indexLabel: string
  selected: boolean
  onPreview: (item: ProjectGeneration) => void
  onLoadSettings: (item: ProjectGeneration) => void
  onDownload: (item: ProjectGeneration) => void
  onAddToEditor: (item: ProjectGeneration) => void
}): React.JSX.Element {
  const isVideo = item.type === 'video' || isVideoUrl(item.url)
  const mediaSrc = generationVideoSrc(item)

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.stopPropagation()
        setGalleryDragData(e.dataTransfer, item)
      }}
      className={cn(
        'group relative aspect-square rounded-lg border overflow-hidden bg-card cursor-pointer',
        selected
          ? 'border-primary ring-2 ring-primary/60 shadow-lg shadow-primary/10'
          : 'border-border hover:border-primary/40'
      )}
      onClick={() => onPreview(item)}
      onDoubleClick={() => onLoadSettings(item)}
    >
      <LazyGalleryMedia src={mediaSrc} alt={item.prompt} isVideo={isVideo} />

      <div className="absolute top-2 left-2 flex flex-col gap-1 items-start pointer-events-none">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            isVideo ? 'bg-violet-600/95 text-white' : 'bg-emerald-600/95 text-white'
          )}
        >
          {isVideo ? 'Video' : 'Image'}
        </span>
        <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white">
          {indexLabel}
        </span>
        <span className="rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white/90 max-w-[120px] truncate">
          {shortModelLabel(item.model)}
        </span>
      </div>

      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100">
        <button
          type="button"
          className="rounded-full bg-black/50 p-1 hover:bg-black/70"
          title="Load settings into sidebar"
          onClick={(e) => {
            e.stopPropagation()
            onLoadSettings(item)
          }}
        >
          <Sparkles size={12} className="text-white" />
        </button>
        <button
          type="button"
          className="rounded-full bg-black/50 p-1 hover:bg-black/70"
          title="Add to video editor"
          onClick={(e) => {
            e.stopPropagation()
            onAddToEditor(item)
          }}
        >
          <Scissors size={12} className="text-white" />
        </button>
        <button
          type="button"
          className="rounded-full bg-black/50 p-1 hover:bg-black/70"
          title="Download"
          onClick={(e) => {
            e.stopPropagation()
            onDownload(item)
          }}
        >
          <Download size={12} className="text-white" />
        </button>
      </div>

      {selected && (
        <span className="absolute bottom-10 left-2 rounded bg-primary/90 px-1.5 py-0.5 text-[9px] font-medium text-white pointer-events-none">
          Loaded in sidebar
        </span>
      )}

      <span className="absolute bottom-10 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white/80 opacity-0 group-hover:opacity-100 pointer-events-none">
        {isVideo ? 'Drag to editor' : 'Drag to attach'}
      </span>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-2 pt-6 pointer-events-none">
        <p className="text-[10px] text-white line-clamp-2">{item.prompt || '—'}</p>
      </div>
    </div>
  )
})

const MemoPendingJobTile = memo(function PendingJobTile({
  job,
  config
}: {
  job: HiggsfieldGenerationJob
  config?: GenerationComposerSnapshot
}): React.JSX.Element {
  const isVideo = job.category === 'video'
  const label = config?.prompt?.trim() || job.prompt.trim() || '—'

  return (
    <div className="relative aspect-square rounded-lg border border-primary/40 overflow-hidden bg-card ring-2 ring-primary/20">
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-background/80 p-3 text-center">
        {job.status === 'queued' ? (
          <Clock size={22} className="text-muted" />
        ) : (
          <Loader2 size={24} className="animate-spin text-primary" />
        )}
        <span className="text-[10px] text-muted line-clamp-3">
          {job.progressMessage ?? (job.status === 'queued' ? 'Queued…' : 'Generating…')}
        </span>
      </div>
      <div className="absolute top-2 left-2 flex flex-col gap-1">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
            isVideo ? 'bg-violet-600/95 text-white' : 'bg-emerald-600/95 text-white'
          )}
        >
          {isVideo ? 'Video' : 'Image'}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2 pt-6">
        <p className="text-[10px] text-white line-clamp-2">{label}</p>
      </div>
    </div>
  )
})

const MemoPipelineSegmentProgressTile = memo(function PipelineSegmentProgressTile({
  segment
}: {
  segment: ScriptSegment
}): React.JSX.Element {
  return (
    <div className="relative aspect-square rounded-lg border border-primary/40 overflow-hidden bg-card">
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3">
        <Loader2 size={24} className="animate-spin text-primary" />
        <span className="text-[10px] text-muted">Segment {segment.index + 1}</span>
      </div>
    </div>
  )
})

const MemoPipelineCharacterProgressTile = memo(function PipelineCharacterProgressTile({
  character
}: {
  character: CharacterProfile
}): React.JSX.Element {
  return (
    <div className="relative aspect-square rounded-lg border border-primary/40 overflow-hidden bg-card">
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3">
        <Loader2 size={24} className="animate-spin text-primary" />
        <span className="text-[10px] text-muted">{character.name}</span>
      </div>
    </div>
  )
})

const MemoPendingSegmentApprovalTile = memo(function PendingSegmentApprovalTile({
  segment,
  item,
  onPreview,
  onApprove
}: {
  segment: ScriptSegment
  item: ProjectGeneration
  onPreview: (item: ProjectGeneration) => void
  onApprove: (segmentId: string) => void
}): React.JSX.Element {
  const mediaSrc = generationVideoSrc(item)

  return (
    <div className="relative aspect-square rounded-lg border-2 border-amber-500/60 overflow-hidden bg-card ring-2 ring-amber-500/20">
      <button type="button" className="block h-full w-full" onClick={() => onPreview(item)}>
        <LazyGalleryMedia
          src={mediaSrc}
          alt={`Segment ${segment.index + 1} pending approval`}
          isVideo={false}
        />
      </button>
      <div className="absolute top-2 left-2 flex flex-col gap-1 pointer-events-none">
        <span className="rounded bg-amber-600/95 px-1.5 py-0.5 text-[10px] font-semibold text-white uppercase">
          Pending approval
        </span>
        <span className="rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white">
          Segment {segment.index + 1}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2 pt-8 space-y-1">
        <p className="text-[10px] text-white line-clamp-2">
          New version for segment {segment.index + 1}
        </p>
        <Button size="sm" className="w-full h-7 text-[10px]" onClick={() => onApprove(segment.id)}>
          Approve & replace
        </Button>
      </div>
    </div>
  )
})

const MemoGalleryEntryTile = memo(function GalleryEntryTile({
  entry,
  selectedGenerationId,
  onPreview,
  onLoadSettings,
  onDownload,
  onAddToEditor,
  onApproveSegment
}: {
  entry: GalleryEntry
  selectedGenerationId?: string | null
  onPreview: (item: ProjectGeneration) => void
  onLoadSettings: (item: ProjectGeneration) => void
  onDownload: (item: ProjectGeneration) => void
  onAddToEditor: (item: ProjectGeneration) => void
  onApproveSegment: (segmentId: string) => void
}): React.JSX.Element {
  switch (entry.kind) {
    case 'pending-job':
      return <MemoPendingJobTile job={entry.job} config={entry.config} />
    case 'segment-running':
      return <MemoPipelineSegmentProgressTile segment={entry.segment} />
    case 'character-running':
      return <MemoPipelineCharacterProgressTile character={entry.character} />
    case 'segment-pending-approval':
      return (
        <MemoPendingSegmentApprovalTile
          segment={entry.segment}
          item={entry.item}
          onPreview={onPreview}
          onApprove={onApproveSegment}
        />
      )
    case 'generation':
      return (
        <MemoGalleryTile
          item={entry.item}
          indexLabel={entry.badge ?? `#${entry.item.id.slice(0, 6)}`}
          selected={selectedGenerationId === entry.item.id}
          onPreview={onPreview}
          onLoadSettings={onLoadSettings}
          onDownload={onDownload}
          onAddToEditor={onAddToEditor}
        />
      )
    default:
      return <></>
  }
})

export const ProjectGalleryPreview = memo(function ProjectGalleryPreview({
  projectId,
  selectedGenerationId,
  onPreview,
  onLoadSettings,
  onDownload,
  onAddToEditor,
  onApproveSegment
}: {
  projectId: string
  selectedGenerationId?: string | null
  onPreview: (item: ProjectGeneration) => void
  onLoadSettings: (item: ProjectGeneration) => void
  onDownload: (item: ProjectGeneration) => void
  onAddToEditor: (item: ProjectGeneration) => void
  onApproveSegment: (segmentId: string) => void
}): React.JSX.Element {
  const { gallerySections, galleryCounts } = useProjectGallery(projectId)

  const sections = useMemo(
    () => [
      { id: 'characters', title: 'Characters', entries: gallerySections.characters },
      { id: 'images', title: 'Images', entries: gallerySections.images },
      { id: 'clips', title: 'Clips', entries: gallerySections.clips },
      { id: 'other', title: 'Other', entries: gallerySections.other }
    ],
    [gallerySections]
  )

  const renderTile = useCallback(
    (entry: GalleryEntry) => (
      <MemoGalleryEntryTile
        entry={entry}
        selectedGenerationId={selectedGenerationId}
        onPreview={onPreview}
        onLoadSettings={onLoadSettings}
        onDownload={onDownload}
        onAddToEditor={onAddToEditor}
        onApproveSegment={onApproveSegment}
      />
    ),
    [
      selectedGenerationId,
      onPreview,
      onLoadSettings,
      onDownload,
      onAddToEditor,
      onApproveSegment
    ]
  )

  if (galleryCounts.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted text-sm gap-2">
        <Sparkles size={32} className="text-primary/40" />
        <p>No generations yet. Queue images or videos — they run in the background.</p>
      </div>
    )
  }

  return (
    <GalleryVirtualScroll
      sections={sections}
      getEntryKey={galleryEntryKey}
      renderTile={renderTile}
    />
  )
})
