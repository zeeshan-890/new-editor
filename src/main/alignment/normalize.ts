export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(value: string): string[] {
  const normalized = normalizeText(value)
  return normalized ? normalized.split(' ') : []
}
