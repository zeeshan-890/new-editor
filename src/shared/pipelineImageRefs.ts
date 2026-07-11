import {
  resolvePendingSegmentJobId,
  type ScriptSegment,
  type SegmentPipelineState
} from './segmentPipeline'
import type { HiggsfieldReferenceImage, ProjectGeneration, ProjectMedia } from './types'

export function parseSegmentNumberFromPrompt(prompt: string): number | null {
  const match = /^Segment (\d+):/i.exec(prompt.trim())
  return match ? Number.parseInt(match[1], 10) : null
}

export function buildSegmentImageReferences(
  segment: ScriptSegment,
  pipeline: SegmentPipelineState,
  previousImagePath?: string
): HiggsfieldReferenceImage[] {
  const refs: HiggsfieldReferenceImage[] = []

  const primaryCharId = segment.characters[0]
  if (primaryCharId) {
    const ch = pipeline.characters.find((c) => c.id === primaryCharId)
    if (ch?.anchorImagePath) {
      refs.push({
        id: `anchor-${ch.id}`,
        localPath: ch.anchorImagePath,
        label: `${ch.name} anchor`
      })
    }
  }

  if (segment.continuityFromPrevious && previousImagePath) {
    refs.push({
      id: 'prev-segment',
      localPath: previousImagePath,
      label: 'Previous scene'
    })
  }

  const refIds = new Set(segment.scriptReferenceIds ?? [])
  for (const ref of pipeline.scriptReferences ?? []) {
    if (!refIds.has(ref.id) || !ref.localPath) continue
    refs.push({
      id: ref.id,
      localPath: ref.localPath,
      label: ref.instruction.trim() || ref.name
    })
  }

  return refs
}

export function referencesToProjectMedia(refs: HiggsfieldReferenceImage[]): ProjectMedia[] {
  return refs
    .filter((ref) => Boolean(ref.localPath || ref.url))
    .map((ref) => ({
      id: ref.id,
      localPath: ref.localPath ?? '',
      name: ref.label ?? 'reference',
      previewUrl: ref.url
    }))
}

export function previousSegmentImagePath(
  pipeline: SegmentPipelineState,
  segment: ScriptSegment
): string | undefined {
  const sorted = [...pipeline.segments].sort((a, b) => a.index - b.index)
  const segIdx = sorted.findIndex((s) => s.id === segment.id)
  return segIdx > 0 ? sorted[segIdx - 1]?.imageLocalPath : undefined
}

export function segmentImageAttachments(
  pipeline: SegmentPipelineState,
  segment: ScriptSegment
): ProjectMedia[] {
  const refs = buildSegmentImageReferences(
    segment,
    pipeline,
    previousSegmentImagePath(pipeline, segment)
  )
  return referencesToProjectMedia(refs)
}

export function findPipelineSegmentForGeneration(
  pipeline: SegmentPipelineState,
  generation: ProjectGeneration
): ScriptSegment | undefined {
  const pendingJobId = resolvePendingSegmentJobId(generation.id) ?? generation.id
  const byPending = pipeline.segments.find(
    (s) => s.pendingImageApproval?.jobId === pendingJobId
  )
  if (byPending) return byPending

  if (generation.id) {
    const byImageJob = pipeline.segments.find((s) => s.imageJobId === generation.id)
    if (byImageJob) return byImageJob
    const byVideoJob = pipeline.segments.find((s) => s.videoJobId === generation.id)
    if (byVideoJob) return byVideoJob
  }

  const segmentNum = parseSegmentNumberFromPrompt(generation.prompt)
  if (segmentNum == null) return undefined
  return pipeline.segments.find((s) => s.index === segmentNum - 1)
}

export function pipelineImageAttachmentsForGeneration(
  pipeline: SegmentPipelineState,
  generation: ProjectGeneration
): ProjectMedia[] {
  const segment = findPipelineSegmentForGeneration(pipeline, generation)
  if (!segment) return []
  return segmentImageAttachments(pipeline, segment)
}
