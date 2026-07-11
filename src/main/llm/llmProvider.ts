export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmCompleteOptions {
  temperature?: number
  jsonMode?: boolean
}

export interface LlmProvider {
  complete(messages: LlmMessage[], options?: LlmCompleteOptions): Promise<string>
}
