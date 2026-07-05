import { existsSync } from 'fs'
import { promises as fs } from 'fs'
import { join } from 'path'
import type {
  GenerationModeDraft,
  HiggsfieldReferenceImage,
  ProjectGeneration,
  ProjectMedia
} from '../../shared/types'
import { generationToModeDraft } from '../../shared/imageGeneration'
import { downloadMedia } from '../higgsfield/cli'
import { importMediaToProject, mediaDir } from './store'

export { mediaDir }

async function removeTempFile(path: string): Promise<void> {
  await fs.unlink(path).catch(() => {})
}

function isInProjectMedia(projectId: string, filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  const root = mediaDir(projectId).replace(/\\/g, '/')
  return normalized.startsWith(root)
}

function isHttpUrl(url: string | undefined): url is string {
  return Boolean(url && /^https?:\/\//i.test(url))
}

function normalizeMediaPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

export async function ensureAttachmentInProject(
  projectId: string,
  media: ProjectMedia
): Promise<ProjectMedia> {
  if (media.localPath && existsSync(media.localPath) && isInProjectMedia(projectId, media.localPath)) {
    return { ...media }
  }

  if (media.localPath && existsSync(media.localPath)) {
    const imported = await importMediaToProject(projectId, media.localPath)
    return {
      ...media,
      localPath: imported.localPath,
      name: imported.name || media.name
    }
  }

  if (isHttpUrl(media.previewUrl)) {
    const temp = await downloadMedia(media.previewUrl)
    try {
      const imported = await importMediaToProject(projectId, temp)
      return {
        ...media,
        localPath: imported.localPath,
        name: imported.name || media.name,
        previewUrl: media.previewUrl
      }
    } finally {
      await removeTempFile(temp)
    }
  }

  throw new Error(`Could not restore attachment "${media.name}". Re-attach the image and try again.`)
}

export async function ensureReferencesInProject(
  projectId: string,
  refs: HiggsfieldReferenceImage[]
): Promise<HiggsfieldReferenceImage[]> {
  const resolved: HiggsfieldReferenceImage[] = []
  const seenPaths = new Set<string>()

  for (const ref of refs) {
    const normalizedPath = ref.localPath ? normalizeMediaPath(ref.localPath) : ''
    const pathAlreadyUsed = normalizedPath !== '' && seenPaths.has(normalizedPath)
    const remoteUrl = isHttpUrl(ref.url) ? ref.url : undefined

    const media = await ensureAttachmentInProject(
      projectId,
      pathAlreadyUsed && remoteUrl
        ? {
            id: ref.id,
            localPath: '',
            name: ref.label ?? 'reference',
            previewUrl: remoteUrl
          }
        : {
            id: ref.id,
            localPath: ref.localPath ?? '',
            name: ref.label ?? 'reference',
            previewUrl: ref.url
          }
    )

    if (media.localPath) {
      seenPaths.add(normalizeMediaPath(media.localPath))
    }

    resolved.push({
      ...ref,
      localPath: media.localPath,
      url: media.previewUrl ?? ref.url,
      label: media.name
    })
  }
  return resolved
}

export async function hydrateGenerationDraft(
  projectId: string,
  generation: ProjectGeneration
): Promise<GenerationModeDraft> {
  const draft = generationToModeDraft(generation)

  if (generation.type === 'image' && draft.imageAttachments.length > 0) {
    const hydrated: ProjectMedia[] = []
    for (const attachment of draft.imageAttachments) {
      hydrated.push(await ensureAttachmentInProject(projectId, attachment))
    }
    draft.imageAttachments = hydrated
  }

  if (generation.type === 'video' && draft.videoStartFrame) {
    draft.videoStartFrame = await ensureAttachmentInProject(projectId, draft.videoStartFrame)
  }

  return draft
}
