import type { ScriptAudioMatch } from '../../shared/types'
import { matchScriptToTranscript } from './matchScript'
import { transcribeAudioWithWords } from './transcribe'

/** Align a single script string to audio (AssemblyAI when keyed, else Whisper). */
export async function alignScriptAudio(
  audioPath: string,
  script: string,
  trimStartMs?: number,
  trimEndMs?: number
): Promise<ScriptAudioMatch> {
  const { segments } = await transcribeAudioWithWords(audioPath, trimStartMs, trimEndMs, {
    scriptHint: script
  })
  return matchScriptToTranscript(script, segments, trimStartMs ?? 0)
}
