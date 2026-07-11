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

function resolveSegmentGeneration(
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

export function flattenGalleryGenerations(sections: ProjectGallerySections): ProjectGeneration[] {
  const items: ProjectGeneration[] = []
  const seen = new Set<string>()

  for (const section of [
    sections.characters,
    sections.images,
    sections.clips,
    sections.other
  ]) {
    for (const entry of section) {
      if (entry.kind === 'generation' || entry.kind === 'segment-pending-approval') {
        const item = entry.item
        if (seen.has(item.id)) continue
        seen.add(item.id)
        items.push(item)
        continue
      }
    }
  }

  return items
}
