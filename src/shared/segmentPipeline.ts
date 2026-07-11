import type { ScriptAudioMatch } from './types'
import {
  AUTO_EXTRA_DURATION_DEFAULT_SECONDS,
  DEFAULT_ASPECT_RATIO,
  generateId,
  normalizeGenerationProject,
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

export interface SegmentPipelineState {
  fullScript: string
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

export interface LlmAnalyzeSegmentInput {
  index: number
  scriptText: string
  imagePrompt: string
  videoMotionPrompt?: string
  characters: string[]
  continuityFromPrevious: boolean
  /** Ids from scriptReferences to attach when generating this segment's image. */
  referenceIds?: string[]
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

export const DEFAULT_STYLE_LOCK: StyleLock = {
  aspectRatio: DEFAULT_ASPECT_RATIO,
  visualStyle: 'cinematic realism, natural lighting'
}

export function createEmptyPipelineState(): SegmentPipelineState {
  return {
    fullScript: '',
    creativeInstructions: '',
    scriptReferences: [],
    segments: [],
    characters: [],
    styleLock: { ...DEFAULT_STYLE_LOCK },
    pipelineStatus: 'idle',
    autoExtraDurationSeconds: AUTO_EXTRA_DURATION_DEFAULT_SECONDS
  }
}

export function createSegmentFromAnalysis(
  input: LlmAnalyzeSegmentInput,
  characterIds: Set<string>,
  scriptReferenceIds?: Set<string>
): ScriptSegment {
  const referenceIds = input.referenceIds
    ?.map((id) => id.trim())
    .filter((id) => id && (!scriptReferenceIds || scriptReferenceIds.has(id)))

  return {
    id: generateId(),
    index: input.index,
    scriptText: input.scriptText.trim(),
    imagePrompt: input.imagePrompt.trim(),
    videoMotionPrompt: input.videoMotionPrompt?.trim(),
    characters: input.characters.filter((id) => characterIds.has(id)),
    continuityFromPrevious: Boolean(input.continuityFromPrevious),
    scriptReferenceIds: referenceIds?.length ? referenceIds : undefined,
    status: 'pending'
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
            pendingImageApproval
          }
        })
      : [],
    characters: Array.isArray(saved.characters) ? saved.characters : [],
    styleLock: { ...DEFAULT_STYLE_LOCK, ...saved.styleLock },
    pipelineStatus: saved.pipelineStatus ?? 'idle',
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
  return state.segments.every((s) => Boolean(s.imageLocalPath) || s.status === 'failed')
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
  return state.segments.filter(
    (s) =>
      Boolean(s.imageLocalPath) &&
      !s.videoLocalPath &&
      s.status !== 'failed' &&
      s.status !== 'video_running' &&
      s.status !== 'video_done' &&
      s.status !== 'timeline_placed'
  ).length
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
