import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { extname } from 'path'
import { FFMPEG_PATH } from '../audio/ffmpeg-path'
import type { MediaAsset, TimelineClip, TimelineLayer } from '../../shared/types'
import { clipDurationMs, sequenceDurationMs } from '../../shared/types'
import type { VideoExportOptions } from '../../shared/videoExport'
import {
  collectAudioClips,
  collectVisualClips,
  DEFAULT_VIDEO_EXPORT_OPTIONS
} from '../../shared/videoExport'

const FFMPEG = FFMPEG_PATH

function ensureMp4OutputPath(outputPath: string): string {
  const ext = extname(outputPath).toLowerCase()
  if (ext === '.mp4') return outputPath
  const stem = ext ? outputPath.slice(0, -ext.length) : outputPath
  return `${stem}.mp4`
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.slice(-4000) || `FFmpeg exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}

function probeHasAudio(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-i', filePath], { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('close', () => resolve(/\n  Stream #\d+:\d+.* Audio:/i.test(stderr)))
    proc.on('error', () => resolve(false))
  })
}

function scalePadFilter(width: number, height: number, fps: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p`
}

function buildVisualInputArgs(
  asset: MediaAsset,
  clip: TimelineClip
): { args: string[]; hasVideo: boolean } {
  const durationSec = clipDurationMs(clip) / 1000
  const startSec = clip.sourceInMs / 1000

  if (asset.type === 'image') {
    return {
      hasVideo: true,
      args: ['-loop', '1', '-t', String(durationSec), '-i', asset.path]
    }
  }

  return {
    hasVideo: true,
    args: ['-ss', String(startSec), '-t', String(durationSec), '-i', asset.path]
  }
}

function buildAudioInputArgs(
  asset: MediaAsset,
  clip: TimelineClip
): string[] {
  const durationSec = clipDurationMs(clip) / 1000
  const startSec = clip.sourceInMs / 1000
  return ['-ss', String(startSec), '-t', String(durationSec), '-i', asset.path]
}

export async function exportVideoSequence(
  assets: MediaAsset[],
  layers: TimelineLayer[],
  outputPath: string,
  options: VideoExportOptions = DEFAULT_VIDEO_EXPORT_OPTIONS
): Promise<{ outputPath: string; durationMs: number }> {
  const mp4OutputPath = ensureMp4OutputPath(outputPath)
  const durationMs = sequenceDurationMs(layers)
  const durationSec = Math.max(durationMs / 1000, 0.1)
  const { width, height, fps, crf, includeVideoLayerAudio } = options

  const visualClips = collectVisualClips(assets, layers)
  const audioClipCandidates = collectAudioClips(assets, layers, includeVideoLayerAudio)

  if (visualClips.length === 0 && audioClipCandidates.length === 0) {
    throw new Error('Nothing on the timeline to export. Add clips first.')
  }

  for (const { asset } of [...visualClips, ...audioClipCandidates]) {
    if (!existsSync(asset.path)) {
      throw new Error(`Missing media file: ${asset.name}`)
    }
  }

  const audioClips: typeof audioClipCandidates = []
  for (const ref of audioClipCandidates) {
    if (ref.asset.type === 'audio' || (await probeHasAudio(ref.asset.path))) {
      audioClips.push(ref)
    }
  }

  const args: string[] = ['-y']
  const filters: string[] = []

  args.push(
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${width}x${height}:d=${durationSec.toFixed(3)}:r=${fps}`
  )

  let inputIndex = 1
  let videoLabel = '0:v'

  for (let i = 0; i < visualClips.length; i++) {
    const { clip, asset } = visualClips[i]
    const clipStart = clip.timelineStartMs / 1000
    const clipEnd = (clip.timelineStartMs + clipDurationMs(clip)) / 1000
    const { args: clipArgs } = buildVisualInputArgs(asset, clip)
    args.push(...clipArgs)

    const srcLabel = `vs${i}`
    const outLabel = i === visualClips.length - 1 ? 'vout' : `vx${i}`
    filters.push(
      `[${inputIndex}:v]${scalePadFilter(width, height, fps)}[${srcLabel}]`
    )
    filters.push(
      `[${videoLabel}][${srcLabel}]overlay=0:0:enable='between(t,${clipStart.toFixed(3)},${clipEnd.toFixed(3)})'[${outLabel}]`
    )
    videoLabel = outLabel
    inputIndex++
  }

  if (visualClips.length === 0) {
    filters.push(`[0:v]${scalePadFilter(width, height, fps)}[vout]`)
  }

  let audioOutLabel: string | null = null

  for (let i = 0; i < audioClips.length; i++) {
    const { clip, asset } = audioClips[i]
    args.push(...buildAudioInputArgs(asset, clip))
    const delayMs = Math.round(clip.timelineStartMs)
    const aLabel = `a${i}`
    filters.push(
      `[${inputIndex}:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[${aLabel}]`
    )
    inputIndex++
  }

  if (audioClips.length === 1) {
    audioOutLabel = 'a0'
  } else if (audioClips.length > 1) {
    const mixInputs = audioClips.map((_, i) => `[a${i}]`).join('')
    filters.push(`${mixInputs}amix=inputs=${audioClips.length}:duration=longest:dropout_transition=0[aout]`)
    audioOutLabel = 'aout'
  }

  if (filters.length > 0) {
    args.push('-filter_complex', filters.join(';'))
  }

  args.push('-map', '[vout]')
  if (audioOutLabel) {
    args.push('-map', `[${audioOutLabel}]`)
  } else {
    args.push('-an')
  }

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart'
  )

  if (audioOutLabel) {
    args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000')
  }

  args.push('-f', 'mp4', '-t', durationSec.toFixed(3), mp4OutputPath)

  try {
    await runFfmpeg(args)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (audioClips.length > 0 && message.includes('Stream specifier')) {
      throw new Error('Could not mix timeline audio. Try muting empty audio layers and export again.')
    }
    throw err
  }

  return { outputPath: mp4OutputPath, durationMs }
}

function codecArgsForAudioExport(outputPath: string): string[] {
  const ext = extname(outputPath).toLowerCase()
  switch (ext) {
    case '.mp3':
      return ['-c:a', 'libmp3lame', '-b:a', '192k']
    case '.flac':
      return ['-c:a', 'flac']
    case '.wav':
    default:
      return ['-c:a', 'pcm_s16le']
  }
}

/** Mix audio-layer timeline clips (respects splits, silence edits, clip positions). */
export async function exportTimelineAudioMix(
  assets: MediaAsset[],
  layers: TimelineLayer[],
  outputPath: string
): Promise<{ outputPath: string; durationMs: number }> {
  const durationMs = sequenceDurationMs(layers)
  const durationSec = Math.max(durationMs / 1000, 0.1)
  const audioClipCandidates = collectAudioClips(assets, layers, false)

  if (audioClipCandidates.length === 0) {
    throw new Error('No audio clips on the video editor timeline. Add and edit audio in the editor first.')
  }

  for (const { asset } of audioClipCandidates) {
    if (!existsSync(asset.path)) {
      throw new Error(`Missing media file: ${asset.name}`)
    }
  }

  const audioClips: typeof audioClipCandidates = []
  for (const ref of audioClipCandidates) {
    if (ref.asset.type === 'audio' || (await probeHasAudio(ref.asset.path))) {
      audioClips.push(ref)
    }
  }

  if (audioClips.length === 0) {
    throw new Error('Timeline audio clips have no decodable audio streams.')
  }

  const args: string[] = ['-y']
  const filters: string[] = []
  let inputIndex = 0

  for (let i = 0; i < audioClips.length; i++) {
    const { clip, asset } = audioClips[i]
    args.push(...buildAudioInputArgs(asset, clip))
    const delayMs = Math.round(clip.timelineStartMs)
    const aLabel = `a${i}`
    filters.push(
      `[${inputIndex}:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[${aLabel}]`
    )
    inputIndex++
  }

  let audioOutLabel: string
  if (audioClips.length === 1) {
    audioOutLabel = 'a0'
  } else {
    const mixInputs = audioClips.map((_, i) => `[a${i}]`).join('')
    filters.push(
      `${mixInputs}amix=inputs=${audioClips.length}:duration=longest:dropout_transition=0[aout]`
    )
    audioOutLabel = 'aout'
  }

  args.push('-filter_complex', filters.join(';'))
  args.push('-map', `[${audioOutLabel}]`)
  args.push('-ar', '48000', '-ac', '2', ...codecArgsForAudioExport(outputPath), '-t', durationSec.toFixed(3), outputPath)

  try {
    await runFfmpeg(args)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      message.includes('Stream specifier')
        ? 'Could not mix timeline audio. Check audio clips on the timeline and try again.'
        : message
    )
  }

  return { outputPath, durationMs }
}
