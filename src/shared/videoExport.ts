import type { MediaAsset, TimelineClip, TimelineLayer } from './types'
import { clipDurationMs, sequenceDurationMs } from './types'

export interface VideoExportPreset {
  id: string
  label: string
  width: number
  height: number
}

export interface VideoExportOptions {
  width: number
  height: number
  fps: number
  crf: number
  /** Mix embedded audio from clips on video layers. */
  includeVideoLayerAudio: boolean
}

export const VIDEO_EXPORT_PRESETS: VideoExportPreset[] = [
  { id: '1080p-vertical', label: '1080×1920 (9:16)', width: 1080, height: 1920 },
  { id: '1080p', label: '1920×1080 (16:9)', width: 1920, height: 1080 },
  { id: '720p', label: '1280×720 (16:9)', width: 1280, height: 720 },
  { id: '720p-vertical', label: '720×1280 (9:16)', width: 720, height: 1280 }
]

export const VIDEO_EXPORT_QUALITY = [
  { id: 'high', label: 'High quality', crf: 18 },
  { id: 'medium', label: 'Balanced', crf: 23 },
  { id: 'web', label: 'Smaller file', crf: 28 }
] as const

export const DEFAULT_VIDEO_EXPORT_OPTIONS: VideoExportOptions = {
  width: 1080,
  height: 1920,
  fps: 30,
  crf: 20,
  includeVideoLayerAudio: true
}

export interface ExportClipRef {
  clip: TimelineClip
  asset: MediaAsset
  layer: TimelineLayer
}

export function collectVisualClips(
  assets: MediaAsset[],
  layers: TimelineLayer[]
): ExportClipRef[] {
  const assetMap = new Map(assets.map((a) => [a.id, a]))
  const refs: ExportClipRef[] = []

  for (const layer of layers) {
    if (layer.type === 'audio' || layer.muted) continue
    for (const clip of layer.clips) {
      const asset = assetMap.get(clip.assetId)
      if (!asset || asset.type === 'audio') continue
      refs.push({ clip, asset, layer })
    }
  }

  return refs
}

export function collectAudioClips(
  assets: MediaAsset[],
  layers: TimelineLayer[],
  includeVideoLayerAudio: boolean
): ExportClipRef[] {
  const assetMap = new Map(assets.map((a) => [a.id, a]))
  const refs: ExportClipRef[] = []

  for (const layer of layers) {
    if (layer.muted) continue
    for (const clip of layer.clips) {
      const asset = assetMap.get(clip.assetId)
      if (!asset) continue
      if (layer.type === 'audio') {
        if (asset.type === 'audio' || asset.type === 'video') refs.push({ clip, asset, layer })
        continue
      }
      if (
        includeVideoLayerAudio &&
        layer.type === 'video' &&
        asset.type === 'video'
      ) {
        refs.push({ clip, asset, layer })
      }
    }
  }

  return refs
}

export function suggestExportPreset(
  assets: MediaAsset[],
  layers: TimelineLayer[]
): VideoExportPreset {
  const used = new Set<string>()
  for (const layer of layers) {
    for (const clip of layer.clips) used.add(clip.assetId)
  }

  let maxW = 0
  let maxH = 0
  for (const asset of assets) {
    if (!used.has(asset.id)) continue
    maxW = Math.max(maxW, asset.width ?? 0)
    maxH = Math.max(maxH, asset.height ?? 0)
  }

  if (maxH > maxW * 1.05) {
    return VIDEO_EXPORT_PRESETS.find((p) => p.id === '1080p-vertical') ?? VIDEO_EXPORT_PRESETS[0]
  }
  if (maxW > maxH * 1.05) {
    return VIDEO_EXPORT_PRESETS.find((p) => p.id === '1080p') ?? VIDEO_EXPORT_PRESETS[1]
  }
  return VIDEO_EXPORT_PRESETS[0]
}

export function exportDurationMs(layers: TimelineLayer[]): number {
  return sequenceDurationMs(layers)
}
