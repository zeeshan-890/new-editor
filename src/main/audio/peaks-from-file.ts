import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FFMPEG_PATH } from './ffmpeg-path'
import { generatePeaksFromPcm } from './peaks'
import { serializePeaks } from './decode'
import type { WaveformPeaks } from '../../shared/types'

const FFMPEG = FFMPEG_PATH
const SAMPLE_RATE = 44100

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

export async function generatePeaksFromAudioFile(
  filePath: string
): Promise<{ sampleRate: number; peaks: WaveformPeaks }> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const pcmPath = join(tmpdir(), `waveform-${id}.raw`)

  try {
    await runFfmpeg([
      '-y',
      '-i',
      filePath,
      '-ac',
      '1',
      '-ar',
      String(SAMPLE_RATE),
      '-f',
      'f32le',
      pcmPath
    ])

    const buffer = await fs.readFile(pcmPath)
    const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
    const peaks = generatePeaksFromPcm(samples, [256, 1024, 4096, 16384])

    return { sampleRate: SAMPLE_RATE, peaks: serializePeaks(peaks) }
  } finally {
    await fs.unlink(pcmPath).catch(() => {})
  }
}
