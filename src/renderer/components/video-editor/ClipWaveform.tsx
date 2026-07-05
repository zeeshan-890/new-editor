import { useEffect, useRef } from 'react'
import type { WaveformPeaks } from '@shared/types'
import { selectPeakLevel } from '@renderer/lib/audio/peaks'

interface ClipWaveformProps {
  peaks: WaveformPeaks
  sampleRate: number
  sourceInMs: number
  sourceOutMs: number
  width: number
  height: number
  fillColor?: string
}

export function ClipWaveform({
  peaks,
  sampleRate,
  sourceInMs,
  sourceOutMs,
  width,
  height,
  fillColor = 'rgba(52, 211, 153, 0.85)'
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

    const clipDurationMs = Math.max(1, sourceOutMs - sourceInMs)
    const visibleSamples = (clipDurationMs / 1000) * sampleRate
    const level = selectPeakLevel(peaks.levels, visibleSamples, width)

    const startSample = Math.floor((sourceInMs / 1000) * sampleRate)
    const endSample = Math.floor((sourceOutMs / 1000) * sampleRate)
    const startPeak = Math.max(0, Math.floor(startSample / level.samplesPerPeak))
    const endPeak = Math.min(level.max.length, Math.ceil(endSample / level.samplesPerPeak))
    const peakSpan = Math.max(1, endPeak - startPeak)

    const midY = height / 2
    const ampScale = (height / 2) * 0.92
    const barW = Math.max(1, width / peakSpan)

    ctx.fillStyle = fillColor

    for (let i = startPeak; i < endPeak; i++) {
      const maxVal = level.max[i]
      const minVal = level.min[i]
      const x = ((i - startPeak) / peakSpan) * width
      const top = midY - maxVal * ampScale
      const bottom = midY - minVal * ampScale
      const barH = Math.max(1, bottom - top)
      ctx.fillRect(x, top, barW + 0.5, barH)
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(width, midY)
    ctx.stroke()
  }, [peaks, sampleRate, sourceInMs, sourceOutMs, width, height, fillColor])

  if (width < 2 || height < 2) return null

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      aria-hidden
    />
  )
}
