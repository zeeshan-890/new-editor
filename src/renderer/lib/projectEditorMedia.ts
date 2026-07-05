import type { MediaAsset, ProjectGeneration } from '@shared/types'
import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'
import { useProjectTabStore } from '@renderer/stores/projectTabStore'
import { useVideoEditorStore } from '@renderer/stores/videoEditorStore'

export async function ensureGenerationLocalPath(
  projectId: string,
  generation: ProjectGeneration
): Promise<string> {
  if (!window.electronAPI?.ensureGenerationMedia) {
    throw new Error('Generation import is unavailable.')
  }

  const imported = await window.electronAPI.ensureGenerationMedia(projectId, generation)
  if (generation.localPath !== imported.localPath) {
    useProjectTabStore.getState().updateProjectGenerationLocalPath(
      projectId,
      generation.id,
      imported.localPath
    )
  }
  return imported.localPath
}

export async function importGenerationIntoEditor(
  projectId: string,
  generation: ProjectGeneration,
  options: { addToTimeline?: boolean } = {}
): Promise<MediaAsset> {
  const { addToTimeline = true } = options
  const localPath = await ensureGenerationLocalPath(projectId, generation)

  if (!window.electronAPI?.probeMediaFile) {
    throw new Error('Media probe is unavailable.')
  }

  const meta = await window.electronAPI.probeMediaFile(localPath)
  const store = useVideoEditorStore.getState()
  const existing = store.project.assets.find((a) => a.path === meta.path)
  const asset = existing ?? store.addAsset(meta)

  if (addToTimeline) {
    let layerId: string | undefined
    if (meta.type === 'audio') {
      if (!store.project.layers.some((l) => l.type === 'audio')) {
        store.addLayer('audio')
      }
      layerId = useVideoEditorStore.getState().project.layers.find((l) => l.type === 'audio')?.id
    } else if (meta.type === 'image') {
      if (!store.project.layers.some((l) => l.type === 'overlay')) {
        store.addLayer('overlay')
      }
      layerId = useVideoEditorStore.getState().project.layers.find((l) => l.type === 'overlay')?.id
    }
    store.addClipToLayer(asset.id, layerId)
  }

  return asset
}

export function isVideoGeneration(item: ProjectGeneration): boolean {
  return item.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(item.url)
}

/** Prefer a local file URL — Chromium often can't decode remote AI video codecs. */
export function generationVideoSrc(item: ProjectGeneration): string {
  if (item.localPath) return localMediaPathUrl(item.localPath)
  return item.url
}

/** Only local copies are reliably decodable in Electron's `<video>` on Windows. */
export function canPreviewVideoInBrowser(item: ProjectGeneration): boolean {
  return Boolean(item.localPath)
}
