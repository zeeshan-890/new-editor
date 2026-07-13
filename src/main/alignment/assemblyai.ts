import { existsSync } from 'fs'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import { AssemblyAI } from 'assemblyai'
import { FFMPEG_PATH } from '../audio/ffmpeg-path'
import { normalizeText } from './normalize'
import type { TranscriptSegment } from './matchScript'
import type { TranscriptWordSegment, WhisperTranscriptionResult } from './whisper'
import {
  assemblyAiBaseUrl,
  assemblyAiModelLabel,
  loadAssemblyAiSettings
} from './assemblyaiSettings'

const MIXED_LANGUAGE_PROMPT =
  'Transcribe this. Mixed languages in their own characters.'

const SPEECH_MODELS = ['universal-3-5-pro', 'universal-2'] as const

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

async function trimToWav(
  audioPath: string,
  trimStartMs?: number,
  trimEndMs?: number
): Promise<string> {
  const out = join(
    tmpdir(),
    `aai-align-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`
  )
  const args = ['-y', '-i', audioPath]
  if (typeof trimStartMs === 'number' && trimStartMs > 0) {
    args.push('-ss', (trimStartMs / 1000).toFixed(3))
  }
  if (
    typeof trimStartMs === 'number' &&
    typeof trimEndMs === 'number' &&
    trimEndMs > trimStartMs
  ) {
    args.push('-t', ((trimEndMs - trimStartMs) / 1000).toFixed(3))
  }
  args.push('-ac', '1', '-ar', '16000', out)
  await runCommand(FFMPEG_PATH, args)
  return out
}

function msToSec(ms: number): number {
  return ms / 1000
}

function mapWords(
  words: Array<{ text?: string | null; start?: number | null; end?: number | null }> | null | undefined
): TranscriptWordSegment[] {
  if (!words?.length) return []
  const mapped: TranscriptWordSegment[] = []
  for (const word of words) {
    const text = normalizeText(String(word.text ?? ''))
    const startSec = msToSec(Number(word.start))
    const endSec = msToSec(Number(word.end))
    if (!text || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
      continue
    }
    mapped.push({ text, startSec, endSec })
  }
  return mapped.sort((a, b) => a.startSec - b.startSec)
}

function wordsToChunkSegments(words: TranscriptWordSegment[]): TranscriptSegment[] {
  if (words.length === 0) return []
  const chunks: TranscriptSegment[] = []
  const maxWords = 18
  let buf: TranscriptWordSegment[] = []

  const flush = (): void => {
    if (buf.length === 0) return
    chunks.push({
      text: buf.map((w) => w.text).join(' '),
      startSec: buf[0].startSec,
      endSec: buf[buf.length - 1].endSec
    })
    buf = []
  }

  for (const word of words) {
    buf.push(word)
    const gap =
      buf.length >= 2 ? word.startSec - buf[buf.length - 2].endSec : 0
    const endsSentence = /[.!?。！？]$/.test(word.text)
    if (buf.length >= maxWords || endsSentence || gap > 0.6) {
      flush()
    }
  }
  flush()
  return chunks
}

export async function hasAssemblyAiKey(): Promise<boolean> {
  const settings = await loadAssemblyAiSettings()
  return Boolean(settings.apiKey.trim())
}

export async function transcribeWithAssemblyAi(
  audioPath: string,
  trimStartMs?: number,
  trimEndMs?: number,
  options?: { scriptHint?: string }
): Promise<WhisperTranscriptionResult & { provider: string }> {
  const settings = await loadAssemblyAiSettings()
  const apiKey = settings.apiKey.trim()
  if (!apiKey) {
    throw new Error(
      'AssemblyAI API key is not set. Add it in Pipeline → AssemblyAI settings.'
    )
  }
  if (!existsSync(audioPath)) {
    throw new Error('Audio file was not found on disk.')
  }

  const needsTrim =
    (typeof trimStartMs === 'number' && trimStartMs > 0) ||
    (typeof trimEndMs === 'number' &&
      typeof trimStartMs === 'number' &&
      trimEndMs > trimStartMs)

  let uploadPath = audioPath
  let tempWav: string | null = null
  if (needsTrim) {
    tempWav = await trimToWav(audioPath, trimStartMs, trimEndMs)
    uploadPath = tempWav
  }

  const client = new AssemblyAI({
    apiKey,
    baseUrl: assemblyAiBaseUrl(settings.region)
  })

  try {
    console.log(`[assemblyai] Transcribing with ${assemblyAiModelLabel()} (${settings.region})`)
    // Prefer `prompt` for mixed-language steering. Do not send `keyterms_prompt`
    // in the same request — API treats them as mutually exclusive on some models.
    const transcript = await client.transcripts.transcribe({
      audio: uploadPath,
      speech_models: [...SPEECH_MODELS],
      prompt: options?.scriptHint
        ? `${MIXED_LANGUAGE_PROMPT} Context: ${options.scriptHint.slice(0, 1400)}`
        : MIXED_LANGUAGE_PROMPT
    })

    if (transcript.status === 'error') {
      throw new Error(transcript.error || 'AssemblyAI transcription failed.')
    }

    const wordSegments = mapWords(transcript.words)
    const hasWordTimestamps = wordSegments.length > 0
    let segments = wordsToChunkSegments(wordSegments)

    if (segments.length === 0 && transcript.text?.trim() && wordSegments.length > 0) {
      segments = [
        {
          text: transcript.text.trim(),
          startSec: wordSegments[0].startSec,
          endSec: wordSegments[wordSegments.length - 1].endSec
        }
      ]
    } else if (segments.length === 0 && transcript.text?.trim()) {
      segments = [
        {
          text: transcript.text.trim(),
          startSec: 0,
          endSec: Math.max(0.1, Number(transcript.audio_duration) || 0.1)
        }
      ]
    }

    return {
      segments,
      wordSegments,
      hasWordTimestamps,
      provider: assemblyAiModelLabel()
    }
  } finally {
    if (tempWav) {
      await fs.unlink(tempWav).catch(() => {})
    }
  }
}
