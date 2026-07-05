import { spawn } from 'child_process'
import { mkdir, readdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { FFMPEG_PATH } from '../audio/ffmpeg-path'
import type { VideoFilmstrip } from '../../shared/types'

const FFMPEG = FFMPEG_PATH
const FRAME_WIDTH = 160
const MAX_FRAMES = 40
const MIN_FRAMES = 4

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

export function filmstripForImage(filePath: string, durationMs: number): VideoFilmstrip {
  return {
    durationMs,
    intervalMs: durationMs,
    frameWidth: FRAME_WIDTH,
    frames: [filePath]
  }
}

export async function generateVideoFilmstrip(
  filePath: string,
  durationMs: number
): Promise<VideoFilmstrip> {
  const safeDuration = Math.max(durationMs, 1000)
  const frameCount = Math.min(
    MAX_FRAMES,
    Math.max(MIN_FRAMES, Math.ceil(safeDuration / 2000))
  )
  const intervalMs = safeDuration / frameCount
  const intervalSec = Math.max(0.25, intervalMs / 1000)

  const dir = join(tmpdir(), `filmstrip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await mkdir(dir, { recursive: true })

  const pattern = join(dir, 'frame-%04d.jpg')
  await runFfmpeg([
    '-y',
    '-i',
    filePath,
    '-vf',
    `fps=1/${intervalSec.toFixed(4)},scale=${FRAME_WIDTH}:-1`,
    '-frames:v',
    String(frameCount),
    pattern
  ])

  const files = (await readdir(dir))
    .filter((f) => f.startsWith('frame-') && f.endsWith('.jpg'))
    .sort()
    .map((f) => join(dir, f))

  if (files.length === 0) {
    throw new Error('Could not extract video frames for filmstrip')
  }

  return {
    durationMs: safeDuration,
    intervalMs,
    frameWidth: FRAME_WIDTH,
    frames: files
  }
}
