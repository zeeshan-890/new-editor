import { useEffect } from 'react'
import { cn } from '@renderer/lib/utils'
import type { MediaAsset, TimelineClip, TimelineLayer } from '@shared/types'
import { useVideoEditorStore, EMPTY_SILENCE_REGIONS } from '@renderer/stores/videoEditorStore'
import { ClipWaveform } from './ClipWaveform'
import { ClipFilmstrip } from './ClipFilmstrip'

const CLIP_INNER_H = 48

interface TimelineClipBlockProps {
  clip: TimelineClip
  asset: MediaAsset
  layer: TimelineLayer
  left: number
  width: number
  selected: boolean
  style: { bar: string; clip: string; label: string }
  className?: string
  onMouseDown: (e: React.MouseEvent) => void
  onTrimIn: (e: React.MouseEvent) => void
  onTrimOut: (e: React.MouseEvent) => void
}

function showWaveformFor(layer: TimelineLayer, asset: MediaAsset): boolean {
  return layer.type === 'audio' && (asset.type === 'audio' || asset.type === 'video')
}

function showFilmstripFor(layer: TimelineLayer, asset: MediaAsset): boolean {
  if (layer.type === 'video' && asset.type === 'video') return true
  if (layer.type === 'overlay' && (asset.type === 'image' || asset.type === 'video')) return true
  return false
}

export function TimelineClipBlock({
  clip,
  asset,
  layer,
  left,
  width,
  selected,
  style,
  className,
  onMouseDown,
  onTrimIn,
  onTrimOut
}: TimelineClipBlockProps): React.JSX.Element {
  const waveform = useVideoEditorStore((s) => s.waveformCache[asset.id])
  const waveformLoading = useVideoEditorStore((s) => s.waveformLoading[asset.id])
  const loadWaveformForAsset = useVideoEditorStore((s) => s.loadWaveformForAsset)
  const filmstrip = useVideoEditorStore((s) => s.filmstripCache[asset.id])
  const filmstripLoading = useVideoEditorStore((s) => s.filmstripLoading[asset.id])
  const loadFilmstripForAsset = useVideoEditorStore((s) => s.loadFilmstripForAsset)
  const silenceRegions = useVideoEditorStore(
    (s) => s.silenceRegionsByClipId[clip.id] ?? EMPTY_SILENCE_REGIONS
  )

  const showWaveform = showWaveformFor(layer, asset)
  const showFilmstrip = showFilmstripFor(layer, asset)
  const hasVisual = (showWaveform && waveform) || (showFilmstrip && filmstrip)
  const isLoading =
    (showWaveform && waveformLoading && !waveform) ||
    (showFilmstrip && filmstripLoading && !filmstrip)

  useEffect(() => {
    if (!showWaveform || waveform || waveformLoading) return
    void loadWaveformForAsset(asset.id, asset.path)
  }, [asset.id, asset.path, loadWaveformForAsset, showWaveform, waveform, waveformLoading])

  useEffect(() => {
    if (!showFilmstrip || filmstrip || filmstripLoading) return
    void loadFilmstripForAsset(asset.id, asset)
  }, [asset, loadFilmstripForAsset, showFilmstrip, filmstrip, filmstripLoading])

  return (
    <div
      className={cn(
        'absolute top-1 bottom-1 rounded border overflow-hidden',
        layer.locked ? 'cursor-not-allowed opacity-70' : 'cursor-grab active:cursor-grabbing',
        selected ? 'border-primary ring-1 ring-primary' : style.clip,
        showWaveform && waveform && 'bg-emerald-950/40',
        showFilmstrip && filmstrip && 'bg-sky-950/40',
        className
      )}
      style={{ left, width }}
      onMouseDown={onMouseDown}
      title={asset.name}
    >
      {showFilmstrip && filmstrip && (
        <ClipFilmstrip
          filmstrip={filmstrip}
          sourceInMs={clip.sourceInMs}
          sourceOutMs={clip.sourceOutMs}
          height={CLIP_INNER_H}
        />
      )}

      {showWaveform && waveform && (
        <ClipWaveform
          peaks={waveform.peaks}
          sampleRate={waveform.sampleRate}
          mediaDurationMs={waveform.durationMs}
          sourceInMs={clip.sourceInMs}
          sourceOutMs={clip.sourceOutMs}
          width={width}
          height={CLIP_INNER_H}
          silenceRegions={silenceRegions}
          fillColor={selected ? 'rgba(110, 231, 183, 0.9)' : 'rgba(52, 211, 153, 0.75)'}
        />
      )}

      {isLoading && <div className="absolute inset-0 bg-white/5 animate-pulse" />}

      {!hasVisual && !isLoading && (
        <span className="relative z-10 truncate block px-1 text-[10px] leading-[48px]">{asset.name}</span>
      )}

      {hasVisual && width > 80 && (
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
