import { HIGGSFIELD_DRAG_MIME } from '@shared/types'
import type { ProjectGeneration } from '@shared/types'

export interface GalleryDragPayload {
  type: 'higgsfield-image'
  url?: string
  localPath?: string
  jobId?: string
  label?: string
}

export function parseGalleryDragPayload(data: string): GalleryDragPayload | null {
  if (!data) return null
  try {
    const parsed = JSON.parse(data) as GalleryDragPayload
    if (parsed?.type === 'higgsfield-image') return parsed
  } catch {
    // ignore
  }
  return null
}

export function galleryDragPayloadFromDataTransfer(
  dataTransfer: DataTransfer
): GalleryDragPayload | null {
  return parseGalleryDragPayload(dataTransfer.getData(HIGGSFIELD_DRAG_MIME))
}

export function setGalleryDragData(dataTransfer: DataTransfer, item: ProjectGeneration): void {
  dataTransfer.setData(
    HIGGSFIELD_DRAG_MIME,
    JSON.stringify({
      type: 'higgsfield-image',
      url: item.url,
      localPath: item.localPath,
      jobId: item.id,
      label: 'generation'
    } satisfies GalleryDragPayload)
  )
  if (item.url) {
    dataTransfer.setData('text/uri-list', item.url)
    dataTransfer.setData('text/plain', item.url)
  }
  dataTransfer.effectAllowed = 'copy'
}
