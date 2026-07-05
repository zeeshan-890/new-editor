import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { FFMPEG_PATH } from '../audio/ffmpeg-path'
import type { MediaAsset, TimelineClip, TimelineLayer } from '../../shared/types'
import { clipDurationMs } from '../../shared/types'

const FFMPEG = FFMPEG_PATH

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.slice(-2000) || `FFmpeg exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}

export async function exportVideoSequence(
  assets: MediaAsset[],
  layers: TimelineLayer[],
  outputPath: string
): Promise<{ outputPath: string; durationMs: number }> {
  const videoLayer = layers.find((l) => l.type === 'video') ?? layers[0]
  if (!videoLayer || videoLayer.clips.length === 0) {
    throw new Error('No clips on the timeline to export')
  }

  const assetMap = new Map(assets.map((a) => [a.id, a]))
  const sorted = [...videoLayer.clips].sort((a, b) => a.timelineStartMs - b.timelineStartMs)
  const tempDir = join(tmpdir(), `video-export-${Date.now()}`)
  await fs.mkdir(tempDir, { recursive: true })

  const segmentFiles: string[] = []
  let totalMs = 0

  for (let i = 0; i < sorted.length; i++) {
    const clip = sorted[i]
    const asset = assetMap.get(clip.assetId)
    if (!asset) continue

    const segFile = join(tempDir, `seg-${i}.mp4`)
    const startSec = clip.sourceInMs / 1000
    const durationSec = clipDurationMs(clip) / 1000

    if (asset.type === 'image') {
      await runFfmpeg([
        '-y',
        '-loop',
        '1',
        '-i',
        asset.path,
        '-t',
        String(durationSec),
        '-vf',
        'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        segFile
      ])
    } else {
      await runFfmpeg([
        '-y',
        '-ss',
        String(startSec),
        '-i',
        asset.path,
        '-t',
        String(durationSec),
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        '-pix_fmt',
        'yuv420p',
        segFile
      ])
    }

    segmentFiles.push(segFile)
    totalMs += clipDurationMs(clip)
  }

  if (segmentFiles.length === 0) {
    throw new Error('No valid clips to export')
  }

  if (segmentFiles.length === 1) {
    await fs.copyFile(segmentFiles[0], outputPath)
  } else {
    const listFile = join(tempDir, 'concat.txt')
    const listContent = segmentFiles.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n')
    await fs.writeFile(listFile, listContent, 'utf-8')
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath])
  }

  for (const file of segmentFiles) {
    await fs.unlink(file).catch(() => {})
  }
  await fs.rmdir(tempDir).catch(() => {})

  return { outputPath, durationMs: totalMs }
}
