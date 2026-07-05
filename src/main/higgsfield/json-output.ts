import { HiggsfieldCliError } from './errors'

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '')
}

function tryParseJson(text: string): unknown | null {
  const trimmed = stripBom(text).trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function extractBalancedJson(text: string, open: '{' | '[', close: '}' | ']'): unknown | null {
  const start = text.indexOf(open)
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        const parsed = tryParseJson(text.slice(start, i + 1))
        if (parsed !== null) return parsed
      }
    }
  }

  return null
}

export function parseHiggsfieldJson<T>(stdout: string, stderr = ''): T {
  const combined = stripBom([stdout, stderr].filter(Boolean).join('\n')).trim()

  if (!combined) {
    throw new HiggsfieldCliError('Empty output from Higgsfield CLI')
  }

  const whole = tryParseJson(combined)
  if (whole !== null) return whole as T

  const fromArray = extractBalancedJson(combined, '[', ']')
  if (fromArray !== null) return fromArray as T

  const fromObject = extractBalancedJson(combined, '{', '}')
  if (fromObject !== null) return fromObject as T

  throw new HiggsfieldCliError(
    'No valid JSON in Higgsfield CLI output',
    combined.slice(0, 4000)
  )
}
