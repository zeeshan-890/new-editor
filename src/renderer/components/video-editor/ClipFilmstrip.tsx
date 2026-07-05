import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'
import type { VideoFilmstrip } from '@shared/types'

interface ClipFilmstripProps {
  filmstrip: VideoFilmstrip
  sourceInMs: number
  sourceOutMs: number
  height: number
}

export function ClipFilmstrip({
  filmstrip,
  sourceInMs,
  sourceOutMs,
  height
}: ClipFilmstripProps): React.JSX.Element {
  const { frames, intervalMs } = filmstrip

  if (frames.length === 1) {
    return (
      <img
        src={localMediaPathUrl(frames[0])}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover pointer-events-none"
        style={{ height }}
      />
    )
  }

  const startIdx = Math.max(0, Math.floor(sourceInMs / intervalMs))
  const endIdx = Math.min(frames.length, Math.ceil(sourceOutMs / intervalMs))
  let visible = frames.slice(startIdx, Math.max(startIdx + 1, endIdx))

  if (visible.length === 0) {
    const fallback = frames[Math.min(startIdx, frames.length - 1)]
    visible = fallback ? [fallback] : []
  }

  return (
    <div className="absolute inset-0 flex overflow-hidden pointer-events-none" style={{ height }}>
      {visible.map((path, index) => (
        <img
          key={`${path}-${index}`}
          src={localMediaPathUrl(path)}
          alt=""
          draggable={false}
          className="h-full flex-1 min-w-0 object-cover border-r border-black/20 last:border-r-0"
        />
      ))}
    </div>
  )
}
