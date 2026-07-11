import type { ScriptAudioMatch } from '../../shared/types'
import { normalizeText, tokenize } from './normalize'
import type { TranscriptWordSegment } from './whisper'

function tokensRoughlyMatch(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true
  return false
}

function alignScriptTokensToWords(
  scriptTokens: string[],
  words: TranscriptWordSegment[]
): Array<number | null> {
  const mapping: Array<number | null> = []
  let wordCursor = 0

  for (const scriptToken of scriptTokens) {
    let matched: number | null = null
    const searchLimit = Math.min(words.length, wordCursor + 32)

    for (let i = wordCursor; i < searchLimit; i++) {
      const wordToken = normalizeText(words[i].text)
      if (tokensRoughlyMatch(scriptToken, wordToken)) {
        matched = i
        wordCursor = i + 1
        break
      }
    }

    mapping.push(matched)
  }

  return mapping
}

function findSegmentTokenWindow(
  fullTokens: string[],
  segmentTokens: string[],
  minStartTokenIdx: number
): { start: number; end: number } | null {
  if (segmentTokens.length === 0 || fullTokens.length === 0) return null
  const maxStart = fullTokens.length - segmentTokens.length
  if (maxStart < minStartTokenIdx) return null

  let best:
    | {
        start: number
        matched: number
      }
    | null = null

  for (let start = minStartTokenIdx; start <= maxStart; start++) {
    let matched = 0
    for (let i = 0; i < segmentTokens.length; i++) {
      if (tokensRoughlyMatch(fullTokens[start + i], segmentTokens[i])) {
        matched += 1
      }
    }
    const ratio = matched / segmentTokens.length
    if (ratio >= 0.85) {
      return { start, end: start + segmentTokens.length - 1 }
    }
    if (!best || matched > best.matched) {
      best = { start, matched }
    }
  }

  if (!best) return null
  const bestRatio = best.matched / segmentTokens.length
  if (bestRatio >= 0.65) {
    return { start: best.start, end: best.start + segmentTokens.length - 1 }
  }
  return null
}

function nearestWordIndex(
  tokenToWord: Array<number | null>,
  from: number,
  to: number
): number | null {
  for (let i = from; i <= to; i++) {
    const idx = tokenToWord[i]
    if (idx != null) return idx
  }
  for (let i = from - 1; i >= 0; i--) {
    const idx = tokenToWord[i]
    if (idx != null) return idx
  }
  for (let i = to + 1; i < tokenToWord.length; i++) {
    const idx = tokenToWord[i]
    if (idx != null) return idx
  }
  return null
}

export function alignSegmentsByWordTokens(
  segments: Array<{ id: string; scriptText: string }>,
  wordSegments: TranscriptWordSegment[],
  fullScript: string,
  trimOffsetMs: number,
  matchSource: NonNullable<ScriptAudioMatch['matchSource']> = 'word-aligned'
): Array<{ segmentId: string; match: ScriptAudioMatch }> | null {
  if (segments.length === 0 || wordSegments.length === 0) return null

  const scriptTokens = tokenize(normalizeText(fullScript))
  if (scriptTokens.length === 0) return null

  const tokenToWord = alignScriptTokensToWords(scriptTokens, wordSegments)
  const matchedCount = tokenToWord.filter((idx) => idx != null).length
  if (matchedCount < scriptTokens.length * 0.7) return null

  const now = Date.now()
  let tokenCursor = 0
  const results: Array<{ segmentId: string; match: ScriptAudioMatch }> = []

  for (const segment of segments) {
    const segTokens = tokenize(normalizeText(segment.scriptText))
    if (segTokens.length === 0) return null

    const tokenWindow = findSegmentTokenWindow(scriptTokens, segTokens, tokenCursor)
    if (!tokenWindow) return null
    tokenCursor = tokenWindow.end + 1

    const startWordIdx =
      nearestWordIndex(tokenToWord, tokenWindow.start, tokenWindow.start) ??
      nearestWordIndex(tokenToWord, tokenWindow.start, tokenWindow.end)
    const endWordIdx =
      nearestWordIndex(tokenToWord, tokenWindow.end, tokenWindow.end) ??
      nearestWordIndex(tokenToWord, tokenWindow.start, tokenWindow.end)

    if (startWordIdx == null || endWordIdx == null) return null
    const safeStartWordIdx = Math.min(startWordIdx, endWordIdx)
    const safeEndWordIdx = Math.max(startWordIdx, endWordIdx)

    const firstWord = wordSegments[safeStartWordIdx]
    const lastWord = wordSegments[safeEndWordIdx]
    const startMs = Math.round(firstWord.startSec * 1000 + trimOffsetMs)
    const endMs = Math.max(startMs + 1, Math.round(lastWord.endSec * 1000 + trimOffsetMs))
    const mappedCount = tokenToWord
      .slice(tokenWindow.start, tokenWindow.end + 1)
      .filter((idx): idx is number => idx != null).length
    const confidence = Number((mappedCount / segTokens.length).toFixed(3))

    results.push({
      segmentId: segment.id,
      match: {
        startMs,
        endMs,
        durationMs: endMs - startMs,
        confidence,
        matchSource,
        matchedAt: now
      }
    })
  }

  return results
}
