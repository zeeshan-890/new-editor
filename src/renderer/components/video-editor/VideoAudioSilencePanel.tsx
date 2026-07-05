import { useCallback, useState } from 'react'
import { Button } from '../common/Button'
import { Label } from '../common/Label'
import { Slider } from '../common/Slider'
import { Select } from '../common/Select'
import { useVideoEditorStore } from '@renderer/stores/videoEditorStore'
import type { DetectionMode, DetectionParams, SilenceRegion } from '@shared/types'
import { DEFAULT_DETECTION_PARAMS, generateId } from '@shared/types'

interface VideoAudioSilencePanelProps {
  clipId: string
  assetPath: string
  onError: (message: string | null) => void
}

export function VideoAudioSilencePanel({
  clipId,
  assetPath,
  onError
}: VideoAudioSilencePanelProps): React.JSX.Element {
  const replaceClipWithAsset = useVideoEditorStore((s) => s.replaceClipWithAsset)
  const [params, setParams] = useState<DetectionParams>({ ...DEFAULT_DETECTION_PARAMS })
  const [regions, setRegions] = useState<SilenceRegion[]>([])
  const [detecting, setDetecting] = useState(false)
  const [processing, setProcessing] = useState(false)

  const runDetection = useCallback(async (): Promise<void> => {
    if (!window.electronAPI?.loadAudio || !window.electronAPI.detectSilence) return
    setDetecting(true)
    onError(null)
    try {
      await window.electronAPI.loadAudio(assetPath)
      const result = await window.electronAPI.detectSilence(params)
      setRegions(result.regions)
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setDetecting(false)
    }
  }, [assetPath, onError, params])

  const removeSilence = useCallback(async (): Promise<void> => {
    if (!window.electronAPI?.exportAudioTemp || !window.electronAPI.probeMediaFile) return

    setProcessing(true)
    onError(null)
    try {
      await window.electronAPI.loadAudio(assetPath)
      let activeRegions = regions
      if (activeRegions.length === 0) {
        const result = await window.electronAPI.detectSilence(params)
        activeRegions = result.regions
        setRegions(activeRegions)
      }

      const ops = activeRegions
        .filter((r) => !r.removed)
        .map((r) => ({
          id: generateId(),
          type: 'remove' as const,
          startMs: r.startMs,
          endMs: r.endMs
        }))

      if (ops.length === 0) {
        onError('No silence detected. Lower the threshold or shorten min silence duration.')
        return
      }

      const exported = await window.electronAPI.exportAudioTemp(ops, params.crossfadeMs)
      const meta = await window.electronAPI.probeMediaFile(exported.outputPath)
      replaceClipWithAsset(clipId, {
        path: exported.outputPath,
        name: `${meta.name.replace(/\.[^.]+$/, '')} (no silence)`,
        type: 'audio',
        durationMs: meta.durationMs
      })
      setRegions([])
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setProcessing(false)
    }
  }, [assetPath, clipId, onError, params, regions, replaceClipWithAsset])

  const silenceMs = regions.filter((r) => !r.removed).reduce((sum, r) => sum + (r.endMs - r.startMs), 0)

  return (
    <div className="rounded border border-border p-2 space-y-3 text-xs">
      <p className="font-medium">Silence removal</p>

      <div>
        <Label>Mode</Label>
        <Select<DetectionMode>
          value={params.mode}
          onChange={(mode) => setParams((p) => ({ ...p, mode }))}
          options={[
            { value: 'traditional', label: 'Traditional' },
            { value: 'ai-vad', label: 'AI VAD' },
            { value: 'hybrid', label: 'Hybrid' }
          ]}
        />
      </div>

      <div>
        <Label>Threshold ({params.thresholdDb.toFixed(0)} dB)</Label>
        <Slider
          min={-80}
          max={-10}
          step={1}
          value={params.thresholdDb}
          onChange={(thresholdDb) => setParams((p) => ({ ...p, thresholdDb }))}
        />
      </div>

      <div>
        <Label>Min silence ({params.minSilenceDurationMs} ms)</Label>
        <Slider
          min={100}
          max={3000}
          step={50}
          value={params.minSilenceDurationMs}
          onChange={(minSilenceDurationMs) => setParams((p) => ({ ...p, minSilenceDurationMs }))}
        />
      </div>

      {regions.length > 0 && (
        <p className="text-muted">
          {regions.filter((r) => !r.removed).length} regions · {(silenceMs / 1000).toFixed(1)}s silence
        </p>
      )}

      <Button size="sm" className="w-full" disabled={detecting || processing} onClick={() => void runDetection()}>
        {detecting ? 'Detecting…' : 'Detect silence'}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled={detecting || processing}
        onClick={() => void removeSilence()}
      >
        {processing ? 'Removing…' : 'Remove silence'}
      </Button>
    </div>
  )
}
