import type { LlmProvider } from '../../llm/llmProvider'
import { parseLlmJsonResponse } from '../validateAnalysis'

export async function runJsonAgent<T>(
  provider: LlmProvider,
  opts: {
    agentName: string
    system: string
    user: string
    temperature?: number
    validate: (data: unknown) => T
  }
): Promise<T> {
  const started = Date.now()
  console.log(`[Pipeline · agent] ${opts.agentName} started`)
  try {
    const raw = await provider.complete(
      [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user }
      ],
      { jsonMode: true, temperature: opts.temperature ?? 0.25 }
    )
    const parsed = parseLlmJsonResponse(raw)
    const value = opts.validate(parsed)
    console.log(`[Pipeline · agent] ${opts.agentName} ok`, { ms: Date.now() - started })
    return value
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[Pipeline · agent] ${opts.agentName} failed`, {
      ms: Date.now() - started,
      error: message
    })
    throw err
  }
}

export function asRecord(data: unknown, label: string): Record<string, unknown> {
  if (!data || typeof data !== 'object') {
    throw new Error(`${label}: expected a JSON object.`)
  }
  return data as Record<string, unknown>
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => String(v ?? '').trim()).filter(Boolean)
}
