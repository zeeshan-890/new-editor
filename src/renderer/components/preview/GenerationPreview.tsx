import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Clock,
  Loader2,
  Sparkles,
  X,
  ZoomIn
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useHiggsfieldStore } from '@renderer/stores/higgsfieldStore'
import { HIGGSFIELD_DRAG_MIME } from '@shared/types'
import type { HiggsfieldGenerationJob, HiggsfieldVisualGeneration } from '@shared/types'

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url)
}

function jobPreviewUrl(job: HiggsfieldGenerationJob): string | undefined {
  if (job.resultUrls[0]) return job.resultUrls[0]
  if (job.references[0]?.url) return job.references[0].url
  return undefined
}

function toLightboxItem(job: HiggsfieldGenerationJob): HiggsfieldVisualGeneration | null {
  const url = jobPreviewUrl(job)
  if (!url || job.status !== 'completed') return null
  return {
    id: job.id,
    historyId: job.id,
    model: job.model,
    prompt: job.prompt,
    createdAt: job.createdAt,
    url,
    mediaType: job.category === 'video' || isVideoUrl(url) ? 'video' : 'image'
  }
}

function MediaLightbox({
  item,
  onClose
}: {
  item: HiggsfieldVisualGeneration
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/92 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Generated media preview"
    >
      <div
        className="flex max-w-[96vw] max-h-[92vh] flex-col items-center gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative inline-flex max-w-[96vw] max-h-[82vh]">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-2 right-2 z-10 rounded-lg border border-white/15 bg-black/55 p-1.5 text-white/85 shadow-lg backdrop-blur-sm hover:bg-black/70 hover:text-white transition-colors"
            aria-label="Close preview"
          >
            <X size={18} />
          </button>
          {item.mediaType === 'video' ? (
            <video
              src={item.url}
              controls
              autoPlay
              className="max-h-[82vh] max-w-[96vw] rounded-lg shadow-2xl"
            />
          ) : (
            <img
              src={item.url}
              alt={item.prompt}
              className="max-h-[82vh] max-w-[96vw] rounded-lg object-contain shadow-2xl"
            />
          )}
        </div>
        <div className="max-w-2xl text-center text-sm text-white/80">
          <p className="font-medium text-white">{item.model}</p>
          <p className="mt-1 text-white/70">{item.prompt}</p>
        </div>
      </div>
    </div>
  )
}

function JobTile({
  job,
  selected,
  onSelect,
  onOpenLightbox
}: {
  job: HiggsfieldGenerationJob
  selected: boolean
  onSelect: () => void
  onOpenLightbox: () => void
}): React.JSX.Element {
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewUrl = jobPreviewUrl(job)
  const isVideo = job.category === 'video' || (previewUrl ? isVideoUrl(previewUrl) : false)

  const onDragStart = (event: React.DragEvent): void => {
    if (job.status !== 'completed' || !previewUrl) {
      event.preventDefault()
      return
    }
    event.dataTransfer.setData(
      HIGGSFIELD_DRAG_MIME,
      JSON.stringify({
        type: 'higgsfield-image',
        url: previewUrl,
        localPath: job.localPath,
        jobId: job.id,
        label: 'result'
      })
    )
    event.dataTransfer.effectAllowed = 'copy'
  }

  const handleClick = (): void => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      onSelect()
      clickTimer.current = null
    }, 220)
  }

  const handleDoubleClick = (): void => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
    }
    if (job.status === 'completed') onOpenLightbox()
  }

  return (
    <div
      draggable={job.status === 'completed' && Boolean(previewUrl)}
      onDragStart={onDragStart}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={cn(
        'group relative aspect-square overflow-hidden rounded-lg border bg-card text-left transition-all cursor-pointer',
        selected ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/50',
        job.status === 'failed' && 'border-destructive/50',
        job.status === 'queued' && 'opacity-70'
      )}
    >
      {job.status === 'completed' && previewUrl ? (
        isVideo ? (
          <video src={previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <img src={previewUrl} alt={job.prompt} loading="lazy" className="h-full w-full object-cover" />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-background/80">
          {job.status === 'queued' && <Clock size={22} className="text-muted" />}
          {job.status === 'running' && <Loader2 size={24} className="animate-spin text-primary" />}
          {job.status === 'failed' && <AlertCircle size={22} className="text-destructive" />}
          {job.status === 'cancelled' && <X size={22} className="text-muted" />}
        </div>
      )}

      {(job.status === 'running' || job.status === 'queued') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 p-2 text-center">
          {job.status === 'running' && <Loader2 size={20} className="animate-spin text-primary mb-1" />}
          <span className="text-[10px] text-white/90 line-clamp-3">
            {job.progressMessage ?? (job.status === 'queued' ? 'Queued…' : 'Generating…')}
          </span>
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent opacity-80 transition-opacity group-hover:opacity-100" />

      <div className="absolute inset-x-0 bottom-0 p-2.5">
        <p className="text-[11px] font-medium text-white line-clamp-2">{job.prompt.trim() || 'Reference only'}</p>
        <p className="mt-0.5 text-[10px] text-white/70 truncate">{job.model}</p>
      </div>

      {job.status === 'completed' && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onOpenLightbox()
          }}
          className="absolute top-2 right-2 rounded-full bg-black/50 p-1.5 text-white/90 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Open large preview"
        >
          <ZoomIn size={14} />
        </button>
      )}

      {job.references.length > 0 && (
        <div className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          {job.references.length} ref
        </div>
      )}

      {job.status === 'failed' && job.error && (
        <div className="absolute inset-x-1 bottom-12 rounded bg-destructive/90 px-1 py-0.5 text-[9px] text-white line-clamp-2">
          {job.error}
        </div>
      )}
    </div>
  )
}

export function GenerationPreview({ className }: { className?: string }): React.JSX.Element | null {
  const jobs = useHiggsfieldStore((s) => s.jobs)
  const queueStats = useHiggsfieldStore((s) => s.queueStats)
  const selectedJobId = useHiggsfieldStore((s) => s.selectedJobId)
  const loadJobIntoComposer = useHiggsfieldStore((s) => s.loadJobIntoComposer)
  const selectJob = useHiggsfieldStore((s) => s.selectJob)
  const syncJobs = useHiggsfieldStore((s) => s.syncJobs)
  const [lightboxItem, setLightboxItem] = useState<HiggsfieldVisualGeneration | null>(null)

  useEffect(() => {
    void syncJobs()
  }, [syncJobs])

  const visualJobs = useMemo(
    () => jobs.filter((job) => job.category === 'image' || job.category === 'video'),
    [jobs]
  )

  if (visualJobs.length === 0) return null

  return (
    <>
      <section
        className={cn(
          'flex min-h-0 flex-col border-b border-border bg-background/40',
          className
        )}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/60 shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles size={14} className="text-primary" />
            <span>Generated preview</span>
            <span className="text-xs font-normal text-muted">({visualJobs.length})</span>
          </div>
          <span className="text-[10px] text-muted">
            Running {queueStats.running} · Queued {queueStats.queued}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 auto-rows-fr">
            {visualJobs.map((job) => (
              <JobTile
                key={job.id}
                job={job}
                selected={selectedJobId === job.id}
                onSelect={() => {
                  selectJob(job.id)
                  loadJobIntoComposer(job.id)
                }}
                onOpenLightbox={() => {
                  const item = toLightboxItem(job)
                  if (item) setLightboxItem(item)
                }}
              />
            ))}
          </div>
        </div>

        <p className="px-4 pb-2 text-[10px] text-muted shrink-0">
          Click to load into composer · Double-click or zoom for large view · Drag to attach
        </p>
      </section>

      {lightboxItem && (
        <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      )}
    </>
  )
}
