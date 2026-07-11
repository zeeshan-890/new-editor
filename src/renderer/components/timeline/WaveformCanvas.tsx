import { useEffect, useRef } from 'react'
import { useEditorStore } from '@renderer/stores/editorStore'
import { usePlayheadStore } from '@renderer/stores/playheadStore'
import { selectPeakLevel } from '@renderer/lib/audio/peaks'

interface WaveformCanvasProps {
  width: number
  height: number
  msToX: (ms: number) => number
}

export function WaveformCanvas({ width, height, msToX }: WaveformCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaks = useEditorStore((s) => s.peaks)
  const metadata = useEditorStore((s) => s.metadata)
  const regions = useEditorStore((s) => s.regions)
  const selection = useEditorStore((s) => s.selection)
  const splitMarkers = useEditorStore((s) => s.splitMarkers)
  const operations = useEditorStore((s) => s.operations)
  const scrollMs = usePlaybackStore((s) => s.scrollMs)
  const zoom = usePlaybackStore((s) => s.zoom)
  const playheadMs = usePlayheadStore((s) => s.playheadMs)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks || !metadata || width <= 0 || height <= 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.scale(dpr, dpr)

    const visibleDurationMs = metadata.durationMs / zoom
    const visibleSamples = (visibleDurationMs / 1000) * metadata.sampleRate
    const level = selectPeakLevel(peaks.levels, visibleSamples, width)

    ctx.clearRect(0, 0, width, height)

    const midY = height / 2
    const ampScale = (height / 2) * 0.9

    ctx.fillStyle = 'rgba(239, 68, 68, 0.25)'
    for (const region of regions) {
      if (region.removed) continue
      const x1 = msToX(region.startMs)
      const x2 = msToX(region.endMs)
      if (x2 < 0 || x1 > width) continue
      ctx.fillRect(Math.max(0, x1), 0, Math.min(width, x2) - Math.max(0, x1), height)
    }

    ctx.fillStyle = 'rgba(34, 197, 94, 0.15)'
    for (const op of operations.filter((o) => o.type === 'remove')) {
      const x1 = msToX(op.startMs)
      const x2 = msToX(op.endMs)
      ctx.fillRect(Math.max(0, x1), 0, Math.min(width, x2) - Math.max(0, x1), height)
    }

    if (selection) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.2)'
      const x1 = msToX(selection.startMs)
      const x2 = msToX(selection.endMs)
      ctx.fillRect(x1, 0, x2 - x1, height)
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = 1
      ctx.strokeRect(x1, 0, x2 - x1, height)
    }

    const startSample = Math.floor((scrollMs / 1000) * metadata.sampleRate)
    const endSample = Math.floor(((scrollMs + visibleDurationMs) / 1000) * metadata.sampleRate)
    const startPeak = Math.floor(startSample / level.samplesPerPeak)
    const endPeak = Math.ceil(endSample / level.samplesPerPeak)

    ctx.fillStyle = '#3b82f6'
    for (let i = startPeak; i < endPeak && i < level.max.length; i++) {
      const sampleStart = i * level.samplesPerPeak
      const ms = (sampleStart / metadata.sampleRate) * 1000
      const x = msToX(ms)
      const maxVal = level.max[i]
      const minVal = level.min[i]
      const top = midY - maxVal * ampScale
      const bottom = midY - minVal * ampScale
      ctx.fillRect(x, top, Math.max(1, width / (endPeak - startPeak)), bottom - top)
    }

    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = 1
    for (const marker of splitMarkers) {
      const x = msToX(marker.timeMs)
      if (x >= 0 && x <= width) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
    }

    const px = msToX(playheadMs)
    ctx.strokeStyle = '#f8fafc'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(px, 0)
    ctx.lineTo(px, height)
    ctx.stroke()
  }, [
    peaks,
    metadata,
    regions,
    selection,
    splitMarkers,
    operations,
    scrollMs,
    zoom,
    playheadMs,
    width,
    height,
    msToX
  ])

  return (
    <canvas
      ref={canvasRef}
      className="block w-full cursor-crosshair"
      style={{ height }}
    />
  )
}
