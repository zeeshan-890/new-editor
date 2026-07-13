import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { AssemblyAiSettings } from '../../shared/segmentPipeline'
import { DEFAULT_ASSEMBLYAI_SETTINGS } from '../../shared/segmentPipeline'

function settingsPath(): string {
  return join(app.getPath('userData'), 'assemblyai-settings.json')
}

export async function loadAssemblyAiSettings(): Promise<AssemblyAiSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AssemblyAiSettings>
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      region: parsed.region === 'eu' ? 'eu' : 'us'
    }
  } catch {
    return { ...DEFAULT_ASSEMBLYAI_SETTINGS }
  }
}

export async function saveAssemblyAiSettings(
  settings: AssemblyAiSettings
): Promise<AssemblyAiSettings> {
  const next: AssemblyAiSettings = {
    apiKey: settings.apiKey.trim(),
    region: settings.region === 'eu' ? 'eu' : 'us'
  }
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function assemblyAiBaseUrl(region: AssemblyAiSettings['region']): string {
  return region === 'eu' ? 'https://api.eu.assemblyai.com' : 'https://api.assemblyai.com'
}

export function assemblyAiModelLabel(): string {
  return 'assemblyai:universal-3-5-pro'
}
