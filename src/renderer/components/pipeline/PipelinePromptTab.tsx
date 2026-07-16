import { useEffect, useRef, useState } from 'react'
import {
  Download,
  ImagePlus,
  Loader2,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'
import { useHiggsfieldJobById } from '@renderer/hooks/useHiggsfieldJobById'
import {
  allowFileDrop,
  imageFilesFromClipboard,
  imageFilesFromDataTransfer,
  imageFilesFromPasteEvent,
  isImageFile
} from '@renderer/lib/dropFiles'
import {
  previousSegmentImagePath,
  segmentImageAttachments
} from '@shared/pipelineImageRefs'
import type {
  ScriptSegment,
  SegmentPipelineState
} from '@shared/segmentPipeline'
import { MediaLightbox } from '../common/MediaLightbox'
import {
  resolveSegmentImagePhase,
  resolveSegmentVideoPhase,
  segmentStatusDisplay,
  sortSegments,
  statusClass
} from './pipelineSegmentUi'
import type { HiggsfieldJobStatusLookup, SegmentGenerationPhase } from './pipelineSegmentUi'

function StatusBadge({
  segment,
  jobById
}: {
  segment: ScriptSegment
  jobById: HiggsfieldJobStatusLookup
}): React.JSX.Element {
  const display = segmentStatusDisplay(segment, jobById)
  return (
    <span className={`inline-flex items-center gap-1 ${statusClass(segment.status)}`}>
      {display.phase === 'generating' && <Loader2 size={10} className="animate-spin shrink-0" />}
      {display.label}
    </span>
  )
}

function ZoomableImageLightbox({
  src,
  title,
  onClose
}: {
  src: string
  title: string
  onClose: () => void
}): React.JSX.Element {
  const [scale, setScale] = useState(1)

  return (
    <MediaLightbox onClose={onClose} ariaLabel={title} mediaSrc={src} isVideo={false}>
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-xs text-white/80">
          <button
            type="button"
            className="rounded border border-white/20 p-1 hover:bg-white/10"
            onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.25).toFixed(2))))}
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="rounded border border-white/20 p-1 hover:bg-white/10"
            onClick={() => setScale((s) => Math.min(4, Number((s + 0.25).toFixed(2))))}
            title="Zoom in"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            className="rounded border border-white/20 px-2 py-1 hover:bg-white/10"
            onClick={() => setScale(1)}
          >
            Reset
          </button>
        </div>
        <div
          className="max-h-[78vh] max-w-[96vw] overflow-auto rounded-lg bg-black/40"
          onWheel={(e) => {
            if (!e.ctrlKey && !e.metaKey) return
            e.preventDefault()
            const delta = e.deltaY > 0 ? -0.1 : 0.1
            setScale((s) => Math.min(4, Math.max(0.5, Number((s + delta).toFixed(2)))))
          }}
        >
          <img
            src={src}
            alt={title}
            style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
            className="max-h-[78vh] max-w-[96vw] object-contain transition-transform"
          />
        </div>
        <p className="text-xs text-white/70">{title} · Ctrl/⌘ + scroll to zoom</p>
      </div>
    </MediaLightbox>
  )
}

function AttachmentStrip({
  items,
  library,
  attachedPaths,
  onOpen,
  onRemove,
  onAttachFiles,
  onAttachLibraryItem,
  onPaste,
  onDropFiles,
  emptyLabel
}: {
  items: Array<{ id: string; src: string; label: string; removable?: boolean }>
  library: Array<{
    id: string
    src: string
    label: string
    localPath: string
    existingRefId?: string
    kind?: 'upload' | 'frame' | 'anchor'
  }>
  /** Local paths already attached to this segment (for disabling library picks). */
  attachedPaths?: Set<string>
  onOpen: (id: string, src: string, label: string) => void
  onRemove?: (id: string) => void
  onAttachFiles: () => void
  onAttachLibraryItem: (item: {
    id: string
    localPath: string
    label: string
    existingRefId?: string
  }) => void
  onPaste: (e: React.ClipboardEvent) => void
  onDropFiles: (files: File[]) => void
  emptyLabel: string
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const attachedIds = new Set(items.map((i) => i.id))
  const paths = attachedPaths ?? new Set<string>()

  const isAlreadyAttached = (item: (typeof library)[number]): boolean =>
    paths.has(item.localPath) ||
    attachedIds.has(item.id) ||
    (item.existingRefId != null && attachedIds.has(item.existingRefId))

  const uploaded = library.filter((item) => item.kind !== 'frame')
  const frames = library.filter((item) => item.kind === 'frame')

  const renderLibraryGrid = (
    sectionLabel: string,
    sectionItems: typeof library
  ): React.JSX.Element | null => {
    if (sectionItems.length === 0) return null
    return (
      <div className="space-y-1">
        <p className="px-1 text-[9px] uppercase tracking-wide text-muted">{sectionLabel}</p>
        <div className="grid grid-cols-4 gap-1">
          {sectionItems.map((item) => {
            const already = isAlreadyAttached(item)
            return (
              <button
                key={item.id}
                type="button"
                disabled={already}
                title={already ? `${item.label} (already on this segment)` : `Attach ${item.label}`}
                className={`relative h-12 w-full overflow-hidden rounded border border-border bg-black/40 ${
                  already
                    ? 'cursor-default ring-1 ring-primary/50'
                    : 'hover:ring-1 hover:ring-primary'
                }`}
                onClick={() => {
                  if (already) return
                  onAttachLibraryItem(item)
                  setMenuOpen(false)
                }}
              >
                <img
                  src={item.src}
                  alt={item.label}
                  className={`h-full w-full object-cover ${already ? 'opacity-70' : ''}`}
                />
                {already && (
                  <span className="absolute inset-x-0 bottom-0 bg-black/70 py-0.5 text-center text-[8px] text-white">
                    On segment
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div
      className="space-y-1 relative"
      onPaste={onPaste}
      onDragOver={(e) => {
        if (allowFileDrop(e.dataTransfer)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        const files = imageFilesFromDataTransfer(e.dataTransfer)
        if (files.length) onDropFiles(files)
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] uppercase tracking-wide text-muted">Attached</span>
        <button
          type="button"
          className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Plus size={10} /> Attach
        </button>
      </div>

      {menuOpen && (
        <div className="absolute right-0 bottom-full z-30 mb-1 w-64 rounded-md border border-border bg-card shadow-lg p-2 space-y-2">
          <button
            type="button"
            className="w-full rounded px-2 py-1.5 text-left text-[10px] hover:bg-muted/40"
            onClick={() => {
              setMenuOpen(false)
              onAttachFiles()
            }}
          >
            Upload from computer…
          </button>
          {library.length > 0 ? (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {renderLibraryGrid('Uploaded & refs', uploaded)}
              {renderLibraryGrid('Start frames', frames)}
            </div>
          ) : (
            <p className="px-1 text-[9px] text-muted">
              Upload once — the image is saved here for every segment.
            </p>
          )}
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-[9px] text-muted hover:bg-muted/40"
            onClick={() => setMenuOpen(false)}
          >
            Close
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-[9px] text-muted">{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <div key={item.id} className="relative">
              <button
                type="button"
                title={item.label}
                onClick={() => onOpen(item.id, item.src, item.label)}
                className="block h-12 w-12 overflow-hidden rounded border border-border bg-black/40 focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                <img src={item.src} alt={item.label} className="h-full w-full object-cover" />
              </button>
              {item.removable && onRemove && (
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                  title="Remove attachment from this segment"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onRemove(item.id)
                  }}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ColumnActions({
  onSidebar,
  onDownload,
  onRetry,
  canDownload,
  retryLabel,
  sidebarLabel,
  phase = 'idle'
}: {
  onSidebar?: () => void
  onDownload?: () => void
  onRetry: () => void
  canDownload: boolean
  retryLabel: string
  sidebarLabel: string
  phase?: SegmentGenerationPhase
}): React.JSX.Element {
  const busy = phase !== 'idle'
  const actionLabel =
    phase === 'generating' ? 'Generating…' : phase === 'waiting' ? 'Waiting' : retryLabel
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onSidebar && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
          onClick={onSidebar}
          title={sidebarLabel}
        >
          <PanelRightOpen size={11} /> Sidebar
        </button>
      )}
      {canDownload && onDownload && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
          onClick={onDownload}
          title="Download"
        >
          <Download size={11} /> Download
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline disabled:opacity-70 disabled:pointer-events-none"
        onClick={onRetry}
        title={busy ? actionLabel : `${retryLabel} with current prompt`}
      >
        {phase === 'generating' ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <RefreshCw size={11} />
        )}
        {actionLabel}
      </button>
    </div>
  )
}

export function PipelinePromptTab({
  projectId,
  pipeline,
  onEditSegment,
  onRetry,
  onDownloadImage,
  onDownloadVideo,
  onOpenInSidebar,
  onApproveSegment,
  onAttachSegmentImages,
  onAttachExistingMedia,
  onRemoveSegmentReference
}: {
  projectId: string
  pipeline: SegmentPipelineState
  onEditSegment: (segmentId: string, patch: Partial<ScriptSegment>) => void
  onRetry: (segmentId: string, stage: 'image' | 'video' | 'full') => void
  onDownloadImage?: (segment: ScriptSegment) => void
  onDownloadVideo?: (segment: ScriptSegment) => void
  onOpenInSidebar?: (segmentId: string, media: 'image' | 'video') => void
  onApproveSegment?: (segmentId: string) => void
  onAttachSegmentImages: (segmentId: string, files: File[]) => void | Promise<void>
  onAttachExistingMedia: (
    segmentId: string,
    media: { localPath: string; name: string; existingRefId?: string }
  ) => void | Promise<void>
  onRemoveSegmentReference: (segmentId: string, referenceId: string) => void
}): React.JSX.Element {
  void projectId
  const sorted = sortSegments(pipeline.segments)
  const jobById = useHiggsfieldJobById()
  const [imagePreview, setImagePreview] = useState<{
    src: string
    title: string
  } | null>(null)
  const [videoPreview, setVideoPreview] = useState<ScriptSegment | null>(null)
  const [attachSegmentId, setAttachSegmentId] = useState<string | null>(null)
  /** Track retry clicks until segment status reflects the new job. */
  const [retryPending, setRetryPending] = useState<Record<string, 'image' | 'video'>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  const attachLibrary: Array<{
    id: string
    src: string
    label: string
    localPath: string
    existingRefId?: string
    kind: 'upload' | 'frame' | 'anchor'
  }> = []

  // Uploads + brief refs first so they stay reusable across segments.
  for (const ref of pipeline.scriptReferences ?? []) {
    if (!ref.localPath) continue
    if (attachLibrary.some((i) => i.localPath === ref.localPath)) continue
    attachLibrary.push({
      id: `ref-${ref.id}`,
      src: localMediaPathUrl(ref.localPath),
      label: ref.instruction.trim() || ref.name || 'Uploaded',
      localPath: ref.localPath,
      existingRefId: ref.id,
      kind: 'upload'
    })
  }

  for (const ch of pipeline.characters) {
    if (!ch.anchorImagePath) continue
    if (attachLibrary.some((i) => i.localPath === ch.anchorImagePath)) continue
    attachLibrary.push({
      id: `lib-anchor-${ch.id}`,
      src: localMediaPathUrl(ch.anchorImagePath),
      label: `${ch.name} anchor`,
      localPath: ch.anchorImagePath,
      kind: 'anchor'
    })
  }

  for (const seg of sorted) {
    const path = seg.pendingImageApproval?.localPath || seg.imageLocalPath
    if (!path) continue
    if (attachLibrary.some((i) => i.localPath === path)) continue
    attachLibrary.push({
      id: `frame-${seg.id}`,
      src: localMediaPathUrl(path),
      label: `Segment ${seg.index + 1} start frame`,
      localPath: path,
      kind: 'frame'
    })
  }

  const openAttachment = (_id: string, src: string, label: string): void => {
    setImagePreview({ src, title: label })
  }

  const handleFilesForSegment = (segmentId: string, files: FileList | File[] | null): void => {
    if (!files) return
    const list = Array.from(files).filter(isImageFile)
    if (list.length) void onAttachSegmentImages(segmentId, list)
  }

  const openFilePicker = (segmentId: string): void => {
    setAttachSegmentId(segmentId)
    queueMicrotask(() => fileInputRef.current?.click())
  }

  const handleRetry = (segmentId: string, stage: 'image' | 'video' | 'full'): void => {
    if (stage === 'image' || stage === 'video') {
      setRetryPending((prev) => ({ ...prev, [segmentId]: stage }))
    }
    try {
      onRetry(segmentId, stage)
    } catch {
      setRetryPending((prev) => {
        const next = { ...prev }
        delete next[segmentId]
        return next
      })
    }
  }

  // Drop optimistic spinner once pipeline reports running / finished / failed.
  useEffect(() => {
    setRetryPending((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [segmentId, stage] of Object.entries(prev)) {
        const segment = pipeline.segments.find((s) => s.id === segmentId)
        if (!segment) {
          delete next[segmentId]
          changed = true
          continue
        }
        const running =
          (stage === 'image' && segment.status === 'image_running') ||
          (stage === 'video' && segment.status === 'video_running')
        const settled =
          segment.status === 'failed' ||
          (stage === 'image' &&
            (segment.status === 'image_done' ||
              segment.status === 'image_pending_approval' ||
              segment.status === 'audio_match_done' ||
              segment.status === 'video_running' ||
              segment.status === 'video_done' ||
              segment.status === 'timeline_placed')) ||
          (stage === 'video' &&
            (segment.status === 'video_done' || segment.status === 'timeline_placed'))

        // Keep pending until running starts, then status drives the spinner.
        if (running || settled) {
          delete next[segmentId]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [pipeline.segments])

  // Safety: clear stuck optimistic spinner if status never flips.
  useEffect(() => {
    const ids = Object.keys(retryPending)
    if (ids.length === 0) return
    const timer = setTimeout(() => {
      setRetryPending((prev) => {
        const next = { ...prev }
        for (const id of ids) {
          const segment = pipeline.segments.find((s) => s.id === id)
          const stage = prev[id]
          if (!stage) continue
          const stillRunning =
            (stage === 'image' && segment?.status === 'image_running') ||
            (stage === 'video' && segment?.status === 'video_running')
          if (!stillRunning) delete next[id]
        }
        return next
      })
    }, 8000)
    return () => clearTimeout(timer)
  }, [retryPending, pipeline.segments])

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (attachSegmentId) handleFilesForSegment(attachSegmentId, e.target.files)
          e.target.value = ''
          setAttachSegmentId(null)
        }}
      />
      <p className="text-[10px] text-muted">
        Image and video side by side per segment. Edit prompts, attach refs, retry with the current
        text, or open in the sidebar composer.
      </p>

      {sorted.map((segment) => {
        const pending = segment.pendingImageApproval
        const imageSrc = pending?.localPath
          ? localMediaPathUrl(pending.localPath)
          : pending?.url
            ? pending.url
            : segment.imageLocalPath
              ? localMediaPathUrl(segment.imageLocalPath)
              : null
        const videoSrc = segment.videoLocalPath
          ? localMediaPathUrl(segment.videoLocalPath)
          : null

        const imageAttachments = segmentImageAttachments(pipeline, segment)

        const imageAttachItems = imageAttachments
          .filter((m) => m.localPath || m.previewUrl)
          .map((m) => ({
            id: m.id,
            src: m.localPath ? localMediaPathUrl(m.localPath) : (m.previewUrl ?? ''),
            label: m.name,
            // Anything linked to this segment can be removed (anchors, prev, script refs).
            removable: true
          }))

        const videoAttachItems: Array<{
          id: string
          src: string
          label: string
          removable?: boolean
        }> = []
        if (segment.imageLocalPath) {
          videoAttachItems.push({
            id: `start-${segment.id}`,
            src: localMediaPathUrl(segment.imageLocalPath),
            label: 'Start frame',
            removable: false
          })
        }
        for (const m of imageAttachments) {
          if (!m.localPath && !m.previewUrl) continue
          if (videoAttachItems.some((v) => v.id === m.id)) continue
          videoAttachItems.push({
            id: m.id,
            src: m.localPath ? localMediaPathUrl(m.localPath) : (m.previewUrl ?? ''),
            label: m.name,
            removable: true
          })
        }

        const durationLabel = segment.scriptMatch
          ? `${(segment.scriptMatch.durationMs / 1000).toFixed(2)}s`
          : '—'

        return (
          <div key={segment.id} className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-2 rounded-t-md border-b border-border bg-card/40 px-2 py-1.5">
              <span className="text-[11px] font-medium">Segment {segment.index + 1}</span>
              <StatusBadge segment={segment} jobById={jobById} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
              <div className="p-2 space-y-2 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold text-foreground">Image</span>
                  {pending && (
                    <span className="text-[9px] uppercase text-amber-500">Pending approval</span>
                  )}
                </div>

                <div className="flex gap-2">
                  {imageSrc ? (
                    <button
                      type="button"
                      className="relative shrink-0 h-24 w-20 overflow-hidden rounded border border-border bg-black/40 focus:outline-none focus:ring-1 focus:ring-primary/40"
                      title="Open image"
                      onClick={() =>
                        setImagePreview({
                          src: imageSrc,
                          title: `Segment ${segment.index + 1} image`
                        })
                      }
                    >
                      <img
                        src={imageSrc}
                        alt={`Segment ${segment.index + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ) : (
                    <div className="h-24 w-20 shrink-0 rounded border border-dashed border-border flex items-center justify-center text-[9px] text-muted">
                      No image
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <ColumnActions
                      onSidebar={
                        onOpenInSidebar
                          ? () => onOpenInSidebar(segment.id, 'image')
                          : undefined
                      }
                      onDownload={
                        onDownloadImage ? () => onDownloadImage(segment) : undefined
                      }
                      canDownload={Boolean(
                        segment.imageLocalPath || pending?.localPath || pending?.url
                      )}
                      onRetry={() => handleRetry(segment.id, 'image')}
                      retryLabel="Retry image"
                      sidebarLabel="Open image in sidebar"
                      phase={resolveSegmentImagePhase(
                        segment,
                        jobById,
                        retryPending[segment.id] === 'image'
                      )}
                    />
                    {pending && onApproveSegment && (
                      <button
                        type="button"
                        className="rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground"
                        onClick={() => onApproveSegment(segment.id)}
                      >
                        Approve & replace
                      </button>
                    )}
                  </div>
                </div>

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
                  rows={5}
                  spellCheck
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-[11px] leading-snug resize-y focus:outline-none focus:ring-1 focus:ring-primary/40"
                />

                <AttachmentStrip
                  items={imageAttachItems}
                  library={attachLibrary}
                  attachedPaths={
                    new Set(
                      imageAttachments
                        .map((m) => m.localPath)
                        .filter((p): p is string => Boolean(p))
                    )
                  }
                  onOpen={openAttachment}
                  onRemove={(id) => onRemoveSegmentReference(segment.id, id)}
                  onAttachFiles={() => openFilePicker(segment.id)}
                  onAttachLibraryItem={(item) =>
                    void onAttachExistingMedia(segment.id, {
                      localPath: item.localPath,
                      name: item.label,
                      existingRefId: item.existingRefId
                    })
                  }
                  onPaste={(e) => {
                    const sync = imageFilesFromClipboard(e.clipboardData)
                    if (sync.length) {
                      e.preventDefault()
                      handleFilesForSegment(segment.id, sync)
                      return
                    }
                    void imageFilesFromPasteEvent(e.clipboardData).then((images) => {
                      if (images.length) handleFilesForSegment(segment.id, images)
                    })
                  }}
                  onDropFiles={(files) => handleFilesForSegment(segment.id, files)}
                  emptyLabel="No refs — attach start frames, product/character images, or upload."
                />
              </div>

              <div className="p-2 space-y-2 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold text-foreground">Video</span>
                  <span className="text-[10px] text-muted">Duration: {durationLabel}</span>
                </div>

                <div className="flex gap-2">
                  {videoSrc ? (
                    <button
                      type="button"
                      className="relative shrink-0 h-24 w-20 overflow-hidden rounded border border-border bg-black/40 focus:outline-none focus:ring-1 focus:ring-primary/40 group"
                      title="Play video"
                      onClick={() => setVideoPreview(segment)}
                    >
                      <video
                        src={videoSrc}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover pointer-events-none"
                      />
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/40">
                        <span className="rounded-full bg-black/60 p-1.5 text-white">
                          <Play size={12} fill="currentColor" />
                        </span>
                      </span>
                    </button>
                  ) : (
                    <div className="h-24 w-20 shrink-0 rounded border border-dashed border-border flex items-center justify-center text-[9px] text-muted">
                      No video
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <ColumnActions
                      onSidebar={
                        onOpenInSidebar
                          ? () => onOpenInSidebar(segment.id, 'video')
                          : undefined
                      }
                      onDownload={
                        onDownloadVideo ? () => onDownloadVideo(segment) : undefined
                      }
                      canDownload={Boolean(segment.videoLocalPath)}
                      onRetry={() => handleRetry(segment.id, 'video')}
                      retryLabel="Retry video"
                      sidebarLabel="Open video in sidebar"
                      phase={resolveSegmentVideoPhase(
                        segment,
                        jobById,
                        retryPending[segment.id] === 'video'
                      )}
                    />
                  </div>
                </div>

                <label className="block text-[10px] font-medium text-foreground">
                  Video motion prompt
                </label>
                <textarea
                  value={segment.videoMotionPrompt ?? ''}
                  onChange={(e) =>
                    onEditSegment(segment.id, { videoMotionPrompt: e.target.value })
                  }
                  rows={5}
                  spellCheck
                  placeholder="Visible subject action + slow camera push-in…"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-[11px] leading-snug resize-y focus:outline-none focus:ring-1 focus:ring-primary/40"
                />

                <AttachmentStrip
                  items={videoAttachItems}
                  library={attachLibrary}
                  attachedPaths={
                    new Set(
                      [
                        segment.imageLocalPath,
                        ...imageAttachments.map((m) => m.localPath)
                      ].filter((p): p is string => Boolean(p))
                    )
                  }
                  onOpen={openAttachment}
                  onRemove={(id) => {
                    if (id.startsWith('start-')) return
                    onRemoveSegmentReference(segment.id, id)
                  }}
                  onAttachFiles={() => openFilePicker(segment.id)}
                  onAttachLibraryItem={(item) =>
                    void onAttachExistingMedia(segment.id, {
                      localPath: item.localPath,
                      name: item.label,
                      existingRefId: item.existingRefId
                    })
                  }
                  onPaste={(e) => {
                    const sync = imageFilesFromClipboard(e.clipboardData)
                    if (sync.length) {
                      e.preventDefault()
                      handleFilesForSegment(segment.id, sync)
                    }
                  }}
                  onDropFiles={(files) => handleFilesForSegment(segment.id, files)}
                  emptyLabel="Start frame appears after the image is ready. Attach extra refs if needed."
                />
                {!segment.imageLocalPath && (
                  <p className="text-[9px] text-muted inline-flex items-center gap-1">
                    <ImagePlus size={10} /> Generate the segment image first for a start frame.
                  </p>
                )}
                {previousSegmentImagePath(pipeline, segment) && segment.continuityFromPrevious && (
                  <p className="text-[9px] text-muted">Uses previous scene for continuity.</p>
                )}
              </div>
            </div>

            {segment.error && (
              <p className="border-t border-border px-2 py-1 text-[9px] text-red-400">
                {segment.error}
              </p>
            )}
          </div>
        )
      })}

      {imagePreview && (
        <ZoomableImageLightbox
          src={imagePreview.src}
          title={imagePreview.title}
          onClose={() => setImagePreview(null)}
        />
      )}

      {videoPreview?.videoLocalPath && (
        <MediaLightbox
          onClose={() => setVideoPreview(null)}
          ariaLabel={`Segment ${videoPreview.index + 1} video`}
          mediaSrc={localMediaPathUrl(videoPreview.videoLocalPath)}
          isVideo
        >
          <video
            key={videoPreview.id}
            src={localMediaPathUrl(videoPreview.videoLocalPath)}
            controls
            autoPlay
            playsInline
            className="max-h-[78vh] max-w-[96vw] rounded-lg bg-black shadow-2xl"
          />
          <p className="text-xs text-white/80">Segment {videoPreview.index + 1}</p>
        </MediaLightbox>
      )}
    </div>
  )
}
