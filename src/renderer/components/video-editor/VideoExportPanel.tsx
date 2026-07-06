import { Button } from '../common/Button'
import { Label } from '../common/Label'
import { formatTime } from '@renderer/lib/utils'
import {
  DEFAULT_VIDEO_EXPORT_OPTIONS,
  VIDEO_EXPORT_PRESETS,
  VIDEO_EXPORT_QUALITY,
  exportDurationMs
} from '@shared/videoExport'
import type { TimelineLayer } from '@shared/types'

interface VideoExportPanelProps {
  layers: TimelineLayer[]
  exportPresetId: string
  exportQualityId: (typeof VIDEO_EXPORT_QUALITY)[number]['id']
  includeVideoLayerAudio: boolean
  exporting: boolean
  exportSuccess: string | null
  onPresetChange: (id: string) => void
  onQualityChange: (id: (typeof VIDEO_EXPORT_QUALITY)[number]['id']) => void
  onIncludeVideoLayerAudioChange: (value: boolean) => void
  onExport: () => void
}

export function VideoExportPanel({
  layers,
  exportPresetId,
  exportQualityId,
  includeVideoLayerAudio,
  exporting,
  exportSuccess,
  onPresetChange,
  onQualityChange,
  onIncludeVideoLayerAudioChange,
  onExport
}: VideoExportPanelProps): React.JSX.Element {
  const durationMs = exportDurationMs(layers)
  const hasClips = layers.some((layer) => layer.clips.length > 0)

  return (
    <div className="flex flex-col gap-4 p-3 overflow-y-auto min-h-0">
      <div>
        <h3 className="font-semibold text-sm">Export timeline</h3>
        <p className="text-xs text-muted mt-1">
          Renders the full sequence — all video and overlay layers composited, audio tracks mixed,
          with letterboxing to the chosen frame size.
        </p>
      </div>

      <div>
        <Label>Resolution</Label>
        <select
          value={exportPresetId}
          onChange={(e) => onPresetChange(e.target.value)}
          disabled={exporting}
          className="mt-1 w-full h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          {VIDEO_EXPORT_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label>Quality</Label>
        <select
          value={exportQualityId}
          onChange={(e) =>
            onQualityChange(e.target.value as (typeof VIDEO_EXPORT_QUALITY)[number]['id'])
          }
          disabled={exporting}
          className="mt-1 w-full h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          {VIDEO_EXPORT_QUALITY.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-start gap-2 text-xs text-muted cursor-pointer">
        <input
          type="checkbox"
          checked={includeVideoLayerAudio}
          onChange={(e) => onIncludeVideoLayerAudioChange(e.target.checked)}
          disabled={exporting}
          className="mt-0.5 rounded border-border"
        />
        <span>Include audio from video clips (in addition to audio tracks)</span>
      </label>

      <p className="text-[10px] text-muted">
        Duration: {formatTime(durationMs, false)} · H.264 MP4 · {DEFAULT_VIDEO_EXPORT_OPTIONS.fps} fps
      </p>

      {exportSuccess && (
        <p className="text-xs text-emerald-400 break-all rounded border border-emerald-500/30 bg-emerald-500/10 p-2">
          {exportSuccess}
        </p>
      )}

      <Button
        onClick={onExport}
        disabled={!hasClips || exporting}
        className="w-full"
      >
        {exporting ? 'Rendering…' : 'Export MP4 (Ctrl+E)'}
      </Button>

      {!hasClips && (
        <p className="text-xs text-muted">Add clips to the timeline before exporting.</p>
      )}
    </div>
  )
}
