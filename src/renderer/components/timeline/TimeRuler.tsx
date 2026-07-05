import { formatTime } from '@renderer/lib/utils'
import { usePlaybackStore } from '@renderer/stores/playbackStore'
import { useEditorStore } from '@renderer/stores/editorStore'

export function TimeRuler({
  width,
  height = 24
}: {
  width: number
  height?: number
}): React.JSX.Element {
  const metadata = useEditorStore((s) => s.metadata)
  const scrollMs = usePlaybackStore((s) => s.scrollMs)
  const zoom = usePlaybackStore((s) => s.zoom)

  if (!metadata || width <= 0) {
    return <canvas width={width} height={height} className="block w-full" />
  }

  const durationMs = metadata.durationMs
  const visibleDurationMs = durationMs / zoom
  const tickCount = Math.min(20, Math.max(4, Math.floor(width / 80)))

  return (
    <canvas
      ref={(canvas) => {
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const dpr = window.devicePixelRatio || 1
        canvas.width = width * dpr
        canvas.height = height * dpr
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, width, height)
        ctx.fillStyle = '#64748b'
        ctx.strokeStyle = '#334155'
        ctx.font = '10px system-ui'
        ctx.textAlign = 'center'

        for (let i = 0; i <= tickCount; i++) {
          const ratio = i / tickCount
          const ms = scrollMs + ratio * visibleDurationMs
          const x = ratio * width
          ctx.beginPath()
          ctx.moveTo(x, height - 8)
          ctx.lineTo(x, height)
          ctx.stroke()
          ctx.fillText(formatTime(ms, false), x, height - 10)
        }
      }}
      className="block w-full border-b border-border"
    />
  )
}
