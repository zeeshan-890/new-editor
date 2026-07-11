import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { LlmSettings } from '../../shared/segmentPipeline'
import { DEFAULT_LLM_SETTINGS } from '../../shared/segmentPipeline'

function settingsPath(): string {
  return join(app.getPath('userData'), 'llm-settings.json')
}

export async function loadLlmSettings(): Promise<LlmSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<LlmSettings>
    return {
      apiKey: parsed.apiKey ?? '',
      baseUrl: parsed.baseUrl?.trim() || DEFAULT_LLM_SETTINGS.baseUrl,
      model: parsed.model?.trim() || DEFAULT_LLM_SETTINGS.model
    }
  } catch {
    return { ...DEFAULT_LLM_SETTINGS }
  }
}

export async function saveLlmSettings(settings: LlmSettings): Promise<LlmSettings> {
  const next: LlmSettings = {
    apiKey: settings.apiKey.trim(),
    baseUrl: settings.baseUrl.trim() || DEFAULT_LLM_SETTINGS.baseUrl,
    model: settings.model.trim() || DEFAULT_LLM_SETTINGS.model
  }
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}
