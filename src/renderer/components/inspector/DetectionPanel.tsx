import { useCallback, useEffect, useRef } from 'react'
import { Button } from '../common/Button'
import { Label } from '../common/Label'
import { Slider } from '../common/Slider'
import { Select } from '../common/Select'
import { Switch } from '../common/Switch'
import { useEditorStore } from '@renderer/stores/editorStore'
import type { DetectionMode, HybridMerge } from '@shared/types'
import { generateId } from '@shared/types'

export function DetectionPanel(): React.JSX.Element {
  const metadata = useEditorStore((s) => s.metadata)
  const params = useEditorStore((s) => s.params)
  const presets = useEditorStore((s) => s.presets)
  const detecting = useEditorStore((s) => s.detecting)
  const detectionProgress = useEditorStore((s) => s.detectionProgress)
  const setParams = useEditorStore((s) => s.setParams)
  const setRegions = useEditorStore((s) => s.setRegions)
  const setDetecting = useEditorStore((s) => s.setDetecting)
  const setPresets = useEditorStore((s) => s.setPresets)
  const applySilenceRemoval = useEditorStore((s) => s.applySilenceRemoval)
  const snapToSilence = useEditorStore((s) => s.snapToSilence)
  const setSnapToSilence = useEditorStore((s) => s.setSnapToSilence)
  const rippleDelete = useEditorStore((s) => s.rippleDelete)
  const setRippleDelete = useEditorStore((s) => s.setRippleDelete)
  const regions = useEditorStore((s) => s.regions)
  const toggleRegionRemoved = useEditorStore((s) => s.toggleRegionRemoved)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runDetection = useCallback(async () => {
    if (!metadata || !window.electronAPI) return
    setDetecting(true, 0)
    try {
      const result = await window.electronAPI.detectSilence(params)
      setRegions(result.regions)
    } catch (err) {
      useEditorStore.getState().setError(String(err))
    } finally {
      setDetecting(false, 1)
    }
  }, [metadata, params, setDetecting, setRegions])

  useEffect(() => {
    if (!params.autoRefresh || !metadata) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      runDetection()
    }, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [params, metadata, runDetection])

  useEffect(() => {
    window.electronAPI?.getPresets().then(setPresets)
    const unsub = window.electronAPI?.onDetectionProgress((v) => setDetecting(true, v))
    return () => unsub?.()
  }, [setPresets, setDetecting])

  const savePreset = async (): Promise<void> => {
    const name = prompt('Preset name')
    if (!name) return
    const preset = { id: generateId(), name, params: { ...params } }
    const updated = [...presets, preset]
    setPresets(updated)
    await window.electronAPI?.savePresets(updated)
  }

  const loadPreset = (id: string): void => {
    const preset = presets.find((p) => p.id === id)
    if (preset) setParams(preset.params)
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full text-sm">
      <div>
        <h3 className="font-semibold text-base mb-3">Silence Detection</h3>
        <Label>Mode</Label>
        <Select<DetectionMode>
          value={params.mode}
          onChange={(mode) => setParams({ mode })}
          options={[
            { value: 'traditional', label: 'Traditional' },
            { value: 'ai-vad', label: 'AI VAD' },
            { value: 'hybrid', label: 'Hybrid' }
          ]}
        />
      </div>

      <ParamRow label={`Threshold (${params.thresholdDb.toFixed(0)} dB)`}>
        <Slider
          min={-80}
          max={-10}
          step={1}
          value={params.thresholdDb}
          onChange={(thresholdDb) => setParams({ thresholdDb })}
        />
      </ParamRow>

      <ParamRow label={`Min silence (${params.minSilenceDurationMs} ms)`}>
        <Slider
          min={50}
          max={5000}
          step={50}
          value={params.minSilenceDurationMs}
          onChange={(minSilenceDurationMs) => setParams({ minSilenceDurationMs })}
        />
      </ParamRow>

      <ParamRow label={`Min speech (${params.minSpeechDurationMs} ms)`}>
        <Slider
          min={50}
          max={2000}
          step={50}
          value={params.minSpeechDurationMs}
          onChange={(minSpeechDurationMs) => setParams({ minSpeechDurationMs })}
        />
      </ParamRow>

      <ParamRow label={`Pre-padding (${params.prePaddingMs} ms)`}>
        <Slider
          min={0}
          max={1000}
          step={10}
          value={params.prePaddingMs}
          onChange={(prePaddingMs) => setParams({ prePaddingMs })}
        />
      </ParamRow>

      <ParamRow label={`Post-padding (${params.postPaddingMs} ms)`}>
        <Slider
          min={0}
          max={1000}
          step={10}
          value={params.postPaddingMs}
          onChange={(postPaddingMs) => setParams({ postPaddingMs })}
        />
      </ParamRow>

      <ParamRow label={`Crossfade (${params.crossfadeMs} ms)`}>
        <Slider
          min={0}
          max={200}
          step={5}
          value={params.crossfadeMs}
          onChange={(crossfadeMs) => setParams({ crossfadeMs })}
        />
      </ParamRow>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>High-pass (Hz)</Label>
          <Slider
            min={0}
            max={500}
            step={10}
            value={params.highPassHz}
            onChange={(highPassHz) => setParams({ highPassHz })}
          />
        </div>
        <div>
          <Label>Low-pass (Hz)</Label>
          <Slider
            min={1000}
            max={16000}
            step={100}
            value={params.lowPassHz}
            onChange={(lowPassHz) => setParams({ lowPassHz })}
          />
        </div>
      </div>

      <ParamRow label={`Window (${params.windowSizeMs} ms)`}>
        <Slider
          min={10}
          max={100}
          step={5}
          value={params.windowSizeMs}
          onChange={(windowSizeMs) => setParams({ windowSizeMs })}
        />
      </ParamRow>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Attack (ms)</Label>
          <Slider
            min={0}
            max={500}
            step={10}
            value={params.attackMs}
            onChange={(attackMs) => setParams({ attackMs })}
          />
        </div>
        <div>
          <Label>Release (ms)</Label>
          <Slider
            min={0}
            max={500}
            step={10}
            value={params.releaseMs}
            onChange={(releaseMs) => setParams({ releaseMs })}
          />
        </div>
      </div>

      {(params.mode === 'ai-vad' || params.mode === 'hybrid') && (
        <ParamRow label={`VAD sensitivity (${params.vadSensitivity.toFixed(2)})`}>
          <Slider
            min={0.1}
            max={0.9}
            step={0.05}
            value={params.vadSensitivity}
            onChange={(vadSensitivity) => setParams({ vadSensitivity })}
          />
        </ParamRow>
      )}

      {params.mode === 'hybrid' && (
        <div>
          <Label>Hybrid merge</Label>
          <Select<HybridMerge>
            value={params.hybridMerge}
            onChange={(hybridMerge) => setParams({ hybridMerge })}
            options={[
              { value: 'intersection', label: 'Intersection (strict)' },
              { value: 'union', label: 'Union (aggressive)' }
            ]}
          />
        </div>
      )}

      <Switch
        checked={params.autoRefresh}
        onChange={(autoRefresh) => setParams({ autoRefresh })}
        label="Auto-refresh on change"
      />
      <Switch checked={snapToSilence} onChange={setSnapToSilence} label="Snap to silence boundaries" />
      <Switch checked={rippleDelete} onChange={setRippleDelete} label="Ripple delete" />

      {regions.length > 0 && (
        <div>
          <Label>Detected regions ({regions.filter((r) => !r.removed).length} active)</Label>
          <div className="max-h-32 overflow-y-auto space-y-1 mt-1">
            {regions.slice(0, 20).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => toggleRegionRemoved(r.id)}
                className={`w-full text-left text-[10px] px-2 py-1 rounded border ${
                  r.removed
                    ? 'border-green-500/30 text-green-400 line-through'
                    : 'border-destructive/30 text-red-300'
                }`}
              >
                {(r.startMs / 1000).toFixed(2)}s – {(r.endMs / 1000).toFixed(2)}s ({r.source})
              </button>
            ))}
          </div>
        </div>
      )}

      {detecting && (
        <div className="w-full bg-background rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${detectionProgress * 100}%` }}
          />
        </div>
      )}

      <Button onClick={runDetection} disabled={!metadata || detecting} className="w-full">
        {detecting ? 'Detecting…' : 'Run Detection'}
      </Button>

      <Button variant="outline" onClick={applySilenceRemoval} disabled={!metadata} className="w-full">
        Apply Silence Removal
      </Button>

      {presets.length > 0 && (
        <div>
          <Label>Presets</Label>
          <Select
            value=""
            onChange={(id) => loadPreset(id)}
            options={[
              { value: '', label: 'Load preset…' },
              ...presets.map((p) => ({ value: p.id, label: p.name }))
            ]}
          />
        </div>
      )}

      <Button variant="ghost" size="sm" onClick={savePreset} disabled={!metadata}>
        Save current as preset
      </Button>
    </div>
  )
}

function ParamRow({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  )
}
