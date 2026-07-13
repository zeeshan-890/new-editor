import type { ScriptAudioMatch } from '../../shared/types'
import { normalizeText, tokenize } from './normalize'
import type { TranscriptWordSegment } from './whisper'

function tokensRoughlyMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true
  if (a.length >= 5 && b.length >= 5) {
    const shorter = a.length <= b.length ? a : b
    const longer = a.length <= b.length ? b : a
    if (longer.includes(shorter)) return true
  }
  return false
}

function scoreWindow(
  scriptTokens: string[],
  words: TranscriptWordSegment[],
  start: number,
  end: number
): number {
  if (end < start || scriptTokens.length === 0) return 0
  const windowTokens = words.slice(start, end + 1).map((w) => normalizeText(w.text))
  let matched = 0
  let cursor = 0
  for (const scriptToken of scriptTokens) {
    let found = false
    for (let i = cursor; i < windowTokens.length; i++) {
      if (tokensRoughlyMatch(scriptToken, windowTokens[i])) {
        matched += 1
        cursor = i + 1
        found = true
        break
      }
    }
    if (!found) {
      // allow one-token skip in window without advancing forever
      continue
    }
  }
  return matched / scriptTokens.length
}

/**
 * Find the best contiguous word window for this segment starting at/after wordCursor.
 * Prefers high recall of script tokens in order.
 */
function findSequentialWordWindow(
  scriptTokens: string[],
  words: TranscriptWordSegment[],
  wordCursor: number
): { start: number; end: number; score: number } | null {
  if (scriptTokens.length === 0 || wordCursor >= words.length) return null

  const expectedLen = scriptTokens.length
  const minLen = Math.max(1, Math.floor(expectedLen * 0.5))
  const maxLen = Math.max(expectedLen + 8, Math.ceil(expectedLen * 2.5))
  const searchLimit = Math.min(words.length, wordCursor + Math.max(48, expectedLen * 6))

  let best: { start: number; end: number; score: number } | null = null

  for (let start = wordCursor; start < searchLimit; start++) {
    // Don't drift too far from cursor without a strong match
    if (start > wordCursor + 24 && (!best || best.score < 0.55)) break

    for (let len = minLen; len <= maxLen; len++) {
      const end = start + len - 1
      if (end >= words.length) break
      const score = scoreWindow(scriptTokens, words, start, end)
      if (
        !best ||
        score > best.score + 0.02 ||
        (Math.abs(score - best.score) <= 0.02 && start < best.start)
      ) {
        best = { start, end, score }
      }
      if (score >= 0.92) return best
    }
  }

  if (!best || best.score < 0.35) return null
  return best
}

function wordsToMatch(
  segmentId: string,
  words: TranscriptWordSegment[],
  startIdx: number,
  endIdx: number,
  confidence: number,
  trimOffsetMs: number,
  matchSource: NonNullable<ScriptAudioMatch['matchSource']>,
  matchedAt: number,
  scriptTokenCount: number
): { segmentId: string; match: ScriptAudioMatch } {
  const safeStart = Math.max(0, Math.min(startIdx, endIdx))
  const safeEnd = Math.min(words.length - 1, Math.max(startIdx, endIdx))
  const first = words[safeStart]
  const last = words[safeEnd]
  const startMs = Math.round(first.startSec * 1000 + trimOffsetMs)
  const wordEndMs = Math.round(last.endSec * 1000 + trimOffsetMs)
  // Never allow absurdly short clips: ~280ms per script word, floor 120ms.
  const minDurationMs = Math.max(120, scriptTokenCount * 280)
  const endMs = Math.max(startMs + minDurationMs, wordEndMs)
  return {
    segmentId,
    match: {
      startMs,
      endMs,
      durationMs: endMs - startMs,
      confidence: Number(confidence.toFixed(3)),
      matchSource,
      matchedAt
    }
  }
}

/**
 * Walk segments in order through word timestamps. Always returns one match per segment
 * when words exist — never leaves gaps for weighted fills.
 */
export function alignSegmentsByWordTokens(
  segments: Array<{ id: string; scriptText: string }>,
  wordSegments: TranscriptWordSegment[],
  _fullScript: string,
  trimOffsetMs: number,
  matchSource: NonNullable<ScriptAudioMatch['matchSource']> = 'sequential'
): Array<{ segmentId: string; match: ScriptAudioMatch }> | null {
  if (segments.length === 0 || wordSegments.length === 0) return null

  const now = Date.now()
  let wordCursor = 0
  const results: Array<{ segmentId: string; match: ScriptAudioMatch }> = []

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const segment = segments[segIdx]
    const segTokens = tokenize(normalizeText(segment.scriptText))
    const remainingSegments = segments.length - segIdx
    const remainingWords = Math.max(1, wordSegments.length - wordCursor)

    if (segTokens.length === 0) {
      const idx = Math.min(wordCursor, wordSegments.length - 1)
      results.push(
        wordsToMatch(segment.id, wordSegments, idx, idx, 0.2, trimOffsetMs, matchSource, now, 1)
      )
      wordCursor = Math.min(wordSegments.length, idx + 1)
      continue
    }

    const window = findSequentialWordWindow(segTokens, wordSegments, wordCursor)
    if (window && window.score >= 0.35) {
      results.push(
        wordsToMatch(
          segment.id,
          wordSegments,
          window.start,
          window.end,
          Math.max(0.4, window.score),
          trimOffsetMs,
          matchSource,
          now,
          segTokens.length
        )
      )
      wordCursor = window.end + 1
      continue
    }

    // Fallback: take a fair share of remaining words (still real timestamps, not weighted time).
    const fairShare = Math.max(
      1,
      Math.round(remainingWords / remainingSegments)
    )
    const take = Math.min(
      remainingWords,
      Math.max(fairShare, Math.min(segTokens.length, remainingWords - (remainingSegments - 1)))
    )
    const startIdx = Math.min(wordCursor, wordSegments.length - 1)
    const endIdx = Math.min(wordSegments.length - 1, startIdx + take - 1)
    results.push(
      wordsToMatch(
        segment.id,
        wordSegments,
        startIdx,
        endIdx,
        0.35,
        trimOffsetMs,
        matchSource,
        now,
        segTokens.length
      )
    )
    wordCursor = endIdx + 1
  }

  // Ensure monotonic non-overlapping times (shrink later segments if min-duration expanded overlap).
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1].match
    const cur = results[i].match
    if (cur.startMs < prev.endMs) {
      const startMs = prev.endMs
      const endMs = Math.max(startMs + 120, cur.endMs)
      results[i] = {
        ...results[i],
        match: {
          ...cur,
          startMs,
          endMs,
          durationMs: endMs - startMs
        }
      }
    }
  }

  return results.length === segments.length ? results : null
}
