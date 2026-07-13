import { useEffect, useState } from 'react'
import { Button } from '../common/Button'
import { Label } from '../common/Label'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { DEFAULT_ASSEMBLYAI_SETTINGS } from '@shared/segmentPipeline'

export function AssemblyAiSettingsPanel(): React.JSX.Element {
  const settings = usePipelineStore((s) => s.assemblyAiSettings)
  const load = usePipelineStore((s) => s.loadAssemblyAiSettings)
  const save = usePipelineStore((s) => s.saveAssemblyAiSettings)
  const [draft, setDraft] = useState(DEFAULT_ASSEMBLYAI_SETTINGS)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!settings) return
    setDraft(settings)
  }, [settings])

  const hasKey = Boolean(draft.apiKey.trim())

  return (
    <div className="space-y-2 rounded-md border border-border p-3 bg-card/50">
      <div>
        <p className="text-xs font-medium">AssemblyAI (segment timings)</p>
        <p className="text-[10px] text-muted mt-0.5">
          Cloud speech-to-text for Get segment timings. With a key set, AssemblyAI replaces local
          Whisper. Mixed-language audio is supported.
        </p>
      </div>
      <div className="space-y-1">
        <Label>API key</Label>
        <input
          type="password"
          value={draft.apiKey}
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          placeholder="AssemblyAI API key"
          className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label>Region</Label>
        <select
          value={draft.region}
          onChange={(e) =>
            setDraft({
              ...draft,
              region: e.target.value === 'eu' ? 'eu' : 'us'
            })
          }
          className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="us">US (api.assemblyai.com)</option>
          <option value="eu">EU (api.eu.assemblyai.com)</option>
        </select>
      </div>
      <p className="text-[10px] text-muted">
        Status:{' '}
        {hasKey
          ? 'AssemblyAI will be used for timing'
          : 'No key — falls back to local Whisper if installed'}
      </p>
      <Button
        size="sm"
        className="w-full"
        onClick={() => {
          void save(draft).then(() => {
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
          })
        }}
      >
        {saved ? 'Saved' : 'Save AssemblyAI settings'}
      </Button>
    </div>
  )
}
