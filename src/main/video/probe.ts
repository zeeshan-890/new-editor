import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { extname, basename } from 'path'
import { FFMPEG_PATH } from '../audio/ffmpeg-path'
import { parseFfmpegDurationMs } from '../media/duration'
import type { MediaAsset, MediaAssetType } from '../../shared/types'

const FFMPEG = FFMPEG_PATH

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.m4a', '.ogg', '.aac'])

function detectType(filePath: string): MediaAssetType {
  const ext = extname(filePath).toLowerCase()
  if (VIDEO_EXT.has(ext)) return 'video'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (AUDIO_EXT.has(ext)) return 'audio'
  return 'video'
}

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-i', filePath, '-f', 'null', '-'], { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    proc.on('close', () => {
      const durationMs = parseFfmpegDurationMs(stderr)
      if (durationMs == null) {
        resolve(5000)
        return
      }
      resolve(durationMs)
    })
    proc.on('error', reject)
  })
}

function probeResolution(filePath: string): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-i', filePath, '-f', 'null', '-'], { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    proc.on('close', () => {
      const match = stderr.match(/,\s*(\d{2,5})x(\d{2,5})/)
      if (!match) {
        resolve({})
        return
      }
      resolve({ width: parseInt(match[1], 10), height: parseInt(match[2], 10) })
    })
    proc.on('error', () => resolve({}))
  })
}

export async function probeMediaFile(filePath: string): Promise<Omit<MediaAsset, 'id'>> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const type = detectType(filePath)
  const name = basename(filePath)

  if (type === 'image') {
    const { width, height } = await probeResolution(filePath)
    return { path: filePath, name, type, durationMs: 5000, width, height }
  }

  const [durationMs, resolution] = await Promise.all([
    probeDuration(filePath),
    probeResolution(filePath)
  ])

  return {
    path: filePath,
    name,
    type,
    durationMs: Math.max(durationMs, 100),
    ...resolution
  }
}
