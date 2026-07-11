import { stat } from 'fs/promises'
import type { TranscriptSegment } from './matchScript'
import type { TranscriptWordSegment } from './whisper'
import { whisperModelLabel } from './whisper'

interface CachedTranscript {
  segments: TranscriptSegment[]
  wordSegments: TranscriptWordSegment[]
  hasWordTimestamps: boolean
  mtimeMs: number
  size: number
  model: string
}

const cache = new Map<string, CachedTranscript>()

function cacheKey(audioPath: string, trimStartMs?: number, trimEndMs?: number): string {
  return `${audioPath}|${trimStartMs ?? 0}|${trimEndMs ?? ''}|${whisperModelLabel()}`
}

async function audioFingerprint(
  audioPath: string
): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const info = await stat(audioPath)
    return { mtimeMs: info.mtimeMs, size: info.size }
  } catch {
    return null
  }
}

export async function getCachedTranscript(
  audioPath: string,
  trimStartMs?: number,
  trimEndMs?: number
): Promise<{
  segments: TranscriptSegment[]
  wordSegments: TranscriptWordSegment[]
  hasWordTimestamps: boolean
} | null> {
  const key = cacheKey(audioPath, trimStartMs, trimEndMs)
  const cached = cache.get(key)
  if (!cached) return null

  const fingerprint = await audioFingerprint(audioPath)
  if (!fingerprint) return null
  if (cached.mtimeMs !== fingerprint.mtimeMs || cached.size !== fingerprint.size) {
    cache.delete(key)
    return null
  }
  if (cached.model !== whisperModelLabel()) {
    cache.delete(key)
    return null
  }

  return {
    segments: cached.segments,
    wordSegments: cached.wordSegments,
    hasWordTimestamps: cached.hasWordTimestamps
  }
}

export async function setCachedTranscript(
  audioPath: string,
  segments: TranscriptSegment[],
  wordSegments: TranscriptWordSegment[],
  hasWordTimestamps: boolean,
  trimStartMs?: number,
  trimEndMs?: number
): Promise<void> {
  const fingerprint = await audioFingerprint(audioPath)
  if (!fingerprint) return

  cache.set(cacheKey(audioPath, trimStartMs, trimEndMs), {
    segments,
    wordSegments,
    hasWordTimestamps,
    mtimeMs: fingerprint.mtimeMs,
    size: fingerprint.size,
    model: whisperModelLabel()
  })
}

export function clearTranscriptCache(): void {
  cache.clear()
}
