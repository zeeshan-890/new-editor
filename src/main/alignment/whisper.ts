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
import { normalizeText } from './normalize'

export interface TranscriptWordSegment extends TranscriptSegment {}

export interface WhisperTranscriptionResult {
  segments: TranscriptSegment[]
  wordSegments: TranscriptWordSegment[]
  hasWordTimestamps: boolean
}

function whisperBinaryPath(): string {
  const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  const releaseSubdir = join('Release', exe)
  const packagedRelease = join(process.resourcesPath, 'whisper', 'Release', exe)
  if (existsSync(packagedRelease)) return packagedRelease
  const packaged = join(process.resourcesPath, 'whisper', exe)
  if (existsSync(packaged)) return packaged
  const devRelease = join(process.cwd(), 'resources', 'whisper', releaseSubdir)
  if (existsSync(devRelease)) return devRelease
  return join(process.cwd(), 'resources', 'whisper', exe)
}

function whisperModelCandidates(): string[] {
  return [
    'ggml-large-v3.bin',
    'ggml-large-v3-turbo.bin',
    'ggml-medium.en.bin',
    'ggml-base.en.bin'
  ]
}

function resolveWhisperModelFile(dir: string): string | null {
  for (const name of whisperModelCandidates()) {
    const full = join(dir, name)
    if (existsSync(full)) return full
  }
  return null
}

/** Preferred Whisper model path (large-v3 when installed). */
export function whisperModelPath(): string {
  const packagedDir = join(process.resourcesPath, 'whisper')
  const packaged = resolveWhisperModelFile(packagedDir)
  if (packaged) return packaged

  const devDir = join(process.cwd(), 'resources', 'whisper')
  const dev = resolveWhisperModelFile(devDir)
  if (dev) return dev

  return join(devDir, 'ggml-large-v3.bin')
}

export function whisperModelLabel(): string {
  return whisperModelPath().split(/[/\\]/).pop() ?? 'unknown'
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

function parseWhisperJsonWordSegments(rawJson: string): TranscriptWordSegment[] {
  const safeParse = (): unknown => {
    try {
      return JSON.parse(rawJson)
    } catch {
      return null
    }
  }
  const parsed = safeParse()
  if (!parsed || typeof parsed !== "object") return []
  const root = parsed as Record<string, unknown>
  const words: TranscriptWordSegment[] = []

  const pushWord = (textLike: unknown, startLike: unknown, endLike: unknown): void => {
    const text = String(textLike ?? '').trim()
    const token = normalizeText(text)
    const startSec = Number(startLike)
    const endSec = Number(endLike)
    if (!token || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return
    words.push({ text: token, startSec, endSec })
  }

  const parseWordArray = (arr: unknown): void => {
    if (!Array.isArray(arr)) return
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      pushWord(
        obj.word ?? obj.text ?? obj.token,
        obj.start ?? obj.start_sec ?? obj.t0 ?? obj.from,
        obj.end ?? obj.end_sec ?? obj.t1 ?? obj.to
      )
    }
  }

  const segments = Array.isArray(root.segments)
    ? root.segments
    : Array.isArray(root.transcription)
      ? root.transcription
      : []

  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') continue
    const seg = segment as Record<string, unknown>
    parseWordArray(seg.words)
    parseWordArray(seg.tokens)
    const offsets = seg.offsets && typeof seg.offsets === 'object'
      ? (seg.offsets as Record<string, unknown>)
      : undefined
    if (words.length === 0) {
      pushWord(seg.text, offsets?.from ?? seg.from ?? seg.t0, offsets?.to ?? seg.to ?? seg.t1)
    }
  }

  parseWordArray(root.words)
  return words.sort((a, b) => a.startSec - b.startSec)
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

export async function transcribeAudioToSegments(
  audioPath: string,
  trimStartMs?: number,
  trimEndMs?: number
): Promise<TranscriptSegment[]> {
  const result = await transcribeAudioWithWords(audioPath, trimStartMs, trimEndMs)
  return result.segments
}

export async function transcribeAudioWithWords(
  audioPath: string,
  trimStartMs?: number,
  trimEndMs?: number
): Promise<WhisperTranscriptionResult> {
  const binary = spawnablePath(whisperBinaryPath())
  const model = whisperModelPath()
  if (!existsSync(binary) || !existsSync(model)) {
    throw new Error(
      'Whisper model is not installed. Run npm run install:whisper (downloads ggml-large-v3.bin), then restart.'
    )
  }
  console.log(`[whisper] Using model ${whisperModelLabel()}`)
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
      '-oj',
      '-of',
      outBase,
      '-l',
      'en'
    ])
    const srtPath = `${outBase}.srt`
    const srtText = await fs.readFile(srtPath, 'utf-8')
    const segments = parseWhisperSrt(srtText)
    const jsonPath = `${outBase}.json`
    const jsonText = await fs.readFile(jsonPath, 'utf-8').catch(() => '')
    let wordSegments = jsonText ? parseWhisperJsonWordSegments(jsonText) : []
    let hasWordTimestamps = wordSegments.length > 0

    if (!hasWordTimestamps && segments.length > 0) {
      wordSegments = segments.flatMap((segment) => {
        const tokens = normalizeText(segment.text).split(/\s+/).filter(Boolean)
        if (tokens.length <= 1) {
          return [{ text: segment.text, startSec: segment.startSec, endSec: segment.endSec }]
        }
        const duration = Math.max(0.05, segment.endSec - segment.startSec)
        const slice = duration / tokens.length
        return tokens.map((token, index) => ({
          text: token,
          startSec: segment.startSec + index * slice,
          endSec: segment.startSec + (index + 1) * slice
        }))
      })
    }

    return { segments, wordSegments, hasWordTimestamps }
  } finally {
    await fs.unlink(wavPath).catch(() => {})
    await fs.unlink(`${outBase}.srt`).catch(() => {})
    await fs.unlink(`${outBase}.txt`).catch(() => {})
    await fs.unlink(`${outBase}.json`).catch(() => {})
    if (!app.isPackaged) {
      await fs.unlink(`${outBase}.vtt`).catch(() => {})
    }
  }
}

export async function alignScriptAudio(
  audioPath: string,
  script: string,
  trimStartMs?: number,
  trimEndMs?: number
): Promise<ScriptAudioMatch> {
  const { segments } = await transcribeAudioWithWords(audioPath, trimStartMs, trimEndMs)
  return matchScriptToTranscript(script, segments, trimStartMs ?? 0)
}
