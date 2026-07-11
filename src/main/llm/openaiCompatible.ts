import type { LlmSettings } from '../../shared/segmentPipeline'
import type { LlmCompleteOptions, LlmMessage, LlmProvider } from './llmProvider'

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string; refusal?: string | null }
    finish_reason?: string
  }>
  error?: { message?: string }
  message?: string
}

function extractErrorMessage(data: ChatCompletionResponse, status: number): string {
  if (data.error?.message) return data.error.message
  if (data.message) return data.message
  const refusal = data.choices?.[0]?.message?.refusal
  if (refusal) return refusal
  return `LLM request failed (${status})`
}

function formatFetchError(err: unknown, baseUrl: string): string {
  const message = err instanceof Error ? err.message : String(err)
  const cause = err instanceof Error && 'cause' in err ? err.cause : undefined
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : cause && typeof cause === 'object' && 'message' in cause
        ? String((cause as { message?: unknown }).message ?? '')
        : ''
  const causeCode =
    cause && typeof cause === 'object' && 'code' in cause
      ? String((cause as { code?: unknown }).code ?? '')
      : ''

  const combined = `${message} ${causeMessage} ${causeCode}`.toLowerCase()

  if (
    combined.includes('cert_not_yet_valid') ||
    combined.includes('certificate is not yet valid')
  ) {
    return (
      'Could not reach the LLM API: the server TLS certificate is not valid yet on this PC. ' +
      'Sync Windows date/time (Settings → Time & language → Date & time → Sync now), then retry Analyze script.'
    )
  }

  if (
    combined.includes('cert_has_expired') ||
    combined.includes('certificate has expired')
  ) {
    return (
      'Could not reach the LLM API: the server certificate appears expired. ' +
      'Check Windows date/time is correct, verify your LLM base URL, then retry.'
    )
  }

  if (combined.includes('enotfound') || combined.includes('getaddrinfo')) {
    return `Could not reach the LLM API at ${baseUrl}. Check your base URL in Model settings.`
  }

  if (combined.includes('econnrefused') || combined.includes('connection refused')) {
    return `LLM API refused the connection (${baseUrl}). Check base URL and that the service is online.`
  }

  if (combined.includes('fetch failed')) {
    return (
      `Could not reach the LLM API (${baseUrl}). ` +
      'Check internet connection, API key, base URL, and that Windows date/time is synced.'
    )
  }

  return message || 'LLM request failed.'
}

export function createOpenAiCompatibleProvider(settings: LlmSettings): LlmProvider {
  const baseUrl = settings.baseUrl.replace(/\/$/, '')

  return {
    async complete(messages: LlmMessage[], options?: LlmCompleteOptions): Promise<string> {
      if (!settings.apiKey.trim()) {
        throw new Error(
          'LLM API key is not configured. Open pipeline settings and add your AI/ML API key.'
        )
      }

      const body: Record<string, unknown> = {
        model: settings.model,
        messages,
        temperature: options?.temperature ?? 0.4,
        max_tokens: 8192
      }

      if (options?.jsonMode) {
        body.response_format = { type: 'json_object' }
      }

      let response: Response
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.apiKey}`
          },
          body: JSON.stringify(body)
        })
      } catch (err) {
        throw new Error(formatFetchError(err, baseUrl))
      }

      const data = (await response.json()) as ChatCompletionResponse
      if (!response.ok) {
        throw new Error(extractErrorMessage(data, response.status))
      }

      const content = data.choices?.[0]?.message?.content?.trim()
      if (!content) {
        throw new Error('LLM returned an empty response.')
      }
      return content
    }
  }
}
