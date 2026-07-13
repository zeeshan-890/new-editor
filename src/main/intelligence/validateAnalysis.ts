import type { LlmAnalyzeResult } from '../../shared/segmentPipeline'
import { enforceExactScriptTexts } from '../alignment/exactScriptSegments'

const MIN_SEGMENTS = 1
const MAX_SEGMENTS = 200

export interface ValidateAnalysisOptions {
  fullScript?: string
  /** When false, do not remap scriptText against the full document (used for Scene/VO and Segment/Script scripts). */
  enforceExactScript?: boolean
  expectedSegmentCount?: number
}

export function parseLlmJsonResponse(raw: string): unknown {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const jsonText = fenceMatch ? fenceMatch[1].trim() : trimmed
  return JSON.parse(jsonText)
}

/** Strip stage labels the model sometimes leaks into scriptText. */
export function cleanNarrationScriptText(text: string): string {
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^(?:Scene\s+\d+\s*[:.-]?\s*)+/i, '')
  cleaned = cleaned.replace(/^(?:Segment\s+\d+\s*[:.-]?\s*)+/i, '')
  cleaned = cleaned.replace(/^Script\s*:?\s*/i, '')
  cleaned = cleaned.replace(/^(?:V0|VO)\s+Prompt\s*:?\s*/i, '')
  cleaned = cleaned.replace(/^VO\s*:\s*/i, '')
  cleaned = cleaned.replace(/^O\s*:\s*/i, '')
  cleaned = cleaned.replace(/^Clip\s+\d+\s*:?\s*/i, '')
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith('\u201C') && cleaned.endsWith('\u201D'))
  ) {
    cleaned = cleaned.slice(1, -1).trim()
  }
  // Drop trailing orphaned stage crumbs.
  cleaned = cleaned
    .replace(/\s+(?:Clip\s+\d+|Scene\s+\d+|Segment\s+\d+|Script|(?:V0|VO)\s+Prompt)\s*:?\s*$/i, '')
    .trim()
  return cleaned.replace(/\s+/g, ' ').trim()
}

export function validateAnalysisResult(
  data: unknown,
  scriptReferenceIds?: Set<string>,
  options?: string | ValidateAnalysisOptions
): LlmAnalyzeResult {
  const opts: ValidateAnalysisOptions =
    typeof options === 'string' ? { fullScript: options, enforceExactScript: true } : options ?? {}

  if (!data || typeof data !== 'object') {
    throw new Error('LLM response was not a JSON object.')
  }

  const obj = data as Record<string, unknown>
  const segmentsRaw = obj.segments
  const charactersRaw = obj.characters
  const styleLockRaw = obj.styleLock

  if (!Array.isArray(segmentsRaw)) {
    throw new Error('LLM response missing "segments" array.')
  }
  if (segmentsRaw.length < MIN_SEGMENTS || segmentsRaw.length > MAX_SEGMENTS) {
    throw new Error(`Expected ${MIN_SEGMENTS}-${MAX_SEGMENTS} segments, got ${segmentsRaw.length}.`)
  }
  if (
    typeof opts.expectedSegmentCount === 'number' &&
    segmentsRaw.length !== opts.expectedSegmentCount
  ) {
    throw new Error(
      `Expected exactly ${opts.expectedSegmentCount} segments (one per structured block), got ${segmentsRaw.length}.`
    )
  }
  if (!Array.isArray(charactersRaw)) {
    throw new Error('LLM response missing "characters" array.')
  }

  const characters = charactersRaw.map((c, i) => {
    if (!c || typeof c !== 'object') throw new Error(`Character ${i} is invalid.`)
    const ch = c as Record<string, unknown>
    const id = String(ch.id ?? '').trim()
    const name = String(ch.name ?? '').trim()
    const role = String(ch.role ?? '').trim()
    const description = String(ch.description ?? '').trim()
    if (!id || !name || !description) {
      throw new Error(`Character ${i} must have id, name, and description.`)
    }
    if (!role) {
      throw new Error(`Character ${i} ("${name}") must have a story role (e.g. physician, patient).`)
    }
    return { id, name, role, description }
  })

  const characterIds = new Set(characters.map((c) => c.id))

  const segments = segmentsRaw.map((s, i) => {
    if (!s || typeof s !== 'object') throw new Error(`Segment ${i} is invalid.`)
    const seg = s as Record<string, unknown>
    const scriptText = cleanNarrationScriptText(String(seg.scriptText ?? ''))
    const imagePrompt = String(seg.imagePrompt ?? '').trim()
    if (!scriptText) throw new Error(`Segment ${i} has empty scriptText.`)
    if (!imagePrompt) throw new Error(`Segment ${i} has empty imagePrompt.`)

    const chars = Array.isArray(seg.characters)
      ? seg.characters.map((id) => String(id).trim()).filter(Boolean)
      : []

    for (const charId of chars) {
      if (!characterIds.has(charId)) {
        throw new Error(`Segment ${i} references unknown character "${charId}".`)
      }
    }

    const referenceIds = Array.isArray(seg.referenceIds)
      ? seg.referenceIds
          .map((id) => String(id).trim())
          .filter((id) => id && (!scriptReferenceIds || scriptReferenceIds.has(id)))
      : undefined

    return {
      index: typeof seg.index === 'number' ? seg.index : i,
      scriptText,
      imagePrompt,
      videoMotionPrompt: seg.videoMotionPrompt
        ? String(seg.videoMotionPrompt).trim()
        : undefined,
      characters: chars,
      referenceIds: referenceIds?.length ? referenceIds : undefined,
      continuityFromPrevious: Boolean(seg.continuityFromPrevious)
    }
  })

  const styleObj =
    styleLockRaw && typeof styleLockRaw === 'object'
      ? (styleLockRaw as Record<string, unknown>)
      : {}

  const shouldEnforce = opts.enforceExactScript !== false && Boolean(opts.fullScript?.trim())
  const exactSegments = shouldEnforce
    ? enforceExactScriptTexts(opts.fullScript!.trim(), segments)
    : segments

  return {
    segments: exactSegments,
    characters,
    styleLock: {
      aspectRatio: String(styleObj.aspectRatio ?? '9:16').trim() || '9:16',
      visualStyle:
        String(styleObj.visualStyle ?? 'cinematic realism, natural lighting').trim() ||
        'cinematic realism, natural lighting',
      setting: String(styleObj.setting ?? '').trim() || undefined
    }
  }
}

export function formatValidationError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
