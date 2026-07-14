import { useRef, useState } from 'react'
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
import { STATUS_LABELS, isRunningStatus, sortSegments, statusClass } from './pipelineSegmentUi'

function StatusBadge({ segment }: { segment: ScriptSegment }): React.JSX.Element {
  return (
    <span className={`inline-flex items-center gap-1 ${statusClass(segment.status)}`}>
      {isRunningStatus(segment.status) && <Loader2 size={10} className="animate-spin shrink-0" />}
      {STATUS_LABELS[segment.status] ?? segment.status}
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
  onOpen,
  onRemove,
  onAttachClick,
  onPaste,
  onDropFiles,
  emptyLabel
}: {
  items: Array<{ id: string; src: string; label: string; removable?: boolean }>
  onOpen: (id: string, src: string, label: string) => void
  onRemove?: (id: string) => void
  onAttachClick: () => void
  onPaste: (e: React.ClipboardEvent) => void
  onDropFiles: (files: File[]) => void
  emptyLabel: string
}): React.JSX.Element {
  return (
    <div
      className="space-y-1"
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
          onClick={onAttachClick}
        >
          <Plus size={10} /> Attach
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-[9px] text-muted">{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <div key={item.id} className="relative group">
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
                  className="absolute -top-1 -right-1 rounded-full bg-black/70 p-0.5 text-white opacity-0 group-hover:opacity-100"
                  title="Remove from segment"
                  onClick={() => onRemove(item.id)}
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
  sidebarLabel
}: {
  onSidebar?: () => void
  onDownload?: () => void
  onRetry: () => void
  canDownload: boolean
  retryLabel: string
  sidebarLabel: string
}): React.JSX.Element {
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
        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
        onClick={onRetry}
        title={`${retryLabel} with current prompt`}
      >
        <RefreshCw size={11} /> {retryLabel}
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
  onRemoveSegmentReference: (segmentId: string, referenceId: string) => void
}): React.JSX.Element {
  void projectId
  const sorted = sortSegments(pipeline.segments)
  const [imagePreview, setImagePreview] = useState<{
    src: string
    title: string
  } | null>(null)
  const [videoPreview, setVideoPreview] = useState<ScriptSegment | null>(null)
  const [attachSegmentId, setAttachSegmentId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
            removable: Boolean(segment.scriptReferenceIds?.includes(m.id))
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
          if (m.id.startsWith('anchor-') || m.id === 'prev-segment') continue
          if (videoAttachItems.some((v) => v.id === m.id)) continue
          videoAttachItems.push({
            id: m.id,
            src: m.localPath ? localMediaPathUrl(m.localPath) : (m.previewUrl ?? ''),
            label: m.name,
            removable: Boolean(segment.scriptReferenceIds?.includes(m.id))
          })
        }

        const durationLabel = segment.scriptMatch
          ? `${(segment.scriptMatch.durationMs / 1000).toFixed(2)}s`
          : '—'

        return (
          <div key={segment.id} className="rounded-md border border-border overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-card/40 px-2 py-1.5">
              <span className="text-[11px] font-medium">Segment {segment.index + 1}</span>
              <StatusBadge segment={segment} />
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
                      onRetry={() => onRetry(segment.id, 'image')}
                      retryLabel="Retry image"
                      sidebarLabel="Open image in sidebar"
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
                  onOpen={openAttachment}
                  onRemove={(id) => onRemoveSegmentReference(segment.id, id)}
                  onAttachClick={() => openFilePicker(segment.id)}
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
                  emptyLabel="No refs — attach product/character images for this shot."
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
                      onRetry={() => onRetry(segment.id, 'video')}
                      retryLabel="Retry video"
                      sidebarLabel="Open video in sidebar"
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
                  onOpen={openAttachment}
                  onRemove={(id) => {
                    if (id.startsWith('start-')) return
                    onRemoveSegmentReference(segment.id, id)
                  }}
                  onAttachClick={() => openFilePicker(segment.id)}
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
