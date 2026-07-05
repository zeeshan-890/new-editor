import { HIGGSFIELD_DRAG_MIME } from '@shared/types'
import type { ProjectGeneration } from '@shared/types'

export interface GalleryDragPayload {
  type: 'higgsfield-image' | 'higgsfield-video'
  url?: string
  localPath?: string
  jobId?: string
  label?: string
}

export function parseGalleryDragPayload(data: string): GalleryDragPayload | null {
  if (!data) return null
  try {
    const parsed = JSON.parse(data) as GalleryDragPayload
    if (parsed?.type === 'higgsfield-image' || parsed?.type === 'higgsfield-video') return parsed
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
  const isVideo = item.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(item.url)
  dataTransfer.setData(
    HIGGSFIELD_DRAG_MIME,
    JSON.stringify({
      type: isVideo ? 'higgsfield-video' : 'higgsfield-image',
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
