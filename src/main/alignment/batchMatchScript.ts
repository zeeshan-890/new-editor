import type { ScriptAudioMatch } from '../../shared/types'
import type { BatchAudioMatchInput, BatchAudioMatchResult } from '../../shared/segmentPipeline'
import { matchScriptToTranscript, type TranscriptSegment } from './matchScript'
import { tokenize } from './normalize'
import { transcribeAudioWithWords, type TranscriptWordSegment } from './whisper'
import { getCachedTranscript, setCachedTranscript } from './transcriptCache'
import { alignSegmentsByWordTokens } from './wordTokenAlign'
import { probeMediaDurationMs } from '../video/probe'

const LOW_CONFIDENCE = 0.65

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

function narrationSpanMs(
  transcript: TranscriptSegment[],
  trimOffsetMs: number
): { startMs: number; endMs: number } {
  if (transcript.length === 0) {
    return { startMs: trimOffsetMs, endMs: trimOffsetMs }
  }
  return {
    startMs: Math.round(transcript[0].startSec * 1000) + trimOffsetMs,
    endMs: Math.round(transcript[transcript.length - 1].endSec * 1000) + trimOffsetMs
  }
}

function buildProportionalMatches(
  segments: Array<{ id: string; scriptText: string }>,
  startMs: number,
  durationMs: number,
  confidence = 0.15,
  source: ScriptAudioMatch['matchSource'] = 'equal-fallback'
): Array<{ segmentId: string; match: ScriptAudioMatch }> {
  if (segments.length === 0 || durationMs <= 0) return []
  const slice = durationMs / segments.length
  const now = Date.now()
  return segments.map((segment, index) => {
    const segStart = Math.round(startMs + index * slice)
    const segEnd = Math.round(startMs + (index + 1) * slice)
    return {
      segmentId: segment.id,
      match: {
        startMs: segStart,
        endMs: Math.max(segStart + 1, segEnd),
        durationMs: Math.max(1, segEnd - segStart),
        confidence,
        matchSource: source,
        matchedAt: now
      }
    }
  })
}

function distributeByScriptWeight(
  segments: Array<{ id: string; scriptText: string }>,
  startMs: number,
  endMs: number,
  confidence = 0.35,
  source: ScriptAudioMatch['matchSource'] = 'weighted-fallback'
): Array<{ segmentId: string; match: ScriptAudioMatch }> {
  const weights = segments.map((segment) => Math.max(tokenize(segment.scriptText).length, 1))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const totalMs = Math.max(1, endMs - startMs)
  const now = Date.now()
  let cursor = startMs

  return segments.map((segment, index) => {
    const isLast = index === segments.length - 1
    const slice = isLast
      ? endMs - cursor
      : Math.round((weights[index] / totalWeight) * totalMs)
    const segStart = cursor
    const segEnd = isLast ? endMs : Math.min(endMs, cursor + Math.max(1, slice))
    cursor = segEnd
    return {
      segmentId: segment.id,
      match: {
        startMs: segStart,
        endMs: Math.max(segStart + 1, segEnd),
        durationMs: Math.max(1, segEnd - segStart),
        confidence,
        matchSource: source,
        matchedAt: now
      }
    }
  })
}

function fillMissingMatchesByWeight(
  ordered: Array<{ id: string; scriptText: string }>,
  matchesById: Map<string, ScriptAudioMatch>,
  startMs: number,
  endMs: number,
  confidence: number
): void {
  const missing = ordered.filter((segment) => !matchesById.has(segment.id))
  if (missing.length === 0 || endMs <= startMs) return
  const fallback = distributeByScriptWeight(
    missing,
    startMs,
    endMs,
    confidence,
    'weighted-fallback'
  )
  for (const entry of fallback) {
    matchesById.set(entry.segmentId, entry.match)
  }
}

function adaptiveMinConfidence(scriptText: string): number {
  const tokens = Math.max(1, tokenize(scriptText).length)
  if (tokens <= 4) return 0.35
  if (tokens <= 8) return 0.42
  if (tokens <= 14) return 0.5
  return 0.58
}

function expectedSegmentDurationMs(
  segmentText: string,
  fullScript: string,
  windowDurationMs: number
): number {
  const segTokens = Math.max(1, tokenize(segmentText).length)
  const fullTokens = Math.max(segTokens, tokenize(fullScript).length)
  return Math.max(800, Math.round((segTokens / fullTokens) * windowDurationMs))
}

function capImplausibleSegmentWindow(
  segment: { scriptText: string },
  match: ScriptAudioMatch,
  fullScript: string,
  windowDurationMs: number
): ScriptAudioMatch {
  const expectedMs = expectedSegmentDurationMs(segment.scriptText, fullScript, windowDurationMs)
  const maxMs = Math.max(1400, Math.round(expectedMs * 3.5))
  if (match.durationMs <= maxMs) return match

  const center = Math.round((match.startMs + match.endMs) / 2)
  const startMs = Math.max(0, center - Math.round(maxMs / 2))
  const endMs = startMs + maxMs
  return {
    ...match,
    startMs,
    endMs,
    durationMs: maxMs,
    confidence: Math.min(match.confidence, 0.3),
    matchSource: 'weighted-fallback'
  }
}

function alignSequentially(
  ordered: Array<{ id: string; scriptText: string }>,
  transcript: TranscriptSegment[],
  wordSegments: TranscriptWordSegment[],
  trimOffsetMs: number,
  fallbackWindow: { startMs: number; endMs: number; confidence: number },
  warnings: string[]
): Array<{ segmentId: string; match: ScriptAudioMatch }> {
  const matchesById = new Map<string, ScriptAudioMatch>()
  let minStartSec = Math.max(0, (fallbackWindow.startMs - trimOffsetMs) / 1000)
  let failed = 0

  for (let i = 0; i < ordered.length; i++) {
    const segment = ordered[i]
    try {
      const remaining = ordered.slice(i)
      const weights = remaining.map((entry) => Math.max(1, tokenize(entry.scriptText).length))
      const totalWeight = weights.reduce((sum, value) => sum + value, 0)
      const currentWeight = weights[0]
      const remainingWindowMs = Math.max(
        1,
        fallbackWindow.endMs - Math.round(minStartSec * 1000 + trimOffsetMs)
      )
      const expectedMs = Math.round((currentWeight / totalWeight) * remainingWindowMs)
      const maxStartMs = Math.max(
        fallbackWindow.startMs,
        fallbackWindow.endMs - Math.max(expectedMs, 800)
      )
      const maxStartSec = Math.max(minStartSec + 0.1, (maxStartMs - trimOffsetMs) / 1000)

      const boundedTranscript = transcript.filter(
        (part) => part.startSec >= minStartSec - 0.05 && part.startSec <= maxStartSec + 0.05
      )
      const transcriptSource = boundedTranscript.length > 0 ? boundedTranscript : transcript
      let matched = matchScriptToTranscript(segment.scriptText, transcriptSource, {
        trimStartMs: trimOffsetMs,
        minStartSec,
        minConfidence: adaptiveMinConfidence(segment.scriptText)
      })

      if (wordSegments.length > 0) {
        const boundedWords = wordSegments.filter(
          (part) =>
            part.startSec >= minStartSec - 0.05 &&
            part.startSec <= (fallbackWindow.endMs - trimOffsetMs) / 1000 + 0.05
        )
        if (boundedWords.length > 0) {
          try {
            const refined = matchScriptToTranscript(segment.scriptText, boundedWords, {
              trimStartMs: trimOffsetMs,
              minStartSec,
              minConfidence: Math.max(0.3, adaptiveMinConfidence(segment.scriptText) - 0.08)
            })
            if (refined.durationMs > 0) {
              matched = {
                ...refined,
                confidence: Math.max(matched.confidence, refined.confidence)
              }
            }
          } catch {
            // keep chunk-level match when word-level refinement fails
          }
        }
      }

      const clamped = {
        ...matched,
        startMs: Math.max(fallbackWindow.startMs, matched.startMs),
        endMs: Math.min(fallbackWindow.endMs, matched.endMs),
        matchSource: 'sequential' as const
      }
      clamped.endMs = Math.max(clamped.startMs + 1, clamped.endMs)
      clamped.durationMs = clamped.endMs - clamped.startMs

      matchesById.set(segment.id, clamped)
      minStartSec = Math.max(minStartSec, (clamped.endMs - trimOffsetMs) / 1000)
    } catch {
      failed += 1
    }
  }

  if (matchesById.size === 0) {
    warnings.push('Sequential segment matching failed — using proportional split across narration.')
    return distributeByScriptWeight(
      ordered,
      fallbackWindow.startMs,
      fallbackWindow.endMs,
      Math.min(0.35, fallbackWindow.confidence),
      'weighted-fallback'
    )
  }

  const sortedMatched = ordered
    .filter((segment) => matchesById.has(segment.id))
    .map((segment) => ({ segment, match: matchesById.get(segment.id)! }))

  const firstMatchedIdx = ordered.findIndex((segment) => matchesById.has(segment.id))
  if (firstMatchedIdx > 0) {
    fillMissingMatchesByWeight(
      ordered.slice(0, firstMatchedIdx),
      matchesById,
      fallbackWindow.startMs,
      sortedMatched[0].match.startMs,
      0.3
    )
  }

  for (let i = 0; i < sortedMatched.length - 1; i++) {
    const current = sortedMatched[i]
    const next = sortedMatched[i + 1]
    const gapSegments = ordered.slice(
      ordered.findIndex((segment) => segment.id === current.segment.id) + 1,
      ordered.findIndex((segment) => segment.id === next.segment.id)
    )
    fillMissingMatchesByWeight(
      gapSegments,
      matchesById,
      current.match.endMs,
      next.match.startMs,
      0.3
    )
  }

  const lastMatched = sortedMatched[sortedMatched.length - 1]
  const lastMatchedIdx = ordered.findIndex((segment) => segment.id === lastMatched.segment.id)
  if (lastMatchedIdx < ordered.length - 1) {
    fillMissingMatchesByWeight(
      ordered.slice(lastMatchedIdx + 1),
      matchesById,
      lastMatched.match.endMs,
      fallbackWindow.endMs,
      0.3
    )
  }

  if (failed > 0) {
    warnings.push(
      `Sequentially matched ${matchesById.size}/${ordered.length} segments; filled ${failed} with weighted fallback.`
    )
  } else {
    warnings.push('Aligned segments using sequential script-to-audio matching.')
  }

  return ordered
    .map((segment) => ({ segmentId: segment.id, match: matchesById.get(segment.id) }))
    .filter((entry): entry is { segmentId: string; match: ScriptAudioMatch } => entry.match != null)
}

function alignPipelineSegments(
  ordered: Array<{ id: string; scriptText: string }>,
  transcript: TranscriptSegment[],
  wordSegments: TranscriptWordSegment[],
  trimOffsetMs: number,
  audioDurationMs: number,
  fullScript: string,
  warnings: string[],
  hasWordTimestamps: boolean
): Array<{ segmentId: string; match: ScriptAudioMatch }> {
  if (wordSegments.length > 0) {
    const wordAligned = alignSegmentsByWordTokens(
      ordered,
      wordSegments,
      fullScript,
      trimOffsetMs
    )
    if (wordAligned && wordAligned.length === ordered.length) {
      warnings.push(
        hasWordTimestamps
          ? 'Aligned segments using Whisper word-level timestamps.'
          : 'Aligned segments using estimated per-word timing from transcript chunks.'
      )
      return wordAligned
    }
    warnings.push('Word-token alignment incomplete — falling back to sequential chunk matching.')
  } else {
    warnings.push('No word timings available — using chunk-level sequential matching.')
  }

  const narration = narrationSpanMs(transcript, trimOffsetMs)
  const narrationDuration = Math.max(1, narration.endMs - narration.startMs)
  const fileDuration = Math.max(audioDurationMs, narration.endMs)

  const tryFullScriptWindow = (): { startMs: number; endMs: number; confidence: number } | null => {
    try {
      const fullMatch = matchScriptToTranscript(fullScript, transcript, {
        trimStartMs: trimOffsetMs,
        minStartSec: 0,
        minConfidence: 0.25
      })
      const matchDuration = fullMatch.endMs - fullMatch.startMs
      const startsTooLate =
        fullMatch.startMs > fileDuration * 0.35 &&
        narration.startMs + 2000 < fullMatch.startMs
      const spanTooShort = matchDuration < narrationDuration * 0.25
      const spanTooLong = matchDuration > narrationDuration * 1.75

      if (startsTooLate || spanTooShort || spanTooLong) {
        warnings.push(
          'Full-script match looked unreliable — splitting across detected narration instead.'
        )
        return null
      }

      return {
        startMs: fullMatch.startMs,
        endMs: fullMatch.endMs,
        confidence: fullMatch.confidence
      }
    } catch {
      return null
    }
  }

  const window = tryFullScriptWindow()
  if (window) {
    warnings.push('Using full-script match as narration window, then refining segment boundaries.')
    return alignSequentially(ordered, transcript, wordSegments, trimOffsetMs, window, warnings)
  }

  if (narrationDuration > 0) {
    warnings.push(
      'Could not lock full-script window — trying sequential segment matching across detected narration span.'
    )
    return alignSequentially(
      ordered,
      transcript,
      wordSegments,
      trimOffsetMs,
      { startMs: narration.startMs, endMs: narration.endMs, confidence: 0.25 },
      warnings
    )
  }

  const usableDuration = Math.max(0, fileDuration - trimOffsetMs)
  if (usableDuration > 0) {
    warnings.push(
      'Could not detect narration in audio — using equal time splits across the timeline.'
    )
    return buildProportionalMatches(ordered, trimOffsetMs, usableDuration, 0.15, 'equal-fallback')
  }

  return []
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
      const transcribed = await transcribeAudioWithWords(audioPath, trimStartMs, trimEndMs)
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
  const fullScript =
    input.fullScript?.trim() || ordered.map((segment) => segment.scriptText.trim()).join(' ')
  const audioDurationMs = await resolveAudioDurationMs(input, transcript, audioPath)
  const warnings: string[] = []

  if (!hasWordTimestamps && wordSegments.length > 0) {
    warnings.push(
      'Whisper JSON did not include word timestamps — using estimated per-word timing from transcript chunks.'
    )
  }

  if (transcript.length === 0) {
    if (audioDurationMs > trimOffsetMs) {
      return {
        matches: buildProportionalMatches(
          ordered,
          trimOffsetMs,
          audioDurationMs - trimOffsetMs
        ),
        warnings: [
          'Whisper produced no transcript from the timeline audio — using equal time splits from audio duration.'
        ]
      }
    }
    return {
      matches: [],
      warnings: ['Whisper produced no transcript from the timeline audio.']
    }
  }

  const matches = alignPipelineSegments(
    ordered,
    transcript,
    wordSegments,
    trimOffsetMs,
    audioDurationMs,
    fullScript,
    warnings,
    hasWordTimestamps
  )

  if (matches.length === 0) {
    return {
      matches: [],
      warnings: warnings.length > 0 ? warnings : ['Audio alignment failed.']
    }
  }

  const narration = narrationSpanMs(transcript, trimOffsetMs)
  const narrationWindowMs = Math.max(1, narration.endMs - narration.startMs)
  const segmentById = new Map(ordered.map((segment) => [segment.id, segment]))
  const sanitizedMatches = matches.map((entry) => {
    const segment = segmentById.get(entry.segmentId)
    if (!segment) return entry
    return {
      ...entry,
      match: capImplausibleSegmentWindow(segment, entry.match, fullScript, narrationWindowMs)
    }
  })

  for (const entry of sanitizedMatches) {
    if (entry.match.confidence < LOW_CONFIDENCE) {
      warnings.push(
        `Segment timing confidence is low (${entry.match.confidence}) — review timestamps in the pipeline table.`
      )
      break
    }
  }

  return { matches: sanitizedMatches, warnings }
}
