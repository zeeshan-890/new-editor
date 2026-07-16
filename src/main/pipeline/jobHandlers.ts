import type {
  CharacterProfile,
  ScriptSegment,
  SegmentPipelineState,
  StyleLock
} from '../../shared/segmentPipeline'
import type { HiggsfieldEnqueueRequest } from '../../shared/types'
import {
  AUTO_EXTRA_DURATION_MIN_AUDIO_SECONDS,
  clampAutoExtraDurationSeconds,
  clampVideoDurationSeconds,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL
} from '../../shared/types'
import { applyVideoSoundParams } from '../../shared/videoGeneration'
import {
  buildSegmentImageReferences
} from '../../shared/pipelineImageRefs'
import { appendSceneVisualGuards, buildMedicalDiagramImagePrompt, classifySceneVisualMode } from '../../shared/pipelinePromptGuards'
import { appendCreativeGuidance } from '../../shared/creativeInstructions'

export { buildSegmentImageReferences } from '../../shared/pipelineImageRefs'

function storySettingLine(styleLock: StyleLock): string {
  const setting = styleLock.setting?.trim()
  if (!setting) return ''
  return `Story setting: ${setting}. Wardrobe, props, and environment must match this context.`
}

function formatCharacterLine(character: CharacterProfile): string {
  const role = character.role?.trim()
  const label = role ? `${character.name} (${role})` : character.name
  return `${label}: ${character.description}`
}

function attachedReferenceHint(
  segment: ScriptSegment,
  pipeline: SegmentPipelineState
): string {
  const refIds = new Set(segment.scriptReferenceIds ?? [])
  const count = (pipeline.scriptReferences ?? []).filter((ref) => refIds.has(ref.id)).length
  if (count === 0) return ''
  return count === 1
    ? 'Match the attached reference image for this shot where it applies.'
    : `Match the ${count} attached reference images for this shot where they apply.`
}

export function buildCharacterAnchorPrompt(
  character: CharacterProfile,
  pipeline: SegmentPipelineState
): string {
  const styleLock = pipeline.styleLock
  const role = character.role?.trim()
  const roleLine = role
    ? `Story role: ${role}. Dress with role-appropriate clothing, props, and grooming only for this role.`
    : 'Dress appropriately for their role in the story.'
  const settingLine = styleLock.setting?.trim()
    ? `Background softly suggests ${styleLock.setting} — blurred, not a busy scene.`
    : 'Plain soft neutral background.'

  return [
    `Single portrait photo of ${character.name}. ${character.description}.`,
    roleLine,
    'One person only, waist-up or head-and-shoulders, neutral expression, front three-quarter angle.',
    settingLine,
    'NOT a character sheet, NOT a reference board, NOT multiple views, NOT a collage, NOT split panels.',
    `${styleLock.visualStyle}. Photorealistic, sharp face detail for identity matching in later scenes.`
  ]
    .filter(Boolean)
    .join(' ')
}

export function buildSegmentImagePrompt(
  segment: ScriptSegment,
  pipeline: SegmentPipelineState
): string {
  const mode = classifySceneVisualMode(segment.imagePrompt, segment.scriptText)
  const creative = pipeline.creativeInstructions

  // Medical / scientific diagrams: isolated subject only — never add lifestyle setting,
  // characters, or cinematic room framing (those cause text labels and busy backgrounds).
  if (mode === 'diagram') {
    const refHint = attachedReferenceHint(segment, pipeline)
    const styleHint = pipeline.styleLock.visualStyle?.trim()
    const subject = [
      segment.imagePrompt.trim(),
      styleHint ? `Look / style: ${styleHint}` : '',
      refHint
    ]
      .filter(Boolean)
      .join('\n\n')
    return appendCreativeGuidance(buildMedicalDiagramImagePrompt(subject), creative, {
      forDiagram: true
    })
  }

  const characters = pipeline.characters
  const styleLock = pipeline.styleLock
  const presentCharacters = segment.characters
    .map((id) => characters.find((c) => c.id === id))
    .filter(Boolean) as CharacterProfile[]

  const charDesc = presentCharacters.map(formatCharacterLine).join('. ')

  const interactionHint =
    presentCharacters.length > 1
      ? `Show all listed characters together in one scene, interacting naturally according to their roles (${presentCharacters.map((c) => c.role ?? c.name).join(' and ')}).`
      : presentCharacters.length === 1 && presentCharacters[0].role
        ? `Focus on ${presentCharacters[0].name} as the ${presentCharacters[0].role}; posture and props must match that role.`
        : ''

  // segment.imagePrompt should already include analyze-time creative; re-apply from
  // pipeline.creativeInstructions so freeform briefs still hit generation if under-applied.
  const parts = [
    styleLock.visualStyle,
    storySettingLine(styleLock),
    charDesc
      ? `Characters in this shot: ${charDesc}. Keep each person's role-appropriate wardrobe and demeanor.`
      : '',
    interactionHint,
    attachedReferenceHint(segment, pipeline),
    `Scene: ${segment.imagePrompt}`,
    segment.scriptText.trim()
      ? `Narration context: "${segment.scriptText.trim().slice(0, 240)}"`
      : '',
    'Single unified cinematic frame — one continuous photograph, not a collage.',
    'NOT a character sheet, NOT a reference board, NOT multiple panels, NOT split screen.',
    'Full scene composition suitable for image-to-video animation: clear subjects, readable depth, natural lighting, room for clear subject and camera motion.'
  ].filter(Boolean)

  const withCreative = appendCreativeGuidance(parts.join('\n\n'), creative)
  return appendSceneVisualGuards(withCreative, segment.imagePrompt, segment.scriptText)
}

/** Default when analyze left motion empty or too weak for image-to-video. */
export const DEFAULT_VIDEO_MOTION_PROMPT =
  'Visible subject motion and camera movement: natural body language, expressive face, secondary motion (hair, fabric, hands), and a slow cinematic push-in or orbit. Do not hold as a still frame.'

const WEAK_MOTION_PHRASE =
  /\b(subtle|gentle|minimal|slight|soft|barely|almost\s+still|static|frozen)\b/i
const STRONG_MOTION_CUE =
  /\b(walk|turn|reach|gesture|speak|talk|pour|open|close|pan|dolly|orbit|zoom|push[- ]?in|pull[- ]?out|tilt|nod|blink|breathe|hand|move|moving|action|interact)\b/i

function isWeakVideoMotion(motion: string): boolean {
  const trimmed = motion.trim()
  if (!trimmed) return true
  if (trimmed === 'Subtle natural motion, gentle camera movement, cinematic pacing.') return true
  if (/^subtle\b/i.test(trimmed) && !STRONG_MOTION_CUE.test(trimmed)) return true
  if (WEAK_MOTION_PHRASE.test(trimmed) && !STRONG_MOTION_CUE.test(trimmed)) return true
  return false
}

function deriveMotionFromSegment(segment: ScriptSegment): string {
  if (classifySceneVisualMode(segment.imagePrompt, segment.scriptText) === 'diagram') {
    const clipHint = segment.imagePrompt?.trim().slice(0, 160)
    return clipHint
      ? `Slow cinematic orbit and gentle push-in around the medical diagram (${clipHint}). Soft lighting shift across the structure; keep the diagram unlabeled on a plain background — no text appearing.`
      : 'Slow cinematic orbit and gentle push-in around the medical diagram on a plain background. Soft lighting drift; keep it unlabeled — no text appearing.'
  }
  const clipHint = segment.imagePrompt?.trim().slice(0, 160)
  if (clipHint) {
    return `Animate the scene with clear continuous motion matching: ${clipHint}. Camera slowly pushes in; subjects move naturally — not a still frame.`
  }
  const vo = segment.scriptText?.trim().slice(0, 120)
  if (vo) {
    return `Animate to match the narration beat ("${vo}"): visible subject action and a slow cinematic camera move throughout.`
  }
  return DEFAULT_VIDEO_MOTION_PROMPT
}

/** Resolve motion text for logging / enqueue (strengthens weak analyze defaults). */
export function resolveSegmentVideoMotion(segment: ScriptSegment): string {
  const raw = segment.videoMotionPrompt?.trim() ?? ''
  if (!raw || isWeakVideoMotion(raw)) return deriveMotionFromSegment(segment)
  return raw
}

export function videoDurationFromMatch(
  durationMs: number,
  autoExtraDurationSeconds: number
): number {
  const baseSeconds = durationMs / 1000
  const shouldAddExtra = baseSeconds >= AUTO_EXTRA_DURATION_MIN_AUDIO_SECONDS
  const total = shouldAddExtra
    ? baseSeconds + clampAutoExtraDurationSeconds(autoExtraDurationSeconds)
    : baseSeconds
  return clampVideoDurationSeconds(Math.ceil(total))
}

export function buildCharacterAnchorEnqueue(
  projectId: string,
  character: CharacterProfile,
  pipeline: SegmentPipelineState,
  workspaceId?: string
): HiggsfieldEnqueueRequest {
  return {
    model: pipeline.imageModel ?? DEFAULT_IMAGE_MODEL,
    prompt: buildCharacterAnchorPrompt(character, pipeline),
    workspaceId,
    category: 'image',
    projectId,
    params: { aspect_ratio: pipeline.styleLock.aspectRatio },
    wait: true
  }
}

export function buildSegmentImageEnqueue(
  projectId: string,
  segment: ScriptSegment,
  pipeline: SegmentPipelineState,
  previousImagePath: string | undefined,
  workspaceId?: string
): HiggsfieldEnqueueRequest {
  const references = buildSegmentImageReferences(
    segment,
    pipeline,
    previousImagePath
  )

  return {
    model: pipeline.imageModel ?? DEFAULT_IMAGE_MODEL,
    prompt: buildSegmentImagePrompt(segment, pipeline),
    workspaceId,
    category: 'image',
    references,
    projectId,
    params: { aspect_ratio: pipeline.styleLock.aspectRatio },
    wait: true
  }
}

export function buildSegmentVideoPrompt(
  segment: ScriptSegment,
  pipeline: SegmentPipelineState
): string {
  const motion = resolveSegmentVideoMotion(segment)
  const mode = classifySceneVisualMode(segment.imagePrompt, segment.scriptText)
  const creative = pipeline.creativeInstructions

  if (mode === 'diagram') {
    const parts = [
      motion,
      'Animate this medical diagram still into video: slow orbit or push-in, subtle lighting change, structure stays sharp and centered.',
      attachedReferenceHint(segment, pipeline),
      'Keep the diagram as the ONLY visual on an empty plain neutral background for the full duration — never introduce text, labels, people, props, rooms, insets, or any other visuals.'
    ].filter(Boolean)
    const withCreative = appendCreativeGuidance(parts.join('\n\n'), creative, {
      forVideo: true,
      forDiagram: true
    })
    return appendSceneVisualGuards(withCreative, segment.imagePrompt, segment.scriptText, {
      forVideo: true
    })
  }

  const parts = [
    motion,
    'Animate this still into video with clear, continuous motion for the full duration — subjects move and interact; camera drifts or pushes in. Avoid a static freeze-frame look.',
    attachedReferenceHint(segment, pipeline),
    'Keep identity, wardrobe, and packaging consistent with the start frame and any attached references.'
  ].filter(Boolean)

  const withCreative = appendCreativeGuidance(parts.join('\n\n'), creative, { forVideo: true })
  return appendSceneVisualGuards(withCreative, segment.imagePrompt, segment.scriptText, {
    forVideo: true
  })
}

export function buildSegmentVideoEnqueue(
  projectId: string,
  segment: ScriptSegment,
  pipeline: SegmentPipelineState,
  workspaceId?: string
): HiggsfieldEnqueueRequest {
  if (!segment.imageLocalPath) {
    throw new Error(`Segment ${segment.index + 1} has no image for video generation.`)
  }
  if (!segment.scriptMatch) {
    throw new Error(`Segment ${segment.index + 1} has no audio match for duration.`)
  }

  const duration = videoDurationFromMatch(
    segment.scriptMatch.durationMs,
    pipeline.autoExtraDurationSeconds
  )

  return {
    model: pipeline.videoModel ?? DEFAULT_VIDEO_MODEL,
    prompt: buildSegmentVideoPrompt(segment, pipeline),
    workspaceId,
    category: 'video',
    projectId,
    mediaPath: segment.imageLocalPath,
    mediaFlag: 'start-image',
    params: applyVideoSoundParams(pipeline.videoModel ?? DEFAULT_VIDEO_MODEL, {
      duration: String(duration),
      aspect_ratio: pipeline.styleLock.aspectRatio
    }),
    wait: true
  }
}

export function validatePipelineImagesReady(pipeline: SegmentPipelineState): string | null {
  if (!pipeline.segments.length) {
    return 'Analyze the script first to create segments.'
  }
  return null
}

export function validatePipelineVideosReady(pipeline: SegmentPipelineState): string | null {
  const imageErr = validatePipelineImagesReady(pipeline)
  if (imageErr) return imageErr
  if (!pipeline.masterAudioPath) {
    return 'Sync audio from the video editor timeline before generating videos.'
  }
  return null
}

/** @deprecated Use validatePipelineImagesReady or validatePipelineVideosReady */
export function validatePipelineReady(pipeline: SegmentPipelineState): string | null {
  return validatePipelineVideosReady(pipeline)
}

export function validateSegmentsForImages(pipeline: SegmentPipelineState): string[] {
  const warnings: string[] = []
  for (const ch of pipeline.characters) {
    if (!ch.anchorImagePath && ch.anchorStatus !== 'done') {
      const used = pipeline.segments.some((s) => s.characters.includes(ch.id))
      if (used) {
        warnings.push(`Character "${ch.name}" anchor image is not ready.`)
      }
    }
  }
  return warnings
}
