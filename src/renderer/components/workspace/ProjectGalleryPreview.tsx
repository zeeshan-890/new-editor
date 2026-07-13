import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckSquare,
  Clock,
  Download,
  Loader2,
  Scissors,
  Square,
  Sparkles
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '../common/Button'
import { setGalleryDragData } from '@renderer/lib/galleryDrag'
import { generationVideoSrc } from '@renderer/lib/projectEditorMedia'
import { useProjectGallery } from '@renderer/hooks/useProjectGallery'
import {
  flattenGalleryGenerations,
  type GalleryEntry
} from '@renderer/lib/projectGallerySections'
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
  checked,
  onPreview,
  onLoadSettings,
  onDownload,
  onAddToEditor,
  onToggleSelect
}: {
  item: ProjectGeneration
  indexLabel: string
  selected: boolean
  checked: boolean
  onPreview: (item: ProjectGeneration) => void
  onLoadSettings: (item: ProjectGeneration) => void
  onDownload: (item: ProjectGeneration) => void
  onAddToEditor: (item: ProjectGeneration) => void
  onToggleSelect: (item: ProjectGeneration) => void
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
        checked
          ? 'border-sky-500 ring-2 ring-sky-500/50'
          : selected
            ? 'border-primary ring-2 ring-primary/60 shadow-lg shadow-primary/10'
            : 'border-border hover:border-primary/40'
      )}
      onClick={() => onPreview(item)}
      onDoubleClick={() => onLoadSettings(item)}
    >
      <LazyGalleryMedia src={mediaSrc} alt={item.prompt} isVideo={isVideo} />

      <button
        type="button"
        className={cn(
          'absolute top-2 left-2 z-10 rounded bg-black/55 p-1 hover:bg-black/75',
          checked || 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        )}
        title={checked ? 'Deselect' : 'Select for download'}
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelect(item)
        }}
      >
        {checked ? (
          <CheckSquare size={14} className="text-sky-300" />
        ) : (
          <Square size={14} className="text-white/90" />
        )}
      </button>

      <div className="absolute top-2 left-9 flex flex-col gap-1 items-start pointer-events-none">
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
  selectedIds,
  onPreview,
  onLoadSettings,
  onDownload,
  onAddToEditor,
  onApproveSegment,
  onToggleSelect
}: {
  entry: GalleryEntry
  selectedGenerationId?: string | null
  selectedIds: Set<string>
  onPreview: (item: ProjectGeneration) => void
  onLoadSettings: (item: ProjectGeneration) => void
  onDownload: (item: ProjectGeneration) => void
  onAddToEditor: (item: ProjectGeneration) => void
  onApproveSegment: (segmentId: string) => void
  onToggleSelect: (item: ProjectGeneration) => void
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
          checked={selectedIds.has(entry.item.id)}
          onPreview={onPreview}
          onLoadSettings={onLoadSettings}
          onDownload={onDownload}
          onAddToEditor={onAddToEditor}
          onToggleSelect={onToggleSelect}
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
  onDownloadMany,
  onAddToEditor,
  onApproveSegment
}: {
  projectId: string
  selectedGenerationId?: string | null
  onPreview: (item: ProjectGeneration) => void
  onLoadSettings: (item: ProjectGeneration) => void
  onDownload: (item: ProjectGeneration) => void
  onDownloadMany: (items: ProjectGeneration[]) => void | Promise<void>
  onAddToEditor: (item: ProjectGeneration) => void
  onApproveSegment: (segmentId: string) => void
}): React.JSX.Element {
  const { gallerySections, galleryCounts } = useProjectGallery(projectId)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    setSelectedIds(new Set())
  }, [projectId])

  const downloadableItems = useMemo(
    () => flattenGalleryGenerations(gallerySections),
    [gallerySections]
  )

  const sections = useMemo(
    () => [
      { id: 'characters', title: 'Characters', entries: gallerySections.characters },
      { id: 'images', title: 'Images', entries: gallerySections.images },
      { id: 'clips', title: 'Clips', entries: gallerySections.clips },
      { id: 'other', title: 'Other', entries: gallerySections.other }
    ],
    [gallerySections]
  )

  const handleToggleSelect = useCallback((item: ProjectGeneration) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(downloadableItems.map((item) => item.id)))
  }, [downloadableItems])

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleDownloadSelected = useCallback(async () => {
    const items = downloadableItems.filter((item) => selectedIds.has(item.id))
    if (items.length === 0) return
    setDownloading(true)
    try {
      await onDownloadMany(items)
    } finally {
      setDownloading(false)
    }
  }, [downloadableItems, onDownloadMany, selectedIds])

  const renderTile = useCallback(
    (entry: GalleryEntry) => (
      <MemoGalleryEntryTile
        entry={entry}
        selectedGenerationId={selectedGenerationId}
        selectedIds={selectedIds}
        onPreview={onPreview}
        onLoadSettings={onLoadSettings}
        onDownload={onDownload}
        onAddToEditor={onAddToEditor}
        onApproveSegment={onApproveSegment}
        onToggleSelect={handleToggleSelect}
      />
    ),
    [
      selectedGenerationId,
      selectedIds,
      onPreview,
      onLoadSettings,
      onDownload,
      onAddToEditor,
      onApproveSegment,
      handleToggleSelect
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

  const selectedCount = selectedIds.size
  const allSelected =
    downloadableItems.length > 0 && selectedCount === downloadableItems.length

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Button size="sm" variant="outline" onClick={allSelected ? handleClearSelection : handleSelectAll}>
          {allSelected ? (
            <>
              <CheckSquare size={14} className="mr-1" /> Clear selection
            </>
          ) : (
            <>
              <Square size={14} className="mr-1" /> Select all
            </>
          )}
        </Button>
        {selectedCount > 0 && (
          <>
            <Button size="sm" variant="outline" onClick={handleClearSelection}>
              Clear ({selectedCount})
            </Button>
            <Button
              size="sm"
              onClick={() => void handleDownloadSelected()}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 size={14} className="mr-1 animate-spin" />
              ) : (
                <Download size={14} className="mr-1" />
              )}
              Download selected ({selectedCount})
            </Button>
          </>
        )}
        <span className="text-[10px] text-muted">
          Hover a card and click the checkbox to multi-select
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <GalleryVirtualScroll
          sections={sections}
          getEntryKey={galleryEntryKey}
          renderTile={renderTile}
        />
      </div>
    </div>
  )
})
