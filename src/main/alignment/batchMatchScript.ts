import type { ScriptAudioMatch } from '../../shared/types'
import type { BatchAudioMatchInput, BatchAudioMatchResult } from '../../shared/segmentPipeline'
import { matchScriptToTranscript, type TranscriptSegment } from './matchScript'
import { tokenize } from './normalize'
import { transcribeAudioWithWords, type TranscriptWordSegment } from './transcribe'
import { getCachedTranscript, setCachedTranscript } from './transcriptCache'
import { alignSegmentsByWordTokens } from './wordTokenAlign'
import { probeMediaDurationMs } from '../video/probe'

const LOW_CONFIDENCE = 0.45

async function resolveAudioDurationMs(
  input: BatchAudioMatchInput,
  transcript: TranscriptSegment[],
  audioPath: string
): Promise<number> {
  if (input.audioDurationMs && input.audioDurationMs > 0) return input.audioDurationMs

  const trimStart = input.trimStartMs ?? 0
  const trimEnd = input.trimEndMs
  if (typeof trimEnd === 'number' && trimEnd > trimStart) return trimEnd - trimStart

  if (transcript.length > 0) {
    const fromTranscript = Math.round(transcript[transcript.length - 1].endSec * 1000) + trimStart
    if (fromTranscript > 0) return fromTranscript
  }

  try {
    const probed = await probeMediaDurationMs(audioPath)
    if (probed > 0) return probed
  } catch {
    // fall through
  }

  return 0
}

function sortSegments<T extends { id: string; index?: number }>(
  segments: T[],
  source: T[]
): T[] {
  return [...segments].sort((a, b) => {
    if (typeof a.index === 'number' && typeof b.index === 'number') {
      return a.index - b.index
    }
    return source.findIndex((s) => s.id === a.id) - source.findIndex((s) => s.id === b.id)
  })
}

/**
 * Sequential-only alignment: walk segments in order through word timestamps.
 * No weighted / equal time-splitting fallbacks.
 */
function alignPipelineSegments(
  ordered: Array<{ id: string; scriptText: string }>,
  transcript: TranscriptSegment[],
  wordSegments: TranscriptWordSegment[],
  trimOffsetMs: number,
  warnings: string[],
  hasWordTimestamps: boolean
): Array<{ segmentId: string; match: ScriptAudioMatch }> {
  const words = wordSegments.length > 0 ? wordSegments : transcript

  if (words.length === 0) {
    warnings.push('No transcript words available for sequential timing.')
    return []
  }

  const aligned = alignSegmentsByWordTokens(
    ordered,
    words,
    ordered.map((s) => s.scriptText).join(' '),
    trimOffsetMs,
    'sequential'
  )

  if (aligned && aligned.length === ordered.length) {
    warnings.push(
      hasWordTimestamps
        ? 'Aligned all segments sequentially using word-level timestamps.'
        : 'Aligned all segments sequentially using transcript chunk timings.'
    )
    return aligned
  }

  // Last resort: still sequential over words, one segment at a time via matchScript
  warnings.push('Word-walk incomplete — retrying strict sequential matchScript walk.')
  const matchesById = new Map<string, ScriptAudioMatch>()
  let minStartSec = 0

  for (const segment of ordered) {
    try {
      const matched = matchScriptToTranscript(segment.scriptText, words, {
        trimStartMs: trimOffsetMs,
        minStartSec,
        minConfidence: 0.28
      })
      const startMs = Math.max(0, matched.startMs)
      const endMs = Math.max(startMs + 40, matched.endMs)
      matchesById.set(segment.id, {
        ...matched,
        startMs,
        endMs,
        durationMs: endMs - startMs,
        matchSource: 'sequential',
        confidence: Math.max(matched.confidence, 0.35)
      })
      minStartSec = Math.max(minStartSec, (endMs - trimOffsetMs) / 1000)
    } catch {
      // Assign next available word(s) so every segment still gets a real span
      const remaining = words.filter((w) => w.startSec >= minStartSec - 0.01)
      if (remaining.length === 0) {
        const last = words[words.length - 1]
        const startMs = Math.round(last.startSec * 1000 + trimOffsetMs)
        const endMs = Math.max(startMs + 40, Math.round(last.endSec * 1000 + trimOffsetMs))
        matchesById.set(segment.id, {
          startMs,
          endMs,
          durationMs: endMs - startMs,
          confidence: 0.25,
          matchSource: 'sequential',
          matchedAt: Date.now()
        })
        continue
      }
      const take = Math.max(1, tokenize(segment.scriptText).length)
      const slice = remaining.slice(0, Math.min(take, remaining.length))
      const startMs = Math.round(slice[0].startSec * 1000 + trimOffsetMs)
      const endMs = Math.max(
        startMs + 40,
        Math.round(slice[slice.length - 1].endSec * 1000 + trimOffsetMs)
      )
      matchesById.set(segment.id, {
        startMs,
        endMs,
        durationMs: endMs - startMs,
        confidence: 0.3,
        matchSource: 'sequential',
        matchedAt: Date.now()
      })
      minStartSec = Math.max(minStartSec, (endMs - trimOffsetMs) / 1000)
    }
  }

  // Enforce monotonic order
  const orderedMatches = ordered
    .map((segment) => {
      const match = matchesById.get(segment.id)
      return match ? { segmentId: segment.id, match } : null
    })
    .filter((entry): entry is { segmentId: string; match: ScriptAudioMatch } => entry != null)

  for (let i = 1; i < orderedMatches.length; i++) {
    const prev = orderedMatches[i - 1].match
    const cur = orderedMatches[i].match
    if (cur.startMs < prev.endMs) {
      const startMs = prev.endMs
      const endMs = Math.max(startMs + 40, cur.endMs)
      orderedMatches[i] = {
        ...orderedMatches[i],
        match: { ...cur, startMs, endMs, durationMs: endMs - startMs, matchSource: 'sequential' }
      }
    }
  }

  warnings.push(`Sequentially matched ${orderedMatches.length}/${ordered.length} segments.`)
  return orderedMatches
}

export async function batchMatchScriptAudio(
  input: BatchAudioMatchInput
): Promise<BatchAudioMatchResult> {
  const { audioPath, segments, trimStartMs, trimEndMs } = input
  if (!audioPath) {
    throw new Error('Master audio path is required for batch matching.')
  }
  if (segments.length === 0) {
    throw new Error('No segments to match.')
  }

  let transcript: TranscriptSegment[] = []
  let wordSegments: TranscriptWordSegment[] = []
  let hasWordTimestamps = false

  const cached = await getCachedTranscript(audioPath, trimStartMs, trimEndMs)
  if (cached) {
    transcript = cached.segments
    wordSegments = cached.wordSegments
    hasWordTimestamps = cached.hasWordTimestamps
  } else {
    try {
      const transcribed = await transcribeAudioWithWords(audioPath, trimStartMs, trimEndMs, {
        scriptHint: input.fullScript?.trim() || segments.map((s) => s.scriptText).join(' ')
      })
      transcript = transcribed.segments
      wordSegments = transcribed.wordSegments
      hasWordTimestamps = transcribed.hasWordTimestamps
      await setCachedTranscript(
        audioPath,
        transcript,
        wordSegments,
        hasWordTimestamps,
        trimStartMs,
        trimEndMs
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        matches: [],
        warnings: [message]
      }
    }
  }

  const ordered = sortSegments(segments, segments)
  const trimOffsetMs = trimStartMs ?? 0
  const audioDurationMs = await resolveAudioDurationMs(input, transcript, audioPath)
  const warnings: string[] = []

  if (!hasWordTimestamps && wordSegments.length > 0) {
    warnings.push(
      'Transcript did not include precise word timestamps — using estimated per-word timing from chunks.'
    )
  }

  if (transcript.length === 0 && wordSegments.length === 0) {
    return {
      matches: [],
      warnings: [
        audioDurationMs > 0
          ? 'Transcription produced no text — cannot assign sequential timings.'
          : 'Transcription produced no text from the timeline audio.'
      ]
    }
  }

  const matches = alignPipelineSegments(
    ordered,
    transcript,
    wordSegments,
    trimOffsetMs,
    warnings,
    hasWordTimestamps
  )

  if (matches.length === 0) {
    return {
      matches: [],
      warnings: warnings.length > 0 ? warnings : ['Audio alignment failed.']
    }
  }

  for (const entry of matches) {
    if (entry.match.confidence < LOW_CONFIDENCE) {
      warnings.push(
        `Some segment timings have low confidence (${entry.match.confidence}) — review the pipeline Audio table.`
      )
      break
    }
  }

  return { matches, warnings }
}
