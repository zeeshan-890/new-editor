import type { ScriptAudioMatch } from '../../shared/types'
import { normalizeText, tokenize } from './normalize'

export interface TranscriptSegment {
  text: string
  startSec: number
  endSec: number
}

const DEFAULT_MIN_CONFIDENCE = 0.65
const PIPELINE_MIN_CONFIDENCE = 0.42

export interface MatchScriptOptions {
  trimStartMs?: number
  /** Only search transcript windows that start at or after this time (seconds). */
  minStartSec?: number
  minConfidence?: number
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const aa = new Set(a)
  const bb = new Set(b)
  let common = 0
  for (const token of aa) {
    if (bb.has(token)) common += 1
  }
  const union = aa.size + bb.size - common
  return union > 0 ? common / union : 0
}

/** Recall-oriented score — better for short script snippets inside longer narration. */
function matchScore(scriptTokens: string[], mergedTokens: string[]): number {
  const j = jaccard(scriptTokens, mergedTokens)
  if (scriptTokens.length === 0) return 0
  const merged = new Set(mergedTokens)
  let common = 0
  for (const token of scriptTokens) {
    if (merged.has(token)) common += 1
  }
  const recall = common / scriptTokens.length
  return Math.max(j, recall * 0.92)
}

function firstSentence(text: string): string {
  const match = /[.!?]/.exec(text)
  if (!match || match.index == null) return text.trim()
  return text.slice(0, match.index + 1).trim()
}

function firstWords(text: string, count: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= count) return text.trim()
  return words.slice(0, count).join(' ')
}

function scriptVariants(script: string): string[] {
  const trimmed = script.trim()
  if (!trimmed) return []
  const variants = [trimmed, firstSentence(trimmed)]
  for (const count of [10, 8, 6, 4]) {
    variants.push(firstWords(trimmed, count))
  }
  return [...new Set(variants.filter((v) => v.length > 0))]
}

function findBestWindow(
  scriptTokens: string[],
  segments: TranscriptSegment[],
  minStartSec: number,
  minConfidence: number
): { i: number; j: number; score: number } | undefined {
  let best: { i: number; j: number; score: number } | undefined

  for (let i = 0; i < segments.length; i++) {
    if (segments[i].startSec < minStartSec - 0.05) continue
    let merged = ''
    for (let j = i; j < segments.length; j++) {
      merged = `${merged} ${segments[j].text}`.trim()
      const score = matchScore(scriptTokens, tokenize(merged))
      if (!best || score > best.score + 0.03 || (score >= best.score - 0.03 && i < best.i)) {
        best = { i, j, score }
      }
      if (tokenize(merged).length > scriptTokens.length * 3) break
    }
  }

  if (!best || best.score < minConfidence) return undefined
  return best
}

function resolveOptions(optionsOrTrimStartMs: MatchScriptOptions | number): MatchScriptOptions {
  return typeof optionsOrTrimStartMs === 'number'
    ? { trimStartMs: optionsOrTrimStartMs }
    : optionsOrTrimStartMs
}

export function matchScriptToTranscript(
  script: string,
  segments: TranscriptSegment[],
  optionsOrTrimStartMs: MatchScriptOptions | number = 0
): ScriptAudioMatch {
  const options = resolveOptions(optionsOrTrimStartMs)
  const trimStartMs = options.trimStartMs ?? 0
  const minStartSec = options.minStartSec ?? 0
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE

  const scriptNorm = normalizeText(script)
  if (!scriptNorm) {
    throw new Error('Script is empty. Enter script text before matching.')
  }
  if (segments.length === 0) {
    throw new Error('No transcript segments were produced from audio.')
  }

  const thresholds = [...new Set([minConfidence, PIPELINE_MIN_CONFIDENCE, 0.35])].sort(
    (a, b) => b - a
  )

  let bestWindow: { i: number; j: number; score: number } | undefined
  for (const variant of scriptVariants(script)) {
    const scriptTokens = tokenize(normalizeText(variant))
    if (scriptTokens.length === 0) continue
    for (const threshold of thresholds) {
      const candidate = findBestWindow(scriptTokens, segments, minStartSec, threshold)
      if (candidate && (!bestWindow || candidate.score > bestWindow.score)) {
        bestWindow = candidate
      }
      if (bestWindow && bestWindow.score >= minConfidence) break
    }
    if (bestWindow && bestWindow.score >= minConfidence) break
  }

  if (!bestWindow) {
    throw new Error('Could not confidently match script in the audio. Try a more exact script snippet.')
  }

  const startMs = Math.max(0, Math.round(segments[bestWindow.i].startSec * 1000 + trimStartMs))
  const endMs = Math.max(
    startMs + 1,
    Math.round(segments[bestWindow.j].endSec * 1000 + trimStartMs)
  )
  return {
    startMs,
    endMs,
    durationMs: endMs - startMs,
    confidence: Number(bestWindow.score.toFixed(3)),
    matchedAt: Date.now()
  }
}
