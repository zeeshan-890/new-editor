export type DetectionMode = 'traditional' | 'ai-vad' | 'hybrid'
export type HybridMerge = 'intersection' | 'union'
export type RegionSource = 'traditional' | 'vad' | 'hybrid' | 'manual'
export type EditOperationType = 'keep' | 'remove'

export interface AudioMetadata {
  filePath: string
  fileName: string
  durationMs: number
  sampleRate: number
  channels: number
  previewPath: string
}

export interface PeakLevel {
  samplesPerPeak: number
  min: Float32Array
  max: Float32Array
}

export interface WaveformPeaks {
  levels: PeakLevel[]
}

export interface SilenceRegion {
  id: string
  startMs: number
  endMs: number
  confidence: number
  source: RegionSource
  removed: boolean
}

export interface EditOperation {
  id: string
  type: EditOperationType
  startMs: number
  endMs: number
}

export interface SplitMarker {
  id: string
  timeMs: number
}

export interface DetectionParams {
  mode: DetectionMode
  thresholdDb: number
  minSilenceDurationMs: number
  minSpeechDurationMs: number
  prePaddingMs: number
  postPaddingMs: number
  crossfadeMs: number
  highPassHz: number
  lowPassHz: number
  windowSizeMs: number
  attackMs: number
  releaseMs: number
  vadSensitivity: number
  hybridMerge: HybridMerge
  autoRefresh: boolean
}

export interface ExportOptions {
  outputPath: string
  format: 'wav' | 'mp3' | 'flac'
  bitrateKbps?: number
  sampleRate?: number
}

export interface LoadedAudioProject {
  metadata: AudioMetadata
  peaks: WaveformPeaks
}

export interface DetectionResult {
  regions: SilenceRegion[]
}

export interface ExportResult {
  outputPath: string
  durationMs: number
}

export interface Preset {
  id: string
  name: string
  params: DetectionParams
}

export const DEFAULT_DETECTION_PARAMS: DetectionParams = {
  mode: 'hybrid',
  thresholdDb: -55,
  minSilenceDurationMs: 500,
  minSpeechDurationMs: 250,
  prePaddingMs: 100,
  postPaddingMs: 100,
  crossfadeMs: 20,
  highPassHz: 80,
  lowPassHz: 8000,
  windowSizeMs: 20,
  attackMs: 50,
  releaseMs: 100,
  vadSensitivity: 0.5,
  hybridMerge: 'intersection',
  autoRefresh: true
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export type HiggsfieldModelCategory = 'audio' | 'image' | 'video'

export interface HiggsfieldModel {
  id: string
  name: string
  category: HiggsfieldModelCategory
}

export interface HiggsfieldModelParam {
  name: string
  type: string
  required: boolean
  default?: unknown
  enum?: string[]
}

export interface HiggsfieldModelSchema {
  id: string
  displayName: string
  category: HiggsfieldModelCategory
  params: HiggsfieldModelParam[]
  acceptsPrompt: boolean
  promptRequired: boolean
  imageInput: 'image_url' | 'image' | 'image_references' | null
  minImageReferences: number
}

export interface HiggsfieldVoice {
  id: string
  name: string
  type: 'preset' | 'element'
}

export interface HiggsfieldAccountStatus {
  email?: string
  plan?: string
  credits_available?: number
  credits?: number
}

export interface HiggsfieldWorkspace {
  id: string
  name: string
  planType: string
  credits: number
  isSelected: boolean
  userRole: string
}

export interface HiggsfieldStatus {
  cliAvailable: boolean
  authenticated: boolean
  account: HiggsfieldAccountStatus | null
  cliPath?: string
  statusMessage?: string
  workspaces?: HiggsfieldWorkspace[]
  selectedWorkspace?: HiggsfieldWorkspace | null
}

export interface HiggsfieldGenerateRequest {
  model: string
  prompt: string
  workspaceId?: string
  category?: HiggsfieldModelCategory
  params?: Record<string, string | number | boolean>
  mediaPath?: string
  mediaFlag?: 'audio' | 'video' | 'image' | 'start-image' | 'end-image'
  referencePaths?: string[]
  wait?: boolean
  waitTimeout?: string
  importAudio?: boolean
}

export interface HiggsfieldGenerateResult {
  jobId?: string
  resultUrls: string[]
  localPath?: string
  raw: unknown
}

export interface HiggsfieldGenerationHistoryItem {
  id: string
  model: string
  prompt: string
  createdAt: number
  category: HiggsfieldModelCategory
  resultUrls: string[]
  localPath?: string
}

export interface HiggsfieldVisualGeneration {
  id: string
  historyId: string
  model: string
  prompt: string
  createdAt: number
  url: string
  mediaType: 'image' | 'video'
}

export type HiggsfieldJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface HiggsfieldReferenceImage {
  id: string
  url?: string
  localPath?: string
  label?: string
}

export interface HiggsfieldGenerationJob {
  id: string
  status: HiggsfieldJobStatus
  model: string
  prompt: string
  category: HiggsfieldModelCategory
  workspaceId?: string
  references: HiggsfieldReferenceImage[]
  resultUrls: string[]
  localPath?: string
  error?: string
  progressMessage?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  parentJobId?: string
}

export interface HiggsfieldComposerState {
  prompt: string
  references: HiggsfieldReferenceImage[]
  sourceJobId?: string
}

export interface HiggsfieldEnqueueRequest extends HiggsfieldGenerateRequest {
  category: HiggsfieldModelCategory
  references?: HiggsfieldReferenceImage[]
  parentJobId?: string
  /** Copy reference files into this project's media folder before upload. */
  projectId?: string
}

export const HIGGSFIELD_DRAG_MIME = 'application/x-higgsfield-image'

export type GenerationMode = 'image' | 'video'

export interface ProjectMedia {
  id: string
  localPath: string
  name: string
  /** Remote URL for preview when local path is unavailable in the renderer. */
  previewUrl?: string
}

export interface ProjectGeneration {
  id: string
  type: GenerationMode
  prompt: string
  model: string
  url: string
  localPath?: string
  createdAt: number
  context?: string
  useContextInPrompt?: boolean
  imageAttachments?: ProjectMedia[]
  videoStartFrame?: ProjectMedia | null
  videoDuration?: number
  aspectRatio?: string
}

/** Composer fields saved per mode within a tab (image vs video stay isolated). */
export interface GenerationModeDraft {
  context: string
  useContextInPrompt: boolean
  prompt: string
  model: string
  imageAttachments: ProjectMedia[]
  videoStartFrame: ProjectMedia | null
  videoDuration: number
  aspectRatio: string
}

export interface TabComposerState {
  activeMode: GenerationMode
  image: GenerationModeDraft
  video: GenerationModeDraft
  selectedGenerationId: string | null
}

export interface GenerationComposerSnapshot {
  type: GenerationMode
  context: string
  useContextInPrompt: boolean
  prompt: string
  model: string
  imageAttachments: ProjectMedia[]
  videoStartFrame: ProjectMedia | null
  videoDuration: number
  aspectRatio: string
}

export interface GenerationProject {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  mode: GenerationMode
  context: string
  useContextInPrompt: boolean
  prompt: string
  selectedImageModel: string
  selectedVideoModel: string
  imageAttachments: ProjectMedia[]
  videoStartFrame: ProjectMedia | null
  videoDuration: number
  generations: ProjectGeneration[]
  /** Timeline state for this project's video editor tab. */
  videoEditor?: VideoEditorProject
  workspaceId?: string
}

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: number
  generationCount: number
  mode: GenerationMode
}

export type AppTabKind = 'generation' | 'editor'

export interface AppTab {
  id: string
  kind: AppTabKind
  title: string
  projectId?: string
}

export interface AppSession {
  tabs: AppTab[]
  activeTabId: string
  tabDrafts?: Record<string, TabComposerState>
  /** Bumped when one-time session migrations run. */
  sessionVersion?: number
}

/** Increment when tab draft migrations are required on load. */
export const APP_SESSION_VERSION = 3

export const DEFAULT_IMAGE_MODEL = 'nano_banana_2'
export const DEFAULT_VIDEO_MODEL = 'kling3_0'
export const DEFAULT_ASPECT_RATIO = '9:16'

export const IMAGE_ASPECT_RATIOS = [
  '9:16',
  '16:9',
  '1:1',
  '4:5',
  '5:4',
  '3:4',
  '4:3',
  '2:3',
  '3:2',
  '21:9'
] as const

export const VIDEO_ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const

export type MediaAssetType = 'video' | 'image' | 'audio'

export interface MediaAsset {
  id: string
  path: string
  name: string
  type: MediaAssetType
  durationMs: number
  width?: number
  height?: number
}

/** Thumbnail sequence for video/image clips on the timeline. */
export interface VideoFilmstrip {
  durationMs: number
  intervalMs: number
  frameWidth: number
  frames: string[]
}

export interface TimelineMarker {
  id: string
  timeMs: number
  label?: string
}

export interface TimelineClip {
  id: string
  assetId: string
  layerId: string
  timelineStartMs: number
  sourceInMs: number
  sourceOutMs: number
}

export interface TimelineLayer {
  id: string
  name: string
  type: 'video' | 'audio' | 'overlay'
  clips: TimelineClip[]
  locked?: boolean
  muted?: boolean
}

export interface VideoEditorProject {
  id: string
  name: string
  assets: MediaAsset[]
  layers: TimelineLayer[]
  markers: TimelineMarker[]
  selectedClipId: string | null
  selectedLayerId: string | null
}

export const VIDEO_EDITOR_FPS = 30
export const VIDEO_EDITOR_FRAME_MS = 1000 / VIDEO_EDITOR_FPS
export const VIDEO_EDITOR_MULTI_FRAME_STEP = 10

export function createEmptyVideoEditorProject(name = 'Untitled sequence'): VideoEditorProject {
  const videoLayerId = generateId()
  const audioLayerId = generateId()
  return {
    id: generateId(),
    name,
    assets: [],
    layers: [
      { id: videoLayerId, name: 'Video 1', type: 'video', clips: [] },
      { id: audioLayerId, name: 'Audio 1', type: 'audio', clips: [] }
    ],
    markers: [],
    selectedClipId: null,
    selectedLayerId: videoLayerId
  }
}

export function clipDurationMs(clip: TimelineClip): number {
  return Math.max(0, clip.sourceOutMs - clip.sourceInMs)
}

export function sequenceDurationMs(layers: TimelineLayer[]): number {
  let max = 0
  for (const layer of layers) {
    for (const clip of layer.clips) {
      max = Math.max(max, clip.timelineStartMs + clipDurationMs(clip))
    }
  }
  return Math.max(max, 1000)
}

export function createEmptyModeDraft(mode: GenerationMode): GenerationModeDraft {
  return {
    context: '',
    useContextInPrompt: true,
    prompt: '',
    model: mode === 'image' ? DEFAULT_IMAGE_MODEL : DEFAULT_VIDEO_MODEL,
    imageAttachments: [],
    videoStartFrame: null,
    videoDuration: 5,
    aspectRatio: DEFAULT_ASPECT_RATIO
  }
}

export function createEmptyTabComposerState(): TabComposerState {
  return {
    activeMode: 'image',
    image: createEmptyModeDraft('image'),
    video: createEmptyModeDraft('video'),
    selectedGenerationId: null
  }
}

export function activeModeDraft(state: TabComposerState): GenerationModeDraft {
  const empty = createEmptyTabComposerState()
  if (state.activeMode === 'video') {
    return state.video ?? empty.video
  }
  return state.image ?? empty.image
}

export function normalizeTabComposerState(state: TabComposerState | undefined): TabComposerState {
  const empty = createEmptyTabComposerState()
  if (!state) return empty
  return {
    activeMode: state.activeMode === 'video' ? 'video' : 'image',
    selectedGenerationId: state.selectedGenerationId ?? null,
    video: {
      ...empty.video,
      ...state.video,
      videoStartFrame: state.video?.videoStartFrame ?? null,
      aspectRatio: state.video?.aspectRatio ?? DEFAULT_ASPECT_RATIO
    },
    image: {
      ...empty.image,
      ...state.image,
      imageAttachments: state.image?.imageAttachments ?? [],
      aspectRatio: state.image?.aspectRatio ?? DEFAULT_ASPECT_RATIO
    }
  }
}

export function normalizeVideoEditorProject(
  saved: Partial<VideoEditorProject> | undefined,
  name = 'Untitled sequence'
): VideoEditorProject {
  const empty = createEmptyVideoEditorProject(name)
  if (!saved) return empty
  const layers =
    Array.isArray(saved.layers) && saved.layers.length > 0
      ? saved.layers.map((layer) => ({
          ...layer,
          clips: Array.isArray(layer.clips) ? layer.clips : []
        }))
      : empty.layers
  return {
    ...empty,
    ...saved,
    id: saved.id || empty.id,
    name: saved.name || name,
    assets: Array.isArray(saved.assets) ? saved.assets : [],
    markers: Array.isArray(saved.markers) ? saved.markers : [],
    layers,
    selectedClipId: saved.selectedClipId ?? null,
    selectedLayerId: saved.selectedLayerId ?? layers[0]?.id ?? null
  }
}

export function normalizeGenerationProject(project: GenerationProject): GenerationProject {
  const empty = createEmptyGenerationProject(project.name)
  return {
    ...empty,
    ...project,
    generations: Array.isArray(project.generations) ? project.generations : [],
    imageAttachments: Array.isArray(project.imageAttachments) ? project.imageAttachments : [],
    videoStartFrame: project.videoStartFrame ?? null,
    videoDuration: project.videoDuration ?? empty.videoDuration,
    videoEditor: project.videoEditor
      ? normalizeVideoEditorProject(project.videoEditor, project.name)
      : undefined
  }
}

export { generationToModeDraft, buildEffectivePrompt } from './imageGeneration'

export function createEmptyGenerationProject(name?: string): GenerationProject {
  const now = Date.now()
  return {
    id: generateId(),
    name: name ?? `Project ${new Date(now).toLocaleDateString()}`,
    createdAt: now,
    updatedAt: now,
    mode: 'image',
    context: '',
    useContextInPrompt: true,
    prompt: '',
    selectedImageModel: DEFAULT_IMAGE_MODEL,
    selectedVideoModel: DEFAULT_VIDEO_MODEL,
    imageAttachments: [],
    videoStartFrame: null,
    videoDuration: 5,
    generations: []
  }
}
