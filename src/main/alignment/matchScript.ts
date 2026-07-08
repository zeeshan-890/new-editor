import type { ScriptAudioMatch } from '../../shared/types'
import { normalizeText, tokenize } from './normalize'

export interface TranscriptSegment {
  text: string
  startSec: number
  endSec: number
}

const MIN_CONFIDENCE = 0.65

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

export function matchScriptToTranscript(
  script: string,
  segments: TranscriptSegment[],
  trimStartMs = 0
): ScriptAudioMatch {
  const scriptNorm = normalizeText(script)
  if (!scriptNorm) {
    throw new Error('Script is empty. Enter script text before matching.')
  }
  if (segments.length === 0) {
    throw new Error('No transcript segments were produced from audio.')
  }

  const scriptTokens = tokenize(scriptNorm)
  let best:
    | {
        i: number
        j: number
        score: number
      }
    | undefined

  for (let i = 0; i < segments.length; i++) {
    let merged = ''
    for (let j = i; j < segments.length; j++) {
      merged = `${merged} ${segments[j].text}`.trim()
      const score = jaccard(scriptTokens, tokenize(merged))
      if (!best || score > best.score) {
        best = { i, j, score }
      }
      if (tokenize(merged).length > scriptTokens.length * 2) break
    }
  }

  if (!best || best.score < MIN_CONFIDENCE) {
    throw new Error('Could not confidently match script in the audio. Try a more exact script snippet.')
  }

  const startMs = Math.max(0, Math.round(segments[best.i].startSec * 1000 + trimStartMs))
  const endMs = Math.max(startMs + 1, Math.round(segments[best.j].endSec * 1000 + trimStartMs))
  return {
    startMs,
    endMs,
    durationMs: endMs - startMs,
    confidence: Number(best.score.toFixed(3)),
    matchedAt: Date.now()
  }
}
