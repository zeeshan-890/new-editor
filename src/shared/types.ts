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
  thresholdDb: -40,
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
