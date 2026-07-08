import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { promises as fs } from 'fs'
import { app } from 'electron'
import { join } from 'path'
import { tmpdir } from 'os'
import { FFMPEG_PATH } from '../audio/ffmpeg-path'
import { spawnablePath } from '../appPaths'
import type { ScriptAudioMatch } from '../../shared/types'
import { matchScriptToTranscript, type TranscriptSegment } from './matchScript'

function whisperBinaryPath(): string {
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  const packaged = join(process.resourcesPath, 'whisper', exe)
  if (existsSync(packaged)) return packaged
  return join(process.cwd(), 'resources', 'whisper', exe)
}

function whisperModelPath(): string {
  const packaged = join(process.resourcesPath, 'whisper', 'ggml-base.en.bin')
  if (existsSync(packaged)) return packaged
  return join(process.cwd(), 'resources', 'whisper', 'ggml-base.en.bin')
}

function runCommand(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr || `Command failed with exit code ${code}`))
    })
  })
}

function parseWhisperSrt(srt: string): TranscriptSegment[] {
  const blocks = srt.split(/\r?\n\r?\n/)
  const segments: TranscriptSegment[] = []
  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/)
    if (lines.length < 3) continue
    const timeLine = lines[1]
    const text = lines.slice(2).join(' ').trim()
    const m = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})/
    )
    if (!m || !text) continue
    const startSec =
      Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
    const endSec = Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000
    segments.push({ text, startSec, endSec })
  }
  return segments
}

async function trimToWav(audioPath: string, trimStartMs?: number, trimEndMs?: number): Promise<string> {
  const out = join(tmpdir(), `script-align-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`)
  const args = ['-y', '-i', audioPath]
  if (typeof trimStartMs === 'number' && trimStartMs > 0) {
    args.push('-ss', (trimStartMs / 1000).toFixed(3))
  }
  if (
    typeof trimEndMs === 'number' &&
    typeof trimStartMs === 'number' &&
    trimEndMs > trimStartMs
  ) {
    args.push('-t', ((trimEndMs - trimStartMs) / 1000).toFixed(3))
  }
  args.push('-ac', '1', '-ar', '16000', out)
  await runCommand(FFMPEG_PATH, args)
  return out
}

export async function alignScriptAudio(
  audioPath: string,
  script: string,
  trimStartMs?: number,
  trimEndMs?: number
): Promise<ScriptAudioMatch> {
  const binary = spawnablePath(whisperBinaryPath())
  const model = whisperModelPath()
  if (!existsSync(binary) || !existsSync(model)) {
    throw new Error('Whisper model is not installed. Add whisper binary/model under resources/whisper.')
  }
  if (!existsSync(audioPath)) {
    throw new Error('Audio file was not found on disk.')
  }

  const wavPath = await trimToWav(audioPath, trimStartMs, trimEndMs)
  const outBase = join(tmpdir(), `script-align-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  try {
    await runCommand(binary, [
      '-m',
      model,
      '-f',
      wavPath,
      '-osrt',
      '-of',
      outBase,
      '-l',
      'en'
    ])
    const srtPath = `${outBase}.srt`
    const srtText = await fs.readFile(srtPath, 'utf-8')
    const segments = parseWhisperSrt(srtText)
    return matchScriptToTranscript(script, segments, trimStartMs ?? 0)
  } finally {
    await fs.unlink(wavPath).catch(() => {})
    await fs.unlink(`${outBase}.srt`).catch(() => {})
    await fs.unlink(`${outBase}.txt`).catch(() => {})
    await fs.unlink(`${outBase}.json`).catch(() => {})
    if (!app.isPackaged) {
      // whisper.cpp can emit extra diagnostics in dev builds.
      await fs.unlink(`${outBase}.vtt`).catch(() => {})
    }
  }
}
