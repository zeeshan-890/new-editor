import { useRef } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'
import { useHiggsfieldStore } from '@renderer/stores/higgsfieldStore'
import { HIGGSFIELD_DRAG_MIME, generateId } from '@shared/types'
import type { HiggsfieldReferenceImage } from '@shared/types'

const MAX_REFERENCES = 14

export interface HiggsfieldDragPayload {
  type: 'higgsfield-image'
  url?: string
  localPath?: string
  jobId?: string
  label?: string
}

export function parseDragPayload(data: string): HiggsfieldDragPayload | null {
  try {
    const parsed = JSON.parse(data) as HiggsfieldDragPayload
    if (parsed?.type === 'higgsfield-image') return parsed
  } catch {
    // ignore
  }
  return null
}

export function PromptAttachmentZone(): React.JSX.Element {
  const composer = useHiggsfieldStore((s) => s.composer)
  const sourceJobId = composer.sourceJobId
  const attachReference = useHiggsfieldStore((s) => s.attachReference)
  const removeReference = useHiggsfieldStore((s) => s.removeReference)
  const resolveAndAttach = useHiggsfieldStore((s) => s.resolveAndAttach)
  const clearComposer = useHiggsfieldStore((s) => s.clearComposer)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()

    const payload = parseDragPayload(event.dataTransfer.getData(HIGGSFIELD_DRAG_MIME))
    if (payload) {
      void resolveAndAttach(
        payload.url ?? '',
        payload.localPath,
        payload.label ?? 'reference'
      )
      return
    }

    const file = event.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      const path = window.electronAPI?.getPathForFile(file)
      if (path) {
        attachReference({
          id: generateId(),
          localPath: path,
          url: URL.createObjectURL(file),
          label: 'upload'
        })
      }
    }
  }

  const onFilePick = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    if (!file) return
    const path = window.electronAPI?.getPathForFile(file)
    if (path) {
      attachReference({
        id: generateId(),
        localPath: path,
        url: URL.createObjectURL(file),
        label: 'upload'
      })
    }
    event.target.value = ''
  }

  return (
    <div className="space-y-2">
      {sourceJobId && (
        <div className="flex items-center justify-between gap-2 rounded border border-primary/30 bg-primary/5 px-2 py-1.5 text-[10px]">
          <span className="text-primary">Editing from a previous generation</span>
          <button type="button" className="text-muted hover:text-foreground underline" onClick={clearComposer}>
            Clear
          </button>
        </div>
      )}

      <div
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={onDrop}
        className={cn(
          'rounded-md border border-dashed border-border bg-card/50 p-2 transition-colors',
          'hover:border-primary/40'
        )}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[10px] text-muted uppercase tracking-wide">Reference images</span>
          <span className="text-[10px] text-muted">
            {composer.references.length}/{MAX_REFERENCES}
          </span>
        </div>

        {composer.references.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-4 text-center text-[11px] text-muted">
            <ImagePlus size={18} className="text-primary/70" />
            <p>Drag images from the preview grid here</p>
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => fileInputRef.current?.click()}
            >
              or choose a file
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {composer.references.map((ref) => (
              <ReferenceChip key={ref.id} reference={ref} onRemove={() => removeReference(ref.id)} />
            ))}
            {composer.references.length < MAX_REFERENCES && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-border text-muted hover:border-primary/50 hover:text-primary"
                aria-label="Add reference image"
              >
                <ImagePlus size={16} />
              </button>
            )}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFilePick}
      />
    </div>
  )
}

function ReferenceChip({
  reference,
  onRemove
}: {
  reference: HiggsfieldReferenceImage
  onRemove: () => void
}): React.JSX.Element {
  const src = reference.url ?? (reference.localPath ? localMediaPathUrl(reference.localPath) : '')

  return (
    <div className="group relative h-14 w-14 overflow-hidden rounded border border-border bg-background">
      {src ? (
        <img src={src} alt={reference.label ?? 'reference'} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[9px] text-muted">ref</div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 rounded-full bg-black/70 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Remove reference"
      >
        <X size={10} />
      </button>
    </div>
  )
}
