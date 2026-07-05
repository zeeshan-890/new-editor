import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { FFMPEG_PATH } from './ffmpeg-path'
import type { EditOperation, ExportOptions, ExportResult } from '../../shared/types'

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
      else reject(new Error(stderr || `FFmpeg exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}

export function buildKeepSegments(
  durationMs: number,
  operations: EditOperation[]
): Array<{ startMs: number; endMs: number }> {
  const removeRegions = operations
    .filter((op) => op.type === 'remove')
    .sort((a, b) => a.startMs - b.startMs)

  const keep: Array<{ startMs: number; endMs: number }> = []
  let cursor = 0

  for (const region of removeRegions) {
    const start = Math.max(0, region.startMs)
    const end = Math.min(durationMs, region.endMs)
    if (start > cursor) {
      keep.push({ startMs: cursor, endMs: start })
    }
    cursor = Math.max(cursor, end)
  }

  if (cursor < durationMs) {
    keep.push({ startMs: cursor, endMs: durationMs })
  }

  return keep.filter((s) => s.endMs - s.startMs > 1)
}

export async function exportAudio(
  inputPath: string,
  durationMs: number,
  operations: EditOperation[],
  options: ExportOptions,
  crossfadeMs: number
): Promise<ExportResult> {
  const segments = buildKeepSegments(durationMs, operations)

  if (segments.length === 0) {
    throw new Error('Nothing to export — all audio would be removed')
  }

  const tempDir = join(tmpdir(), `silence-export-${Date.now()}`)
  await fs.mkdir(tempDir, { recursive: true })

  const segmentFiles: string[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const outFile = join(tempDir, `seg-${i}.wav`)
    const startSec = seg.startMs / 1000
    const endSec = seg.endMs / 1000

    await runFfmpeg([
      '-y',
      '-i',
      inputPath,
      '-ss',
      startSec.toFixed(6),
      '-to',
      endSec.toFixed(6),
      '-c:a',
      'pcm_s16le',
      outFile
    ])
    segmentFiles.push(outFile)
  }

  const args = ['-y']

  if (segmentFiles.length === 1) {
    args.push('-i', segmentFiles[0])
  } else {
    const filterParts: string[] = []
    for (let i = 0; i < segmentFiles.length; i++) {
      args.push('-i', segmentFiles[i])
    }

    if (crossfadeMs > 0 && segmentFiles.length > 1) {
      const fadeSec = crossfadeMs / 1000
      let lastLabel = '0:a'
      for (let i = 1; i < segmentFiles.length; i++) {
        const outLabel = i === segmentFiles.length - 1 ? 'outa' : `a${i}`
        filterParts.push(
          `[${lastLabel}][${i}:a]acrossfade=d=${fadeSec.toFixed(3)}:c1=tri:c2=tri[${outLabel}]`
        )
        lastLabel = outLabel
      }
      args.push('-filter_complex', filterParts.join(';'), '-map', '[outa]')
    } else {
      const inputs = segmentFiles.map((_, i) => `[${i}:a]`).join('')
      args.push('-filter_complex', `${inputs}concat=n=${segmentFiles.length}:v=0:a=1[outa]`, '-map', '[outa]')
    }
  }

  const codecMap: Record<string, string[]> = {
    wav: ['-c:a', 'pcm_s16le'],
    flac: ['-c:a', 'flac'],
    mp3: ['-c:a', 'libmp3lame', '-b:a', `${options.bitrateKbps ?? 192}k`]
  }

  if (options.sampleRate) {
    args.push('-ar', String(options.sampleRate))
  }

  args.push(...codecMap[options.format], options.outputPath)

  await runFfmpeg(args)

  for (const f of segmentFiles) {
    await fs.unlink(f).catch(() => {})
  }
  await fs.rmdir(tempDir).catch(() => {})

  const exportedDuration = segments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0)

  return {
    outputPath: options.outputPath,
    durationMs: exportedDuration
  }
}
