import { useEffect, useRef } from 'react'
import type { SilenceRegion, WaveformPeaks } from '@shared/types'
import { selectPeakLevel } from '@renderer/lib/audio/peaks'

interface ClipWaveformProps {
  peaks: WaveformPeaks
  sampleRate: number
  mediaDurationMs: number
  sourceInMs: number
  sourceOutMs: number
  width: number
  height: number
  fillColor?: string
  silenceRegions?: SilenceRegion[]
}

export function ClipWaveform({
  peaks,
  sampleRate,
  mediaDurationMs,
  sourceInMs,
  sourceOutMs,
  width,
  height,
  fillColor = 'rgba(52, 211, 153, 0.85)',
  silenceRegions = []
}: ClipWaveformProps): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width < 2 || height < 2 || !peaks.levels.length) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(width * dpr))
    canvas.height = Math.max(1, Math.floor(height * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.clearRect(0, 0, width, height)

    const fileDurationMs = Math.max(1, mediaDurationMs)
    const clipInMs = Math.min(Math.max(0, sourceInMs), fileDurationMs)
    const clipOutMs = Math.min(Math.max(clipInMs + 1, sourceOutMs), fileDurationMs)
    const clipDurationMs = clipOutMs - clipInMs
    const visibleSamples = (clipDurationMs / 1000) * sampleRate
    const level = selectPeakLevel(peaks.levels, visibleSamples, width)

    const msToX = (fileMs: number): number =>
      ((Math.min(clipOutMs, Math.max(clipInMs, fileMs)) - clipInMs) / clipDurationMs) * width

    const startSample = Math.floor((clipInMs / 1000) * sampleRate)
    const endSample = Math.floor((clipOutMs / 1000) * sampleRate)
    const startPeak = Math.max(0, Math.floor(startSample / level.samplesPerPeak))
    const endPeak = Math.min(level.max.length, Math.ceil(endSample / level.samplesPerPeak))

    const midY = height / 2
    const ampScale = (height / 2) * 0.92

    ctx.fillStyle = fillColor

    for (let i = startPeak; i < endPeak; i++) {
      const peakStartMs = (i * level.samplesPerPeak / sampleRate) * 1000
      const peakEndMs = ((i + 1) * level.samplesPerPeak / sampleRate) * 1000
      if (peakEndMs <= clipInMs || peakStartMs >= clipOutMs) continue

      const x = msToX(peakStartMs)
      const xEnd = msToX(peakEndMs)
      const barW = Math.max(1, xEnd - x)
      const maxVal = level.max[i]
      const minVal = level.min[i]
      const top = midY - maxVal * ampScale
      const bottom = midY - minVal * ampScale
      const barH = Math.max(1, bottom - top)
      ctx.fillRect(x, top, barW, barH)
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(width, midY)
    ctx.stroke()

    for (const region of silenceRegions) {
      if (region.removed) continue
      const overlapStart = Math.max(region.startMs, clipInMs)
      const overlapEnd = Math.min(region.endMs, clipOutMs)
      if (overlapEnd <= overlapStart) continue

      const x1 = msToX(overlapStart)
      const x2 = msToX(overlapEnd)
      const regionW = Math.max(1, x2 - x1)

      ctx.fillStyle = 'rgba(234, 179, 8, 0.22)'
      ctx.fillRect(x1, 0, regionW, height)

      ctx.strokeStyle = '#eab308'
      ctx.lineWidth = 2
      ctx.strokeRect(x1 + 0.5, 0.5, regionW - 1, height - 1)
    }
  }, [
    peaks,
    sampleRate,
    mediaDurationMs,
    sourceInMs,
    sourceOutMs,
    width,
    height,
    fillColor,
    silenceRegions
  ])

  if (width < 2 || height < 2) return null

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      aria-hidden
    />
  )
}
