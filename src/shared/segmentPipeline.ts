import type { ScriptAudioMatch } from './types'
import {
  AUTO_EXTRA_DURATION_DEFAULT_SECONDS,
  DEFAULT_ASPECT_RATIO,
  generateId,
  normalizeGenerationProject,
  resolveImageModelId,
  type GenerationProject
} from './types'

export type SegmentStatus =
  | 'pending'
  | 'anchor_running'
  | 'image_running'
  | 'image_pending_approval'
  | 'image_done'
  | 'audio_match_done'
  | 'video_running'
  | 'video_done'
  | 'timeline_placed'
  | 'failed'

export type PipelineGenerationPhase = 'images' | 'videos'

export type PipelineStatus =
  | 'idle'
  | 'analyzing'
  | 'running'
  | 'paused'
  | 'complete'
  | 'failed'

export type PipelineJobType =
  | 'character_anchor'
  | 'segment_image'
  | 'segment_audio_match'
  | 'segment_video'
  | 'timeline_place'

export interface StyleLock {
  aspectRatio: string
  visualStyle: string
  /** Primary story environment inferred from the script (e.g. "medical clinic examination room"). */
  setting?: string
}

/** Staged segment image awaiting user approval before replacing the current one. */
export interface PendingSegmentImage {
  jobId: string
  url: string
  localPath?: string
  imagePrompt: string
  model: string
  context: string
  useContextInPrompt: boolean
  imageAttachments: import('./types').ProjectMedia[]
  aspectRatio?: string
  replacesGenerationId?: string
  createdAt: number
}

export const PENDING_SEGMENT_GENERATION_SUFFIX = '::pending'

export function pendingSegmentGenerationId(jobId: string): string {
  return `${jobId}${PENDING_SEGMENT_GENERATION_SUFFIX}`
}

export function resolvePendingSegmentJobId(generationId: string): string | null {
  if (!generationId.endsWith(PENDING_SEGMENT_GENERATION_SUFFIX)) return null
  return generationId.slice(0, -PENDING_SEGMENT_GENERATION_SUFFIX.length)
}

export function isPendingSegmentGenerationId(generationId: string): boolean {
  return generationId.endsWith(PENDING_SEGMENT_GENERATION_SUFFIX)
}

export interface ScriptSegment {
  id: string
  index: number
  scriptText: string
  imagePrompt: string
  videoMotionPrompt?: string
  characters: string[]
  continuityFromPrevious: boolean
  status: SegmentStatus
  imageJobId?: string
  imageLocalPath?: string
  pendingImageApproval?: PendingSegmentImage
  scriptMatch?: ScriptAudioMatch | null
  videoJobId?: string
  videoLocalPath?: string
  timelineClipId?: string
  /** Script reference image ids to use when generating this segment's image. */
  scriptReferenceIds?: string[]
  /** When created from Parts mode. */
  sourcePartId?: string
  sourceClipId?: string
  error?: string
}

export interface CharacterProfile {
  id: string
  name: string
  /** Story role — e.g. physician, patient, teacher (drives wardrobe and scene behavior). */
  role?: string
  description: string
  anchorImageJobId?: string
  anchorImagePath?: string
  anchorStatus?: 'pending' | 'running' | 'done' | 'failed'
}

/** User-supplied reference image with per-image usage instructions. */
export interface PipelineScriptReference {
  id: string
  localPath: string
  name: string
  instruction: string
}

/** Full narration vs manual parts→clips authoring. */
export type PipelineScriptMode = 'full' | 'parts'

/**
 * One visual clip under a script part.
 * Flow: explanation + image prompt → starting image → video from image + explanation.
 */
export interface ScriptPartClip {
  id: string
  /** What happens in this clip (visual explanation). */
  explanation: string
  /** Prompt used to generate the starting still. */
  imagePrompt: string
  /** Motion / video prompt derived from explanation. */
  videoMotionPrompt?: string
  /** Linked flat pipeline segment after "Apply parts". */
  segmentId?: string
}

/** A narration chunk with one or more visual clips. */
export interface ScriptPart {
  id: string
  index: number
  scriptText: string
  clips: ScriptPartClip[]
}

export interface SegmentPipelineState {
  fullScript: string
  /** Authoring mode for the script panel. */
  scriptMode?: PipelineScriptMode
  /** Manual parts→clips when scriptMode is 'parts'. */
  scriptParts?: ScriptPart[]
  /** Creative direction separate from the narration script. */
  creativeInstructions?: string
  scriptReferences?: PipelineScriptReference[]
  masterAudioPath?: string
  masterAudioAssetId?: string
  masterAudioSource?: 'timeline' | 'upload'
  masterAudioSyncedAt?: number
  masterAudioDurationMs?: number
  segments: ScriptSegment[]
  characters: CharacterProfile[]
  styleLock: StyleLock
  pipelineStatus: PipelineStatus
  /** Which generation step is running when pipelineStatus is running or paused. */
  activePhase?: PipelineGenerationPhase
  autoExtraDurationSeconds: number
  imageModel?: string
  videoModel?: string
  workspaceId?: string
  lastError?: string
  analyzedAt?: number
}

export interface LlmSettings {
  apiKey: string
  baseUrl: string
  model: string
}

export interface AssemblyAiSettings {
  apiKey: string
  /** US or EU data residency. */
  region: 'us' | 'eu'
}

export interface LlmAnalyzeSegmentInput {
  index: number
  scriptText: string
  imagePrompt: string
  videoMotionPrompt?: string
  characters: string[]
  continuityFromPrevious: boolean
  /** Script reference image ids to attach when generating this segment's image. */
  referenceIds?: string[]
  sourcePartId?: string
  sourceClipId?: string
}

export interface AnalyzeScriptInput {
  script: string
  creativeInstructions?: string
  references?: Array<{ id: string; name: string; instruction: string }>
}

export interface LlmAnalyzeCharacterInput {
  id: string
  name: string
  role?: string
  description: string
}

export interface LlmAnalyzeResult {
  segments: LlmAnalyzeSegmentInput[]
  characters: LlmAnalyzeCharacterInput[]
  styleLock: StyleLock
}

export interface BatchAudioMatchInput {
  audioPath: string
  segments: Array<{ id: string; scriptText: string; index?: number }>
  /** Full narration script — used for whole-script alignment fallback. */
  fullScript?: string
  trimStartMs?: number
  trimEndMs?: number
  /** Total master audio duration in ms (used for proportional fallback). */
  audioDurationMs?: number
}

export interface BatchAudioMatchResult {
  matches: Array<{ segmentId: string; match: ScriptAudioMatch }>
  warnings: string[]
}

export interface PipelineProgress {
  totalSegments: number
  imagesDone: number
  videosDone: number
  audioMatchesDone: number
  anchorsDone: number
  timelinePlaced: number
  failed: number
}

export const AIMLAPI_DEFAULT_BASE_URL = 'https://api.aimlapi.com/v1'

/** Supported script-analysis models (OpenAI-compatible /v1/chat/completions). */
export const LLM_MODEL_OPTIONS = [
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat (V3)' },
  { id: 'deepseek-chat', label: 'DeepSeek Chat' },
  { id: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek Chat V3 (0324)' }
] as const

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  apiKey: '',
  baseUrl: AIMLAPI_DEFAULT_BASE_URL,
  model: 'deepseek/deepseek-chat'
}

export const DEFAULT_ASSEMBLYAI_SETTINGS: AssemblyAiSettings = {
  apiKey: '',
  region: 'us'
}

export const DEFAULT_STYLE_LOCK: StyleLock = {
  aspectRatio: DEFAULT_ASPECT_RATIO,
  visualStyle: 'cinematic realism, natural lighting'
}

export function createEmptyPipelineState(): SegmentPipelineState {
  return {
    fullScript: '',
    scriptMode: 'full',
    scriptParts: [],
    creativeInstructions: '',
    scriptReferences: [],
    segments: [],
    characters: [],
    styleLock: { ...DEFAULT_STYLE_LOCK },
    pipelineStatus: 'idle',
    autoExtraDurationSeconds: AUTO_EXTRA_DURATION_DEFAULT_SECONDS
  }
}

export function createEmptyScriptPart(index = 0): ScriptPart {
  return {
    id: generateId(),
    index,
    scriptText: '',
    clips: [createEmptyScriptPartClip()]
  }
}

export function createEmptyScriptPartClip(): ScriptPartClip {
  return {
    id: generateId(),
    explanation: '',
    imagePrompt: '',
    videoMotionPrompt: ''
  }
}

/**
 * Flatten Parts → clips into pipeline segments (one segment per clip).
 * Starting image + video generation reuse the existing segment pipeline.
 */
export function flattenScriptPartsToAnalysis(
  parts: ScriptPart[]
): LlmAnalyzeSegmentInput[] {
  const segments: LlmAnalyzeSegmentInput[] = []
  let index = 0
  const ordered = [...parts].sort((a, b) => a.index - b.index)
  for (const part of ordered) {
    const scriptText = part.scriptText.trim()
    if (!scriptText) continue
    // Clip visual (explanation) is required; image/video prompts come from multi-agents.
    const clips = part.clips.filter((clip) => clip.explanation.trim())
    if (clips.length === 0) continue

    for (let c = 0; c < clips.length; c++) {
      const clip = clips[c]
      const explanation = clip.explanation.trim()
      const imagePrompt = clip.imagePrompt.trim() || explanation
      const videoMotionPrompt =
        clip.videoMotionPrompt?.trim() ||
        `Animate: ${explanation}. Slow cinematic push-in; continuous clear motion.`
      segments.push({
        index,
        scriptText,
        imagePrompt,
        videoMotionPrompt,
        characters: [],
        continuityFromPrevious: index > 0 && c > 0,
        sourcePartId: part.id,
        sourceClipId: clip.id
      })
      index += 1
    }
  }
  return segments
}

export function scriptPartsToFullScript(parts: ScriptPart[]): string {
  return [...parts]
    .sort((a, b) => a.index - b.index)
    .map((p) => p.scriptText.trim())
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Build flat segments from Parts→clips and link clip.segmentId.
 * Prefer agent-filled image/video prompts already on clips; optional analysis
 * supplies characters + styleLock after multi-agent enrich.
 */
export function applyScriptPartsToPipeline(
  pipeline: SegmentPipelineState,
  analysis?: Pick<LlmAnalyzeResult, 'characters' | 'styleLock' | 'segments'>
): SegmentPipelineState {
  const parts = Array.isArray(pipeline.scriptParts) ? pipeline.scriptParts : []
  const analysisSegments =
    analysis?.segments?.length &&
    analysis.segments.every((s) => s.sourceClipId || s.imagePrompt)
      ? analysis.segments.map((seg, i) => ({
          ...seg,
          index: typeof seg.index === 'number' ? seg.index : i,
          sourcePartId: seg.sourcePartId,
          sourceClipId: seg.sourceClipId
        }))
      : flattenScriptPartsToAnalysis(parts)

  if (analysisSegments.length === 0) {
    throw new Error(
      'Add at least one script part with text and one clip visual before building.'
    )
  }

  const characters = analysis?.characters?.length
    ? analysis.characters.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role?.trim() || undefined,
        description: c.description,
        anchorStatus: 'pending' as const
      }))
    : pipeline.characters

  const characterIds = new Set(characters.map((c) => c.id))
  const allRefIds = (pipeline.scriptReferences ?? [])
    .map((r) => r.id)
    .filter(Boolean)
  const scriptReferenceIds = new Set(allRefIds)
  const segments = analysisSegments.map((seg) => {
    const created = createSegmentFromAnalysis(
      {
        ...seg,
        // Parts mode: always attach every user reference image to each clip.
        referenceIds: allRefIds.length
          ? allRefIds
          : seg.referenceIds
      },
      characterIds,
      scriptReferenceIds
    )
    return {
      ...created,
      scriptReferenceIds: allRefIds.length ? [...allRefIds] : created.scriptReferenceIds
    }
  })

  const nextParts = parts.map((part) => ({
    ...part,
    clips: part.clips.map((clip) => {
      const match = segments.find((s) => s.sourceClipId === clip.id)
      const fromAnalysis = analysis?.segments?.find((s) => s.sourceClipId === clip.id)
      return {
        ...clip,
        segmentId: match?.id,
        imagePrompt: fromAnalysis?.imagePrompt?.trim() || clip.imagePrompt,
        videoMotionPrompt:
          fromAnalysis?.videoMotionPrompt?.trim() || clip.videoMotionPrompt
      }
    })
  }))

  return {
    ...pipeline,
    scriptMode: 'parts',
    scriptParts: nextParts,
    fullScript: scriptPartsToFullScript(parts),
    segments,
    characters,
    styleLock: analysis?.styleLock
      ? { ...DEFAULT_STYLE_LOCK, ...analysis.styleLock }
      : pipeline.styleLock,
    pipelineStatus: 'idle',
    analyzedAt: Date.now(),
    lastError: undefined
  }
}

export function createSegmentFromAnalysis(
  input: LlmAnalyzeSegmentInput,
  characterIds: Set<string>,
  scriptReferenceIds?: Set<string>
): ScriptSegment {
  const referenceIds = input.referenceIds
    ?.map((id) => id.trim())
    .filter((id) => {
      if (!id) return false
      // Empty allow-set must not wipe ids (Set is truthy even when size === 0).
      if (!scriptReferenceIds || scriptReferenceIds.size === 0) return true
      return scriptReferenceIds.has(id)
    })

  return {
    id: generateId(),
    index: input.index,
    scriptText: input.scriptText.trim(),
    imagePrompt: input.imagePrompt.trim(),
    videoMotionPrompt: input.videoMotionPrompt?.trim(),
    characters: input.characters.filter((id) => characterIds.has(id)),
    continuityFromPrevious: Boolean(input.continuityFromPrevious),
    scriptReferenceIds: referenceIds?.length ? referenceIds : undefined,
    status: 'pending',
    sourcePartId: input.sourcePartId,
    sourceClipId: input.sourceClipId
  }
}

export function normalizePipelineState(
  saved: Partial<SegmentPipelineState> | undefined
): SegmentPipelineState {
  const empty = createEmptyPipelineState()
  if (!saved) return empty
  return {
    ...empty,
    ...saved,
    fullScript: saved.fullScript ?? '',
    scriptMode: saved.scriptMode === 'parts' ? 'parts' : 'full',
    scriptParts: Array.isArray(saved.scriptParts)
      ? saved.scriptParts.map((part, partIndex) => ({
          id: part.id || generateId(),
          index: typeof part.index === 'number' ? part.index : partIndex,
          scriptText: part.scriptText ?? '',
          clips: Array.isArray(part.clips) && part.clips.length > 0
            ? part.clips.map((clip) => ({
                id: clip.id || generateId(),
                explanation: clip.explanation ?? '',
                imagePrompt: clip.imagePrompt ?? '',
                videoMotionPrompt: clip.videoMotionPrompt ?? '',
                segmentId: clip.segmentId
              }))
            : [createEmptyScriptPartClip()]
        }))
      : [],
    creativeInstructions: saved.creativeInstructions ?? '',
    scriptReferences: Array.isArray(saved.scriptReferences)
      ? saved.scriptReferences.map((ref) => ({
          id: ref.id,
          localPath: ref.localPath ?? '',
          name: ref.name ?? 'reference',
          instruction: ref.instruction ?? ''
        }))
      : [],
    segments: Array.isArray(saved.segments)
      ? saved.segments.map((s) => {
          const pendingImageApproval = s.pendingImageApproval
            ? {
                ...s.pendingImageApproval,
                imageAttachments: Array.isArray(s.pendingImageApproval.imageAttachments)
                  ? s.pendingImageApproval.imageAttachments
                  : []
              }
            : undefined

          let imageJobId = s.imageJobId
          if (
            pendingImageApproval &&
            imageJobId === pendingImageApproval.jobId &&
            pendingImageApproval.replacesGenerationId
          ) {
            imageJobId = pendingImageApproval.replacesGenerationId
          }

          return {
            ...s,
            imageJobId,
            characters: Array.isArray(s.characters) ? s.characters : [],
            scriptReferenceIds: Array.isArray(s.scriptReferenceIds) ? s.scriptReferenceIds : undefined,
            status: s.status ?? 'pending',
            scriptMatch: s.scriptMatch ?? null,
            pendingImageApproval,
            sourcePartId: s.sourcePartId,
            sourceClipId: s.sourceClipId
          }
        })
      : [],
    characters: Array.isArray(saved.characters) ? saved.characters : [],
    styleLock: { ...DEFAULT_STYLE_LOCK, ...saved.styleLock },
    pipelineStatus: saved.pipelineStatus ?? 'idle',
    imageModel: resolveImageModelId(saved.imageModel),
    autoExtraDurationSeconds:
      typeof saved.autoExtraDurationSeconds === 'number'
        ? saved.autoExtraDurationSeconds
        : AUTO_EXTRA_DURATION_DEFAULT_SECONDS
  }
}

export function imagesInFlight(state: SegmentPipelineState): boolean {
  return state.segments.some((s) => s.status === 'image_running')
}

export function videosInFlight(state: SegmentPipelineState): boolean {
  return state.segments.some((s) => s.status === 'video_running')
}

export function allSegmentImagesComplete(state: SegmentPipelineState): boolean {
  if (state.segments.length === 0) return false
  if (imagesInFlight(state)) return false
  return state.segments.every((s) => {
    if (s.status === 'failed') return true
    if (s.imageLocalPath) return true
    // Approved pending still counts as image-ready for batch handoff.
    return Boolean(s.pendingImageApproval?.localPath)
  })
}

export function anchorsInFlight(state: SegmentPipelineState): boolean {
  return state.characters.some((c) => c.anchorStatus === 'running')
}

export function segmentsPendingImageApproval(state: SegmentPipelineState): ScriptSegment[] {
  return state.segments.filter((s) => s.pendingImageApproval != null)
}

export function pendingImageSegmentCount(state: SegmentPipelineState): number {
  return state.segments.filter((s) => !s.imageLocalPath && s.status !== 'failed').length
}

export function pendingVideoSegmentCount(state: SegmentPipelineState): number {
  return state.segments.filter((s) => {
    const hasImage =
      Boolean(s.imageLocalPath) || Boolean(s.pendingImageApproval?.localPath)
    return (
      hasImage &&
      !s.videoLocalPath &&
      s.status !== 'failed' &&
      s.status !== 'video_running' &&
      s.status !== 'video_done' &&
      s.status !== 'timeline_placed'
    )
  }).length
}

export function pipelineProgress(state: SegmentPipelineState): PipelineProgress {
  const segments = state.segments
  return {
    totalSegments: segments.length,
    imagesDone: segments.filter(
      (s) =>
        s.status === 'image_done' ||
        s.status === 'image_pending_approval' ||
        s.status === 'video_running' ||
        s.status === 'video_done' ||
        s.status === 'timeline_placed'
    ).length,
    videosDone: segments.filter(
      (s) => s.status === 'video_done' || s.status === 'timeline_placed'
    ).length,
    audioMatchesDone: segments.filter((s) => s.scriptMatch != null).length,
    anchorsDone: state.characters.filter((c) => c.anchorImagePath).length,
    timelinePlaced: segments.filter((s) => s.status === 'timeline_placed').length,
    failed: segments.filter((s) => s.status === 'failed').length
  }
}

/** Normalize project fields including pipeline (avoids circular import in types.ts). */
export function normalizeLoadedGenerationProject(project: GenerationProject): GenerationProject {
  const base = normalizeGenerationProject(project)
  return {
    ...base,
    pipeline: base.pipeline ? normalizePipelineState(base.pipeline) : undefined
  }
}
