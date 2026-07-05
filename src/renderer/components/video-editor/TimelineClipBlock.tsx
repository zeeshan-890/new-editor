import { useEffect } from 'react'
import { cn } from '@renderer/lib/utils'
import type { MediaAsset, TimelineClip, TimelineLayer } from '@shared/types'
import { useVideoEditorStore } from '@renderer/stores/videoEditorStore'
import { ClipWaveform } from './ClipWaveform'

const CLIP_INNER_H = 48

interface TimelineClipBlockProps {
  clip: TimelineClip
  asset: MediaAsset
  layer: TimelineLayer
  left: number
  width: number
  selected: boolean
  style: { bar: string; clip: string; label: string }
  onMouseDown: (e: React.MouseEvent) => void
  onTrimIn: (e: React.MouseEvent) => void
  onTrimOut: (e: React.MouseEvent) => void
}

export function TimelineClipBlock({
  clip,
  asset,
  layer,
  left,
  width,
  selected,
  style,
  onMouseDown,
  onTrimIn,
  onTrimOut
}: TimelineClipBlockProps): React.JSX.Element {
  const waveform = useVideoEditorStore((s) => s.waveformCache[asset.id])
  const waveformLoading = useVideoEditorStore((s) => s.waveformLoading[asset.id])
  const loadWaveformForAsset = useVideoEditorStore((s) => s.loadWaveformForAsset)

  const showWaveform = layer.type === 'audio' && (asset.type === 'audio' || asset.type === 'video')

  useEffect(() => {
    if (!showWaveform || waveform || waveformLoading) return
    void loadWaveformForAsset(asset.id, asset.path)
  }, [asset.id, asset.path, loadWaveformForAsset, showWaveform, waveform, waveformLoading])

  return (
    <div
      className={cn(
        'absolute top-1 bottom-1 rounded border overflow-hidden',
        layer.locked ? 'cursor-not-allowed opacity-70' : 'cursor-grab active:cursor-grabbing',
        selected ? 'border-primary ring-1 ring-primary' : style.clip,
        showWaveform && waveform ? 'bg-emerald-950/40' : ''
      )}
      style={{ left, width }}
      onMouseDown={onMouseDown}
      title={asset.name}
    >
      {showWaveform && waveform && (
        <ClipWaveform
          peaks={waveform.peaks}
          sampleRate={waveform.sampleRate}
          sourceInMs={clip.sourceInMs}
          sourceOutMs={clip.sourceOutMs}
          width={width}
          height={CLIP_INNER_H}
          fillColor={selected ? 'rgba(110, 231, 183, 0.9)' : 'rgba(52, 211, 153, 0.75)'}
        />
      )}

      {showWaveform && waveformLoading && !waveform && (
        <div className="absolute inset-0 bg-emerald-500/5 animate-pulse" />
      )}

      {(!showWaveform || !waveform) && (
        <span className="relative z-10 truncate block px-1 text-[10px] leading-[48px]">{asset.name}</span>
      )}

      {showWaveform && waveform && width > 80 && (
        <span className="absolute bottom-0 left-0 right-0 z-10 truncate px-1 py-0.5 text-[8px] text-white/90 bg-gradient-to-t from-black/70 to-transparent">
          {asset.name}
        </span>
      )}

      {selected && !layer.locked && (
        <>
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-primary/60 z-20"
            onMouseDown={onTrimIn}
          />
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-primary/60 z-20"
            onMouseDown={onTrimOut}
          />
        </>
      )}
    </div>
  )
}

export { CLIP_INNER_H }
