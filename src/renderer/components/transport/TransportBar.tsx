import { Play, Pause, Square, SkipBack, SkipForward, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '../common/Button'
import { Switch } from '../common/Switch'
import { formatTime } from '@renderer/lib/utils'
import { usePlayheadStore } from '@renderer/stores/playheadStore'
import { usePlaybackStore } from '@renderer/stores/playbackStore'
import { useEditorStore } from '@renderer/stores/editorStore'

interface TransportBarProps {
  onPlayPause: () => void
  onStop: () => void
}

export function TransportBar({ onPlayPause, onStop }: TransportBarProps): React.JSX.Element {
  const metadata = useEditorStore((s) => s.metadata)
  const regions = useEditorStore((s) => s.regions)
  const previewNonSilence = useEditorStore((s) => s.previewNonSilence)
  const setPreviewNonSilence = useEditorStore((s) => s.setPreviewNonSilence)

  const playheadMs = usePlayheadStore((s) => s.playheadMs)
  const isPlaying = usePlayheadStore((s) => s.isPlaying)
  const loopSelection = usePlaybackStore((s) => s.loopSelection)
  const setLoopSelection = usePlaybackStore((s) => s.setLoopSelection)
  const zoom = usePlaybackStore((s) => s.zoom)
  const zoomIn = usePlaybackStore((s) => s.zoomIn)
  const zoomOut = usePlaybackStore((s) => s.zoomOut)
  const setPlayheadMs = usePlayheadStore((s) => s.setPlayheadMs)

  const activeRegions = regions.filter((r) => !r.removed)

  const goToPrev = (): void => {
    const prev = [...activeRegions].reverse().find((r) => r.endMs < playheadMs)
    if (prev) setPlayheadMs(prev.startMs)
  }

  const goToNext = (): void => {
    const next = activeRegions.find((r) => r.startMs > playheadMs)
    if (next) setPlayheadMs(next.startMs)
  }

  return (
    <div className="h-14 border-t border-border bg-card flex items-center gap-3 px-4 shrink-0">
      <Button size="icon" variant="default" onClick={onPlayPause} disabled={!metadata}>
        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
      </Button>
      <Button size="icon" variant="outline" onClick={onStop} disabled={!metadata}>
        <Square size={14} />
      </Button>
      <Button size="icon" variant="ghost" onClick={goToPrev} disabled={!metadata} title="Previous silence [">
        <SkipBack size={16} />
      </Button>
      <Button size="icon" variant="ghost" onClick={goToNext} disabled={!metadata} title="Next silence ]">
        <SkipForward size={16} />
      </Button>

      <div className="font-mono text-sm tabular-nums min-w-[180px]">
        {formatTime(playheadMs)} / {formatTime(metadata?.durationMs ?? 0)}
      </div>

      <div className="flex-1" />

      <Switch checked={loopSelection} onChange={setLoopSelection} label="Loop selection (L)" />
      <Switch
        checked={previewNonSilence}
        onChange={setPreviewNonSilence}
        label="Preview non-silence"
      />

      <div className="flex items-center gap-1 text-xs text-muted">
        <Button size="icon" variant="ghost" onClick={zoomOut}>
          <ZoomOut size={14} />
        </Button>
        <span className="w-12 text-center">{Math.round(zoom * 100)}%</span>
        <Button size="icon" variant="ghost" onClick={zoomIn}>
          <ZoomIn size={14} />
        </Button>
      </div>
    </div>
  )
}
