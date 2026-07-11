import { Video } from 'lucide-react'
import { useInView } from '@renderer/hooks/useInView'

export function LazyGalleryMedia({
  src,
  alt,
  isVideo
}: {
  src: string
  alt: string
  isVideo: boolean
  /** @deprecated Videos never decode in the grid — preview in lightbox only. */
  canPlayVideo?: boolean
}): React.JSX.Element {
  const { ref, inView } = useInView({ rootMargin: '120px 0px', once: true })

  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} className="h-full w-full bg-card/80">
      {!inView ? (
        <div className="h-full w-full bg-muted/15" />
      ) : isVideo ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-violet-950/80 to-black/70 text-white/80">
          <Video size={28} className="opacity-90" />
          <span className="text-[9px] px-2 text-center opacity-70">Click to preview</span>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover pointer-events-none select-none"
        />
      )}
    </div>
  )
}
