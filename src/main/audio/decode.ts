import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join, extname, basename } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import type { AudioMetadata, WaveformPeaks } from '../../shared/types'
import { generatePeaksFromPcm } from './peaks'

const FFMPEG = ffmpegStatic as string

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr || `FFmpeg exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-i', filePath, '-f', 'null', '-'], { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('close', () => {
      const match = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/)
      if (!match) {
        reject(new Error('Could not determine audio duration'))
        return
      }
      const hours = parseInt(match[1], 10)
      const minutes = parseInt(match[2], 10)
      const seconds = parseFloat(match[3])
      resolve((hours * 3600 + minutes * 60 + seconds) * 1000)
    })
    proc.on('error', reject)
  })
}

export async function decodeAudio(filePath: string): Promise<{
  metadata: AudioMetadata
  peaks: WaveformPeaks
  pcmPath: string
}> {
  const sampleRate = 44100
  const channels = 1
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const pcmPath = join(tmpdir(), `silence-editor-${id}.raw`)
  const previewPath = join(tmpdir(), `silence-editor-${id}.wav`)

  await runFfmpeg([
    '-y',
    '-i',
    filePath,
    '-ac',
    '1',
    '-ar',
    String(sampleRate),
    '-f',
    'f32le',
    pcmPath
  ])

  await runFfmpeg([
    '-y',
    '-i',
    filePath,
    '-ac',
    '1',
    '-ar',
    String(sampleRate),
    '-c:a',
    'pcm_s16le',
    previewPath
  ])

  const buffer = await fs.readFile(pcmPath)
  const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
  const durationMs = (samples.length / sampleRate) * 1000

  const peaks = generatePeaksFromPcm(samples, [512, 2048, 8192])

  const metadata: AudioMetadata = {
    filePath,
    fileName: basename(filePath),
    durationMs: durationMs || (await probeDuration(filePath)),
    sampleRate,
    channels,
    previewPath
  }

  return { metadata, peaks, pcmPath }
}

export async function cleanupTempFile(path: string): Promise<void> {
  try {
    await fs.unlink(path)
  } catch {
    // ignore
  }
}

export function serializePeaks(peaks: WaveformPeaks): WaveformPeaks {
  return {
    levels: peaks.levels.map((level) => ({
      samplesPerPeak: level.samplesPerPeak,
      min: level.min,
      max: level.max
    }))
  }
}

export function getPreviewExtension(filePath: string): string {
  return extname(filePath).toLowerCase()
}
