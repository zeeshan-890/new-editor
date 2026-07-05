import { useEffect, useRef } from 'react'
import { formatTime } from '@renderer/lib/utils'

function pickRulerStepMs(visibleDurationMs: number, widthPx: number): number {
  const targetTicks = Math.max(4, widthPx / 72)
  const raw = visibleDurationMs / targetTicks
  const steps = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000]
  return steps.find((step) => step >= raw) ?? steps[steps.length - 1]
}

export function VideoTimeRuler({
  width,
  height = 24,
  scrollMs,
  visibleDurationMs,
  msToX
}: {
  width: number
  height?: number
  scrollMs: number
  visibleDurationMs: number
  msToX: (ms: number) => number
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(width * dpr))
    canvas.height = Math.max(1, Math.floor(height * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const stepMs = pickRulerStepMs(visibleDurationMs, width)
    const viewEnd = scrollMs + visibleDurationMs
    let tickMs = Math.floor(scrollMs / stepMs) * stepMs
    if (tickMs < scrollMs) tickMs += stepMs

    ctx.fillStyle = '#94a3b8'
    ctx.strokeStyle = '#475569'
    ctx.font = '10px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'

    while (tickMs <= viewEnd + stepMs * 0.01) {
      const x = msToX(tickMs)
      if (x >= -1 && x <= width + 1) {
        ctx.beginPath()
        ctx.moveTo(x, height - 6)
        ctx.lineTo(x, height)
        ctx.stroke()
        ctx.fillText(formatTime(tickMs, false), x, height - 8)
      }
      tickMs += stepMs
    }
  }, [width, height, scrollMs, visibleDurationMs, msToX])

  return <canvas ref={canvasRef} className="block h-6 max-w-full" style={{ width: width > 0 ? width : undefined }} />
}
