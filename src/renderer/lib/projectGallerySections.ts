import type {
  GenerationComposerSnapshot,
  HiggsfieldGenerationJob,
  ProjectGeneration
} from '@shared/types'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@shared/types'
import { segmentImageAttachments } from '@shared/pipelineImageRefs'
import type { CharacterProfile, ScriptSegment, SegmentPipelineState } from '@shared/segmentPipeline'
import { pendingSegmentGenerationId } from '@shared/segmentPipeline'
import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'

export type GalleryEntry =
  | { kind: 'pending-job'; job: HiggsfieldGenerationJob; config?: GenerationComposerSnapshot }
  | { kind: 'segment-running'; segment: ScriptSegment }
  | { kind: 'character-running'; character: CharacterProfile }
  | { kind: 'segment-media'; segment: ScriptSegment; media: 'image' | 'video' }
  | { kind: 'character-media'; character: CharacterProfile }
  | { kind: 'segment-pending-approval'; segment: ScriptSegment; item: ProjectGeneration }
  | { kind: 'generation'; item: ProjectGeneration; badge?: string }

export interface ProjectGallerySections {
  characters: GalleryEntry[]
  images: GalleryEntry[]
  clips: GalleryEntry[]
  other: GalleryEntry[]
}

export function isCharacterAnchorPrompt(prompt: string): boolean {
  return prompt.trim().startsWith('Character anchor:')
}

export function parseSegmentNumber(prompt: string): number | null {
  const match = /^Segment (\d+):/i.exec(prompt.trim())
  return match ? Number.parseInt(match[1], 10) : null
}

export function pendingSegmentToGeneration(segment: ScriptSegment): ProjectGeneration | null {
  const pending = segment.pendingImageApproval
  if (!pending) return null
  return {
    id: pendingSegmentGenerationId(pending.jobId),
    type: 'image',
    prompt: `Segment ${segment.index + 1}: ${segment.scriptText}`,
    model: pending.model,
    url: pending.localPath ? localMediaPathUrl(pending.localPath) : pending.url,
    localPath: pending.localPath,
    createdAt: pending.createdAt,
    context: pending.context,
    useContextInPrompt: pending.useContextInPrompt,
    imageAttachments: pending.imageAttachments.map((m) => ({ ...m })),
    aspectRatio: pending.aspectRatio
  }
}

function isSegmentImageJob(
  job: HiggsfieldGenerationJob,
  config?: GenerationComposerSnapshot
): boolean {
  const label = config?.prompt?.trim() || job.prompt.trim()
  return job.category !== 'video' && parseSegmentNumber(label) != null
}

function isSegmentVideoJob(
  job: HiggsfieldGenerationJob,
  config?: GenerationComposerSnapshot
): boolean {
  const label = config?.prompt?.trim() || job.prompt.trim()
  return job.category === 'video' && parseSegmentNumber(label) != null
}

function isCharacterAnchorJob(
  job: HiggsfieldGenerationJob,
  config?: GenerationComposerSnapshot
): boolean {
  const label = config?.prompt?.trim() || job.prompt.trim()
  return isCharacterAnchorPrompt(label)
}

function generationSegmentNumber(item: ProjectGeneration): number | null {
  return parseSegmentNumber(item.prompt)
}

function isManualGeneration(item: ProjectGeneration): boolean {
  return !isCharacterAnchorPrompt(item.prompt) && generationSegmentNumber(item) == null
}

function sortBySegmentNumber(a: GalleryEntry, b: GalleryEntry): number {
  const indexA = entrySegmentIndex(a) ?? Number.MAX_SAFE_INTEGER
  const indexB = entrySegmentIndex(b) ?? Number.MAX_SAFE_INTEGER
  return indexA - indexB
}

function resolveCharacterGeneration(
  character: CharacterProfile,
  pipeline: SegmentPipelineState,
  generations: ProjectGeneration[]
): ProjectGeneration | null {
  if (!character.anchorImagePath) return null

  const fromGallery = character.anchorImageJobId
    ? generations.find((item) => item.id === character.anchorImageJobId)
    : undefined
  if (fromGallery) {
    if (!fromGallery.localPath) {
      return {
        ...fromGallery,
        localPath: character.anchorImagePath,
        url: localMediaPathUrl(character.anchorImagePath)
      }
    }
    return fromGallery
  }

  const id = character.anchorImageJobId ?? `character-${character.id}`
  return {
    id,
    type: 'image',
    prompt: `Character anchor: ${character.name}`,
    model: pipeline.imageModel ?? DEFAULT_IMAGE_MODEL,
    url: localMediaPathUrl(character.anchorImagePath),
    localPath: character.anchorImagePath,
    createdAt: Date.now()
  }
}

/** Resolve a pipeline segment into a ProjectGeneration for gallery / composer load. */
export function resolveSegmentGeneration(
  segment: ScriptSegment,
  media: 'image' | 'video',
  pipeline: SegmentPipelineState,
  generations: ProjectGeneration[]
): ProjectGeneration | null {
  const path = media === 'video' ? segment.videoLocalPath : segment.imageLocalPath
  if (!path) return null

  const jobId = media === 'video' ? segment.videoJobId : segment.imageJobId
  const fromGallery = jobId ? generations.find((item) => item.id === jobId) : undefined
  if (fromGallery) {
    if (!fromGallery.localPath) {
      return {
        ...fromGallery,
        localPath: path,
        url: localMediaPathUrl(path)
      }
    }
    if (
      media === 'image' &&
      (!fromGallery.imageAttachments || fromGallery.imageAttachments.length === 0)
    ) {
      const imageAttachments = segmentImageAttachments(pipeline, segment)
      if (imageAttachments.length > 0) {
        return { ...fromGallery, imageAttachments }
      }
    }
    return fromGallery
  }

  const id = jobId ?? `${segment.id}-${media}`
  const imageAttachments =
    media === 'image' ? segmentImageAttachments(pipeline, segment) : undefined
  return {
    id,
    type: media === 'video' ? 'video' : 'image',
    prompt: `Segment ${segment.index + 1}: ${segment.scriptText}`,
    model:
      media === 'video'
        ? pipeline.videoModel ?? DEFAULT_VIDEO_MODEL
        : pipeline.imageModel ?? DEFAULT_IMAGE_MODEL,
    url: localMediaPathUrl(path),
    localPath: path,
    createdAt: Date.now(),
    scriptMatch: segment.scriptMatch ?? undefined,
    imageAttachments: imageAttachments?.map((attachment) => ({ ...attachment }))
  }
}

/**
 * Build a generation-shaped payload for opening the sidebar composer even when
 * media is missing (e.g. NSFW / failed jobs) so the prompt can still be edited.
 */
export function segmentToComposerGeneration(
  segment: ScriptSegment,
  media: 'image' | 'video',
  pipeline: SegmentPipelineState,
  generations: ProjectGeneration[]
): ProjectGeneration {
  const existing = resolveSegmentGeneration(segment, media, pipeline, generations)
  if (existing) return existing

  if (media === 'video') {
    const startPath = segment.imageLocalPath
    return {
      id: segment.videoJobId ?? `${segment.id}-video`,
      type: 'video',
      prompt:
        segment.videoMotionPrompt?.trim() ||
        `Segment ${segment.index + 1}: ${segment.scriptText}`,
      model: pipeline.videoModel ?? DEFAULT_VIDEO_MODEL,
      url: '',
      createdAt: Date.now(),
      scriptMatch: segment.scriptMatch ?? undefined,
      videoStartFrame: startPath
        ? {
            id: `seg-${segment.id}-start`,
            localPath: startPath,
            name: `Segment ${segment.index + 1} start`,
            previewUrl: localMediaPathUrl(startPath)
          }
        : null
    }
  }

  return {
    id: segment.imageJobId ?? `${segment.id}-image`,
    type: 'image',
    prompt: `Segment ${segment.index + 1}: ${segment.scriptText}`,
    model: pipeline.imageModel ?? DEFAULT_IMAGE_MODEL,
    url: '',
    createdAt: Date.now(),
    imageAttachments: segmentImageAttachments(pipeline, segment).map((a) => ({ ...a })),
    aspectRatio: pipeline.styleLock?.aspectRatio
  }
}

function entrySegmentIndex(entry: GalleryEntry): number | null {
  if (
    entry.kind === 'segment-running' ||
    entry.kind === 'segment-media' ||
    entry.kind === 'segment-pending-approval'
  ) {
    return entry.segment.index
  }
  if (entry.kind === 'pending-job') {
    const label = entry.config?.prompt?.trim() || entry.job.prompt.trim()
    const num = parseSegmentNumber(label)
    return num != null ? num - 1 : null
  }
  if (entry.kind === 'generation') {
    const num = generationSegmentNumber(entry.item)
    return num != null ? num - 1 : null
  }
  return null
}

export function organizeProjectGallery(input: {
  pipeline: SegmentPipelineState
  generations: ProjectGeneration[]
  activeJobs: HiggsfieldGenerationJob[]
  pendingJobConfigs: Record<string, GenerationComposerSnapshot>
  trackedJobIds: Set<string>
}): ProjectGallerySections {
  const { pipeline, generations, activeJobs, pendingJobConfigs, trackedJobIds } = input

  const characters: GalleryEntry[] = []
  const images: GalleryEntry[] = []
  const clips: GalleryEntry[] = []
  const other: GalleryEntry[] = []

  const usedGenerationIds = new Set<string>()
  const usedCharacterIds = new Set<string>()
  const usedSegmentImageIds = new Set<string>()
  const usedSegmentVideoIds = new Set<string>()

  for (const job of activeJobs) {
    const config = pendingJobConfigs[job.id]
    if (isCharacterAnchorJob(job, config)) {
      characters.push({ kind: 'pending-job', job, config })
      continue
    }
    if (isSegmentVideoJob(job, config)) {
      clips.push({ kind: 'pending-job', job, config })
      continue
    }
    if (isSegmentImageJob(job, config)) {
      images.push({ kind: 'pending-job', job, config })
      continue
    }
    if (job.category === 'video') {
      clips.push({ kind: 'pending-job', job, config })
    } else {
      images.push({ kind: 'pending-job', job, config })
    }
  }

  for (const character of pipeline.characters) {
    const jobTracked =
      character.anchorImageJobId != null && trackedJobIds.has(character.anchorImageJobId)

    if (character.anchorStatus === 'running' && !jobTracked) {
      characters.push({ kind: 'character-running', character })
      usedCharacterIds.add(character.id)
      continue
    }

    if (character.anchorImagePath) {
      const item = resolveCharacterGeneration(character, pipeline, generations)
      if (item) {
        characters.push({ kind: 'generation', item, badge: character.name })
        usedCharacterIds.add(character.id)
        usedGenerationIds.add(item.id)
      }
    }
  }

  const runningSegments = [...pipeline.segments]
    .filter(
      (segment) =>
        (segment.status === 'image_running' || segment.status === 'video_running') &&
        !(
          (segment.imageJobId && trackedJobIds.has(segment.imageJobId)) ||
          (segment.videoJobId && trackedJobIds.has(segment.videoJobId))
        )
    )
    .sort((a, b) => a.index - b.index)

  for (const segment of runningSegments) {
    if (segment.status === 'video_running') {
      clips.push({ kind: 'segment-running', segment })
      usedSegmentVideoIds.add(segment.id)
    } else {
      images.push({ kind: 'segment-running', segment })
      usedSegmentImageIds.add(segment.id)
    }
  }

  const sortedSegments = [...pipeline.segments].sort((a, b) => a.index - b.index)

  for (const segment of sortedSegments) {
    if (segment.imageLocalPath) {
      const item = resolveSegmentGeneration(segment, 'image', pipeline, generations)
      if (item) {
        images.push({ kind: 'generation', item, badge: `Segment ${segment.index + 1}` })
        usedSegmentImageIds.add(segment.id)
        usedGenerationIds.add(item.id)
      }
    }
    if (segment.pendingImageApproval) {
      const pendingItem = pendingSegmentToGeneration(segment)
      if (pendingItem) {
        images.push({
          kind: 'segment-pending-approval',
          segment,
          item: pendingItem
        })
      }
    }
  }

  for (const segment of sortedSegments) {
    if (segment.videoLocalPath) {
      const item = resolveSegmentGeneration(segment, 'video', pipeline, generations)
      if (item) {
        clips.push({ kind: 'generation', item, badge: `Segment ${segment.index + 1}` })
        usedSegmentVideoIds.add(segment.id)
        usedGenerationIds.add(item.id)
      }
    }
  }

  for (const item of generations) {
    if (usedGenerationIds.has(item.id)) continue

    if (isCharacterAnchorPrompt(item.prompt)) {
      const name = item.prompt.replace(/^Character anchor:\s*/i, '').trim()
      const character = pipeline.characters.find(
        (c) => c.name === name || c.anchorImageJobId === item.id
      )
      if (character && usedCharacterIds.has(character.id)) continue
      characters.push({ kind: 'generation', item, badge: name || undefined })
      continue
    }

    const segmentNum = generationSegmentNumber(item)
    if (segmentNum != null) {
      const segment = pipeline.segments.find((s) => s.index === segmentNum - 1)
      const isVideo = item.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(item.url)

      if (isVideo) {
        if (segment && usedSegmentVideoIds.has(segment.id)) continue
        clips.push({
          kind: 'generation',
          item,
          badge: `Segment ${segmentNum}`
        })
      } else {
        if (segment && usedSegmentImageIds.has(segment.id)) continue
        images.push({
          kind: 'generation',
          item,
          badge: `Segment ${segmentNum}`
        })
      }
      continue
    }

    if (isManualGeneration(item)) {
      if (item.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(item.url)) {
        other.push({ kind: 'generation', item })
      } else {
        other.push({ kind: 'generation', item })
      }
    }
  }

  images.sort(sortBySegmentNumber)
  clips.sort(sortBySegmentNumber)

  return { characters, images, clips, other }
}

export function gallerySectionCounts(sections: ProjectGallerySections): {
  characters: number
  images: number
  clips: number
  other: number
  total: number
} {
  const characters = sections.characters.length
  const images = sections.images.length
  const clips = sections.clips.length
  const other = sections.other.length
  return { characters, images, clips, other, total: characters + images + clips + other }
}

export type GalleryPreviewFilter = 'all' | 'characters' | 'images' | 'videos'

function entriesHaveSelectableMedia(entry: GalleryEntry): entry is
  | { kind: 'generation'; item: ProjectGeneration; badge?: string }
  | { kind: 'segment-pending-approval'; segment: ScriptSegment; item: ProjectGeneration } {
  return entry.kind === 'generation' || entry.kind === 'segment-pending-approval'
}

export function flattenEntryGenerations(entries: GalleryEntry[]): ProjectGeneration[] {
  const items: ProjectGeneration[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entriesHaveSelectableMedia(entry)) continue
    if (seen.has(entry.item.id)) continue
    seen.add(entry.item.id)
    items.push(entry.item)
  }
  return items
}

export function gallerySectionsForFilter(
  sections: ProjectGallerySections,
  filter: GalleryPreviewFilter
): Array<{ id: string; title: string; entries: GalleryEntry[] }> {
  const otherImages = sections.other.filter((entry) => {
    if (!entriesHaveSelectableMedia(entry)) return true
    return entry.item.type !== 'video' && !/\.(mp4|webm|mov)(\?|$)/i.test(entry.item.url)
  })
  const otherVideos = sections.other.filter((entry) => {
    if (!entriesHaveSelectableMedia(entry)) return false
    return entry.item.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(entry.item.url)
  })

  switch (filter) {
    case 'characters':
      return [{ id: 'characters', title: 'Characters', entries: sections.characters }]
    case 'images':
      return [
        { id: 'images', title: 'Images', entries: sections.images },
        ...(otherImages.length > 0
          ? [{ id: 'other-images', title: 'Other', entries: otherImages }]
          : [])
      ]
    case 'videos':
      return [
        { id: 'videos', title: 'Videos', entries: sections.clips },
        ...(otherVideos.length > 0
          ? [{ id: 'other-videos', title: 'Other', entries: otherVideos }]
          : [])
      ]
    case 'all':
    default:
      return [
        { id: 'characters', title: 'Characters', entries: sections.characters },
        { id: 'images', title: 'Images', entries: sections.images },
        { id: 'videos', title: 'Videos', entries: sections.clips },
        { id: 'other', title: 'Other', entries: sections.other }
      ]
  }
}

export function flattenGalleryGenerations(sections: ProjectGallerySections): ProjectGeneration[] {
  return flattenEntryGenerations([
    ...sections.characters,
    ...sections.images,
    ...sections.clips,
    ...sections.other
  ])
}

export function flattenGalleryGenerationsForFilter(
  sections: ProjectGallerySections,
  filter: GalleryPreviewFilter
): ProjectGeneration[] {
  return flattenEntryGenerations(
    gallerySectionsForFilter(sections, filter).flatMap((section) => section.entries)
  )
}
