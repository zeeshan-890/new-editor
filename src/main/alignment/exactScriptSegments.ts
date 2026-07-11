import { normalizeText, tokenize } from './normalize'

interface TokenSpan {
  token: string
  start: number
  end: number
}

function tokenizeWithPositions(text: string): TokenSpan[] {
  const spans: TokenSpan[] = []
  const regex = /[a-z0-9]+/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    spans.push({
      token: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length
    })
  }
  return spans
}

function tokensRoughlyMatch(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true
  return false
}

function alignTokenSpans(
  scriptSpans: TokenSpan[],
  segmentTokenLists: string[][]
): number[] | null {
  const boundaries: number[] = [0]
  let cursor = 0

  for (const segTokens of segmentTokenLists) {
    if (segTokens.length === 0) {
      boundaries.push(cursor)
      continue
    }

    let matched = 0
    let lastMatch = cursor
    let search = cursor

    while (search < scriptSpans.length && matched < segTokens.length) {
      if (tokensRoughlyMatch(scriptSpans[search].token, segTokens[matched])) {
        lastMatch = search + 1
        matched += 1
        search += 1
      } else {
        search += 1
        if (search - cursor > segTokens.length * 4) break
      }
    }

    if (matched === 0) return null
    cursor = lastMatch
    boundaries.push(cursor)
  }

  if (cursor < scriptSpans.length * 0.85) return null
  return boundaries
}

export function enforceExactScriptTexts<T extends { index: number; scriptText: string }>(
  fullScript: string,
  segments: T[]
): T[] {
  const trimmed = fullScript.trim()
  if (!trimmed || segments.length === 0) return segments

  const sorted = [...segments].sort((a, b) => a.index - b.index)
  const scriptSpans = tokenizeWithPositions(trimmed)
  if (scriptSpans.length === 0) return segments

  const segmentTokenLists = sorted.map((segment) => tokenize(normalizeText(segment.scriptText)))
  const boundaries = alignTokenSpans(scriptSpans, segmentTokenLists)

  if (!boundaries) {
    return remapBySequentialSearch(trimmed, sorted)
  }

  return sorted.map((segment, index) => {
    const startIdx = boundaries[index] ?? 0
    const endIdx = boundaries[index + 1] ?? scriptSpans.length
    if (startIdx >= endIdx || startIdx >= scriptSpans.length) return segment

    const startChar = scriptSpans[startIdx].start
    const endChar = scriptSpans[Math.min(endIdx, scriptSpans.length) - 1].end
    const exact = trimmed.slice(startChar, endChar).trim()
    return exact ? { ...segment, scriptText: exact } : segment
  })
}

function remapBySequentialSearch<T extends { index: number; scriptText: string }>(
  fullScript: string,
  segments: T[]
): T[] {
  let cursor = 0
  const fullNorm = normalizeText(fullScript)

  return segments.map((segment) => {
    const segNorm = normalizeText(segment.scriptText)
    if (!segNorm) return segment

    const idx = fullNorm.indexOf(segNorm, cursor)
    if (idx < 0) return segment

    const ratio = fullScript.length / Math.max(1, fullNorm.length)
    const approxStart = Math.max(0, Math.floor(idx * ratio))
    const approxEnd = Math.min(fullScript.length, Math.ceil((idx + segNorm.length) * ratio))
    const slice = fullScript.slice(approxStart, approxEnd).trim()
    cursor = idx + segNorm.length
    return slice ? { ...segment, scriptText: slice } : segment
  })
}
