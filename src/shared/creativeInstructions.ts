/**
 * Apply creative instructions into analysis prompts and generation prompts.
 * Freeform (unstructured) scripts rely on this — the LLM often under-applies the rulebook.
 */

const PROCESS_NOTE_RE =
  /^(?:\s*[-*]?\s*)?(?:first\s+)?(?:generate|create|make|render|run|then|after|before|pipeline|step\s*\d+|images?\s+then\s+videos?|videos?\s+then\s+images?).*$/gim

const DUMP_LABEL_RE =
  /^(?:creative\s*(?:direction|instructions?|brief)|visual\s*brief|style\s*notes?)\s*:\s*/i

/** Strip pipeline/process notes; keep visual/style/brand rules. */
export function condenseCreativeInstructions(
  creative: string | undefined | null,
  maxChars = 700
): string {
  const raw = creative?.trim() ?? ''
  if (!raw) return ''

  const cleaned = raw
    .replace(PROCESS_NOTE_RE, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(DUMP_LABEL_RE, '').trim())
    .filter((line) => {
      if (!line) return false
      // Drop pure workflow lines that slipped past the regex
      if (/^(step\s*\d+|todo|note)\b/i.test(line) && line.length < 40) return false
      return true
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  if (!cleaned) return ''
  if (cleaned.length <= maxChars) return cleaned
  return `${cleaned.slice(0, maxChars).replace(/\s+\S*$/, '')}…`
}

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** True when prompt already contains a meaningful chunk of the creative brief. */
export function promptReflectsCreative(prompt: string, creative: string): boolean {
  const condensed = condenseCreativeInstructions(creative, 400)
  if (!condensed) return true
  const p = normalizeForCompare(prompt)
  if (!p) return false
  if (p.includes('visual brief') || p.includes('creative brief to honor')) return true

  // Check overlapping significant tokens (length >= 5)
  const tokens = normalizeForCompare(condensed)
    .split(' ')
    .filter((t) => t.length >= 5)
  if (tokens.length === 0) return p.includes(normalizeForCompare(condensed).slice(0, 40))

  const hit = tokens.filter((t) => p.includes(t)).length
  return hit >= Math.min(4, Math.ceil(tokens.length * 0.35))
}

/**
 * Append condensed creative guidance when the prompt does not already reflect it.
 * Synthesized as a brief block — not a dump of pipeline process notes.
 */
export function appendCreativeGuidance(
  prompt: string,
  creative: string | undefined | null,
  opts?: { forDiagram?: boolean; forVideo?: boolean }
): string {
  const condensed = condenseCreativeInstructions(creative, opts?.forVideo ? 280 : 700)
  if (!condensed) return prompt.trim()

  const base = prompt.trim()
  if (promptReflectsCreative(base, condensed)) return base

  const header = opts?.forDiagram
    ? 'Creative brief (apply only where compatible with an isolated unlabeled diagram — never add text, people, rooms, or extra visuals):'
    : opts?.forVideo
      ? 'Creative brief for motion/look (honor without inventing unrelated subjects):'
      : 'Creative brief to honor in this shot (weave into look, lighting, props, wardrobe, and composition — do not ignore):'

  if (!base) return `${header}\n${condensed}`
  return `${base}\n\n${header}\n${condensed}`
}

export function creativeStyleLockHint(creative: string | undefined | null): string {
  const condensed = condenseCreativeInstructions(creative, 220)
  if (!condensed) return ''
  return condensed.replace(/\n+/g, ' ').trim()
}
