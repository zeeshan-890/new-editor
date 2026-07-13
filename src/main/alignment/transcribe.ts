import {
  hasAssemblyAiKey,
  transcribeWithAssemblyAi
} from './assemblyai'
import { assemblyAiModelLabel } from './assemblyaiSettings'
import {
  transcribeAudioWithWords as transcribeWithWhisper,
  whisperModelLabel,
  type WhisperTranscriptionResult
} from './whisper'

export type { WhisperTranscriptionResult }
export type { TranscriptWordSegment } from './whisper'

export interface TranscribeAudioOptions {
  /** Full script / segment text to bias transcription (AssemblyAI prompt context). */
  scriptHint?: string
}

export async function activeTranscriptionProviderLabel(): Promise<string> {
  if (await hasAssemblyAiKey()) return assemblyAiModelLabel()
  return `whisper:${whisperModelLabel()}`
}

/**
 * Prefer AssemblyAI when an API key is configured; otherwise fall back to local Whisper.
 */
export async function transcribeAudioWithWords(
  audioPath: string,
  trimStartMs?: number,
  trimEndMs?: number,
  options?: TranscribeAudioOptions
): Promise<WhisperTranscriptionResult & { provider: string }> {
  if (await hasAssemblyAiKey()) {
    return transcribeWithAssemblyAi(audioPath, trimStartMs, trimEndMs, options)
  }
  const result = await transcribeWithWhisper(audioPath, trimStartMs, trimEndMs)
  return { ...result, provider: `whisper:${whisperModelLabel()}` }
}
