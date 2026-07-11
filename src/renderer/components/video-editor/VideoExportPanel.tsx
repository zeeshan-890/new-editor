import { Button } from '../common/Button'
import { Label } from '../common/Label'
import { formatTime } from '@renderer/lib/utils'
import {
  DEFAULT_VIDEO_EXPORT_OPTIONS,
  TIMELINE_AUDIO_EXPORT_FORMATS,
  VIDEO_EXPORT_PRESETS,
  VIDEO_EXPORT_QUALITY,
  exportDurationMs,
  hasTimelineAudioClips,
  type TimelineAudioExportFormat
} from '@shared/videoExport'
import type { TimelineLayer } from '@shared/types'

export type TimelineExportMode = 'video' | 'audio'

interface VideoExportPanelProps {
  layers: TimelineLayer[]
  exportMode: TimelineExportMode
  audioFormat: TimelineAudioExportFormat
  exportPresetId: string
  exportQualityId: (typeof VIDEO_EXPORT_QUALITY)[number]['id']
  includeVideoLayerAudio: boolean
  exporting: boolean
  exportSuccess: string | null
  onExportModeChange: (mode: TimelineExportMode) => void
  onAudioFormatChange: (format: TimelineAudioExportFormat) => void
  onPresetChange: (id: string) => void
  onQualityChange: (id: (typeof VIDEO_EXPORT_QUALITY)[number]['id']) => void
  onIncludeVideoLayerAudioChange: (value: boolean) => void
  onExport: () => void
}

export function VideoExportPanel({
  layers,
  exportMode,
  audioFormat,
  exportPresetId,
  exportQualityId,
  includeVideoLayerAudio,
  exporting,
  exportSuccess,
  onExportModeChange,
  onAudioFormatChange,
  onPresetChange,
  onQualityChange,
  onIncludeVideoLayerAudioChange,
  onExport
}: VideoExportPanelProps): React.JSX.Element {
  const durationMs = exportDurationMs(layers)
  const hasClips = layers.some((layer) => layer.clips.length > 0)
  const hasAudio = hasTimelineAudioClips(layers)
  const audioFormatMeta =
    TIMELINE_AUDIO_EXPORT_FORMATS.find((f) => f.id === audioFormat) ??
    TIMELINE_AUDIO_EXPORT_FORMATS[0]
  const canExport = exportMode === 'audio' ? hasAudio : hasClips

  return (
    <div className="flex flex-col gap-4 p-3 overflow-y-auto min-h-0">
      <div>
        <h3 className="font-semibold text-sm">Export timeline</h3>
        <p className="text-xs text-muted mt-1">
          {exportMode === 'audio'
            ? 'Mixes audio tracks only — respects clip positions, trims, and silence edits on the timeline.'
            : 'Renders the full sequence — video and overlay layers composited, audio tracks mixed.'}
        </p>
      </div>

      <div>
        <Label>Export type</Label>
        <select
          value={exportMode}
          onChange={(e) => onExportModeChange(e.target.value as TimelineExportMode)}
          disabled={exporting}
          className="mt-1 w-full h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="video">Video (MP4)</option>
          <option value="audio">Audio only</option>
        </select>
      </div>

      {exportMode === 'audio' ? (
        <div>
          <Label>Audio format</Label>
          <select
            value={audioFormat}
            onChange={(e) => onAudioFormatChange(e.target.value as TimelineAudioExportFormat)}
            disabled={exporting}
            className="mt-1 w-full h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            {TIMELINE_AUDIO_EXPORT_FORMATS.map((format) => (
              <option key={format.id} value={format.id}>
                {format.label}
              </option>
            ))}
          </select>
          {!hasAudio && (
            <p className="text-[10px] text-amber-400 mt-2">
              Add audio clips to an audio track on the timeline first.
            </p>
          )}
        </div>
      ) : (
        <>
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
        </>
      )}

      <p className="text-[10px] text-muted">
        Duration: {formatTime(durationMs, false)}
        {exportMode === 'video'
          ? ` · H.264 MP4 · ${DEFAULT_VIDEO_EXPORT_OPTIONS.fps} fps`
          : ` · ${audioFormatMeta.label}`}
      </p>

      {exportSuccess && (
        <p className="text-xs text-emerald-400 break-all rounded border border-emerald-500/30 bg-emerald-500/10 p-2">
          {exportSuccess}
        </p>
      )}

      <Button onClick={onExport} disabled={!canExport || exporting} className="w-full">
        {exporting
          ? 'Rendering…'
          : exportMode === 'audio'
            ? `Export audio (${audioFormatMeta.extension.toUpperCase()})`
            : 'Export MP4 (Ctrl+E)'}
      </Button>

      {!canExport && (
        <p className="text-xs text-muted">
          {exportMode === 'audio'
            ? 'Place audio on an audio track before exporting.'
            : 'Add clips to the timeline before exporting.'}
        </p>
      )}
    </div>
  )
}
