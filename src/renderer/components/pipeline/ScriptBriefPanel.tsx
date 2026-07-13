import { useRef } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { Label } from '../common/Label'
import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'
import {
  allowFileDrop,
  filePathFromDrop,
  imageFilesFromClipboard,
  imageFilesFromPasteEvent,
  imageFilesFromDataTransfer,
  isImageFile
} from '@renderer/lib/dropFiles'
import { generateId } from '@shared/types'
import type { PipelineScriptReference } from '@shared/segmentPipeline'

export function ScriptBriefPanel({
  projectId,
  creativeInstructions,
  scriptReferences,
  onCreativeInstructionsChange,
  onReferencesChange
}: {
  projectId: string
  creativeInstructions: string
  scriptReferences: PipelineScriptReference[]
  onCreativeInstructionsChange: (value: string) => void
  onReferencesChange: (references: PipelineScriptReference[]) => void
}): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addReferenceFromPath = async (sourcePath: string): Promise<void> => {
    if (!window.electronAPI?.importProjectMedia) return
    const imported = await window.electronAPI.importProjectMedia(projectId, sourcePath)
    const next: PipelineScriptReference = {
      id: generateId(),
      localPath: imported.localPath,
      name: imported.name,
      instruction: ''
    }
    onReferencesChange([...scriptReferences, next])
  }

  const addReferenceFromFile = async (file: File): Promise<void> => {
    if (!isImageFile(file)) return

    const path = filePathFromDrop(file)
    if (path) {
      await addReferenceFromPath(path)
      return
    }

    if (!window.electronAPI?.importProjectMediaBytes) return
    const imported = await window.electronAPI.importProjectMediaBytes(
      projectId,
      file.name || 'pasted-image.png',
      await file.arrayBuffer()
    )
    const next: PipelineScriptReference = {
      id: generateId(),
      localPath: imported.localPath,
      name: imported.name,
      instruction: ''
    }
    onReferencesChange([...scriptReferences, next])
  }

  const addReferencesFromFiles = async (files: File[]): Promise<void> => {
    for (const file of files) {
      await addReferenceFromFile(file)
    }
  }

  const updateReference = (id: string, patch: Partial<PipelineScriptReference>): void => {
    onReferencesChange(
      scriptReferences.map((ref) => (ref.id === id ? { ...ref, ...patch } : ref))
    )
  }

  const removeReference = (id: string): void => {
    onReferencesChange(scriptReferences.filter((ref) => ref.id !== id))
  }

  const handlePaste = (e: React.ClipboardEvent): void => {
    const syncImages = imageFilesFromClipboard(e.clipboardData)
    if (syncImages.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      void addReferencesFromFiles(syncImages)
      return
    }

    if (e.clipboardData.getData('text/plain')) return

    void (async () => {
      const images = await imageFilesFromPasteEvent(e.clipboardData)
      if (images.length === 0) return
      await addReferencesFromFiles(images)
    })()
  }

  const handleDrop = (e: React.DragEvent): void => {
    allowFileDrop(e)
    const files = imageFilesFromDataTransfer(e.dataTransfer)
    if (files.length === 0) return
    void addReferencesFromFiles(files)
  }

  return (
    <div className="space-y-3" onPaste={handlePaste}>
      <div className="space-y-1">
        <Label>Creative instructions</Label>
        <p className="text-[10px] text-muted">
          Style, tone, or direction separate from the narration script (optional).
        </p>
        <textarea
          value={creativeInstructions}
          onChange={(e) => onCreativeInstructionsChange(e.target.value)}
          onPaste={handlePaste}
          rows={3}
          placeholder="e.g. Warm documentary tone, muted colors, product shots should match brand packaging…"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div
        className="space-y-1"
        onDragOver={allowFileDrop}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        <Label>Reference images</Label>
        <p className="text-[10px] text-muted">
          Attach images and describe how each should be used. Paste a screenshot (Ctrl+V), drop a
          file, or browse. Analysis will assign them to relevant segments.
        </p>

        {scriptReferences.length > 0 && (
          <div className="space-y-2">
            {scriptReferences.map((ref) => (
              <div
                key={ref.id}
                className="flex gap-2 rounded-md border border-border bg-card/50 p-2"
              >
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded border border-border bg-black/20">
                  <img
                    src={localMediaPathUrl(ref.localPath)}
                    alt={ref.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-[10px] font-medium truncate" title={ref.name}>
                    {ref.name}
                  </p>
                  <textarea
                    value={ref.instruction}
                    onChange={(e) => updateReference(ref.id, { instruction: e.target.value })}
                    rows={2}
                    placeholder="What should this image be used for? e.g. Main character likeness, product logo on packaging…"
                    className="w-full rounded border border-border bg-background px-2 py-1 text-[10px] resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <button
                  type="button"
                  className="self-start rounded p-1 text-muted hover:bg-muted/40 hover:text-foreground"
                  onClick={() => removeReference(ref.id)}
                  aria-label={`Remove ${ref.name}`}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length > 0) void addReferencesFromFiles(files)
          }}
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1.5 text-[10px] text-muted hover:border-primary hover:text-primary"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus size={14} />
            Add image
          </button>
          <button
            type="button"
            className="text-[10px] text-primary hover:underline"
            onClick={async () => {
              const path = await window.electronAPI?.openImageFile()
              if (path) await addReferenceFromPath(path)
            }}
          >
            Browse files…
          </button>
          <span className="self-center text-[10px] text-muted">or paste screenshot (Ctrl+V)</span>
        </div>
      </div>
    </div>
  )
}
