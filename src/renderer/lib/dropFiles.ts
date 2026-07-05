const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg|heic|heif|avif)$/i
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v)$/i
const AUDIO_EXT = /\.(wav|mp3|flac|m4a|ogg|aac)$/i

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return IMAGE_EXT.test(file.name)
}

export function filePathFromDrop(file: File): string | null {
  const fromApi = window.electronAPI?.getPathForFile(file)
  if (fromApi) return fromApi
  const legacy = (file as File & { path?: string }).path
  return legacy ?? null
}

export function filesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  const fromList = Array.from(dataTransfer.files)
  if (fromList.length > 0) return fromList

  const fromItems: File[] = []
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) fromItems.push(file)
  }
  return fromItems
}

export function isMediaFile(file: File): boolean {
  if (file.type.startsWith('video/') || file.type.startsWith('image/') || file.type.startsWith('audio/')) {
    return true
  }
  const name = file.name.toLowerCase()
  return VIDEO_EXT.test(name) || IMAGE_EXT.test(name) || AUDIO_EXT.test(name)
}

export function imageFilesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  return filesFromDataTransfer(dataTransfer).filter(isImageFile)
}

export function mediaFilesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  return filesFromDataTransfer(dataTransfer).filter(isMediaFile)
}

export function allowFileDrop(event: DragEvent | React.DragEvent): void {
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}
