export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    // Keep letters from any language (mixed-script audio/scripts).
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(value: string): string[] {
  const normalized = normalizeText(value)
  return normalized ? normalized.split(' ') : []
}
