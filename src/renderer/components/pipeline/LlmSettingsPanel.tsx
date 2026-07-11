import { useEffect, useState } from 'react'
import { Button } from '../common/Button'
import { Label } from '../common/Label'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import {
  AIMLAPI_DEFAULT_BASE_URL,
  DEFAULT_LLM_SETTINGS,
  LLM_MODEL_OPTIONS
} from '@shared/segmentPipeline'

export function LlmSettingsPanel(): React.JSX.Element {
  const llmSettings = usePipelineStore((s) => s.llmSettings)
  const loadLlmSettings = usePipelineStore((s) => s.loadLlmSettings)
  const saveLlmSettings = usePipelineStore((s) => s.saveLlmSettings)
  const [draft, setDraft] = useState(DEFAULT_LLM_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [useCustomModel, setUseCustomModel] = useState(false)

  useEffect(() => {
    void loadLlmSettings()
  }, [loadLlmSettings])

  useEffect(() => {
    if (!llmSettings) return
    setDraft(llmSettings)
    const known = LLM_MODEL_OPTIONS.some((m) => m.id === llmSettings.model)
    setUseCustomModel(!known)
  }, [llmSettings])

  return (
    <div className="space-y-2 rounded-md border border-border p-3 bg-card/50">
      <div>
        <p className="text-xs font-medium">LLM Settings</p>
        <p className="text-[10px] text-muted mt-0.5">
          Uses AI/ML API (OpenAI-compatible). Default model: DeepSeek Chat.
        </p>
      </div>
      <div className="space-y-1">
        <Label>AI/ML API key</Label>
        <input
          type="password"
          value={draft.apiKey}
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          placeholder="Your AIMLAPI key"
          className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label>Base URL</Label>
        <input
          value={draft.baseUrl}
          onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          placeholder={AIMLAPI_DEFAULT_BASE_URL}
          className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label>Model</Label>
        {!useCustomModel ? (
          <select
            value={draft.model}
            onChange={(e) => {
              if (e.target.value === '__custom__') {
                setUseCustomModel(true)
                return
              }
              setDraft({ ...draft, model: e.target.value })
            }}
            className="w-full h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            {LLM_MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value="__custom__">Custom model ID…</option>
          </select>
        ) : (
          <div className="flex gap-1">
            <input
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              placeholder="deepseek/deepseek-chat"
              className="flex-1 h-8 rounded-md border border-border bg-background px-2 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => {
                setUseCustomModel(false)
                if (!LLM_MODEL_OPTIONS.some((m) => m.id === draft.model)) {
                  setDraft({ ...draft, model: DEFAULT_LLM_SETTINGS.model })
                }
              }}
            >
              List
            </Button>
          </div>
        )}
      </div>
      <Button
        size="sm"
        className="w-full"
        onClick={() => {
          void saveLlmSettings(draft).then(() => {
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
          })
        }}
      >
        {saved ? 'Saved' : 'Save LLM settings'}
      </Button>
    </div>
  )
}
