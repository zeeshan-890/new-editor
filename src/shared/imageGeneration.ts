import type {
  GenerationComposerSnapshot,
  GenerationMode,
  GenerationModeDraft,
  HiggsfieldEnqueueRequest,
  HiggsfieldReferenceImage,
  ProjectGeneration,
  ProjectMedia,
  TabComposerState
} from './types'
import { activeModeDraft } from './types'

export function buildEffectivePrompt(
  prompt: string,
  context: string,
  useContext: boolean
): string {
  const trimmed = prompt.trim()
  const ctx = context.trim()
  if (!useContext || !ctx) return trimmed
  if (!trimmed) return ctx
  return `${ctx}\n\n${trimmed}`
}

export function attachmentDisplayName(media: ProjectMedia, index: number): string {
  const raw = media.name?.replace(/\.[^.]+$/i, '').trim()
  if (raw && !/^\d{10,}-/.test(raw)) return raw
  return `Image ${index + 1}`
}

export function cloneProjectMedia(media: ProjectMedia): ProjectMedia {
  return {
    id: media.id,
    localPath: media.localPath,
    name: media.name,
    previewUrl: media.previewUrl
  }
}

export function cloneProjectMediaList(media: ProjectMedia[]): ProjectMedia[] {
  return media.map(cloneProjectMedia)
}

export function draftToReferences(draft: GenerationModeDraft): HiggsfieldReferenceImage[] {
  return draft.imageAttachments.map((media) => ({
    id: media.id,
    localPath: media.localPath,
    url: media.previewUrl,
    label: media.name
  }))
}

export function buildComposerSnapshot(
  mode: GenerationMode,
  draft: GenerationModeDraft
): GenerationComposerSnapshot {
  return {
    type: mode,
    context: draft.context,
    useContextInPrompt: draft.useContextInPrompt,
    prompt: draft.prompt,
    model: draft.model,
    imageAttachments: cloneProjectMediaList(draft.imageAttachments),
    videoStartFrame: draft.videoStartFrame ? cloneProjectMedia(draft.videoStartFrame) : null,
    videoDuration: draft.videoDuration
  }
}

export interface ImageGenerationBuildInput {
  tabState: TabComposerState
  workspaceId?: string
  projectId: string
}

export interface ImageGenerationBuildResult {
  enqueue: HiggsfieldEnqueueRequest
  snapshot: GenerationComposerSnapshot
  effectivePrompt: string
  referenceCount: number
}

export function buildImageGenerationRequest(
  input: ImageGenerationBuildInput
): ImageGenerationBuildResult {
  const mode = input.tabState.activeMode
  const draft = activeModeDraft(input.tabState)
  const references = mode === 'image' ? draftToReferences(draft) : []
  const effectivePrompt = buildEffectivePrompt(
    draft.prompt,
    draft.context,
    draft.useContextInPrompt
  )

  const enqueue: HiggsfieldEnqueueRequest = {
    model: draft.model,
    prompt: effectivePrompt || ' ',
    workspaceId: input.workspaceId,
    category: mode,
    references,
    projectId: input.projectId,
    params: mode === 'video' ? { duration: String(draft.videoDuration) } : {},
    mediaPath: mode === 'video' ? draft.videoStartFrame?.localPath : undefined,
    mediaFlag: mode === 'video' && draft.videoStartFrame ? 'start-image' : undefined,
    wait: true,
    importAudio: false
  }

  return {
    enqueue,
    snapshot: buildComposerSnapshot(mode, draft),
    effectivePrompt,
    referenceCount: references.length
  }
}

export function validateImageGenerationInput(
  draft: GenerationModeDraft,
  mode: GenerationMode,
  effectivePrompt: string,
  referenceCount: number
): string | null {
  if (mode === 'image') {
    if (!effectivePrompt.trim() && referenceCount === 0) {
      return 'Enter a prompt or attach at least one image.'
    }
    if (draft.imageAttachments.length > 0 && referenceCount === 0) {
      return 'Attached images could not be resolved. Remove and re-attach them.'
    }
    return null
  }

  if (!effectivePrompt.trim()) {
    return 'Enter a prompt for video generation.'
  }
  return null
}

export function generationToModeDraft(generation: ProjectGeneration): GenerationModeDraft {
  return {
    context: generation.context ?? '',
    useContextInPrompt: generation.useContextInPrompt ?? true,
    prompt: generation.prompt ?? '',
    model: generation.model,
    imageAttachments: generation.imageAttachments
      ? generation.imageAttachments.map(cloneProjectMedia)
      : [],
    videoStartFrame: generation.videoStartFrame ? cloneProjectMedia(generation.videoStartFrame) : null,
    videoDuration: generation.videoDuration ?? 5
  }
}
