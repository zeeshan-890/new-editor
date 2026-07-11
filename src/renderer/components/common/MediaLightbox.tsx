import { useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export function MediaLightbox({
  onClose,
  ariaLabel,
  mediaSrc,
  isVideo,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
  positionLabel,
  children
}: {
  onClose: () => void
  ariaLabel: string
  mediaSrc: string
  isVideo: boolean
  onPrevious?: () => void
  onNext?: () => void
  hasPrevious?: boolean
  hasNext?: boolean
  positionLabel?: string
  children: React.ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft' && hasPrevious && onPrevious) {
        event.preventDefault()
        onPrevious()
      }
      if (event.key === 'ArrowRight' && hasNext && onNext) {
        event.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrevious, onNext, hasPrevious, hasNext])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        {isVideo ? (
          <video
            src={mediaSrc}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full scale-125 object-cover blur-3xl brightness-[0.45] saturate-125"
          />
        ) : (
          <img
            src={mediaSrc}
            alt=""
            className="absolute inset-0 h-full w-full scale-125 object-cover blur-3xl brightness-[0.45] saturate-125"
          />
        )}
        <div className="absolute inset-0 bg-black/45 backdrop-blur-md" />
      </div>

      <div
        className="relative z-10 flex max-h-[92vh] max-w-[96vw] flex-col items-center gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        {(hasPrevious || hasNext || positionLabel) && (
          <div className="flex w-full items-center justify-center gap-3 text-white/80 text-xs">
            <button
              type="button"
              disabled={!hasPrevious}
              onClick={onPrevious}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 transition-colors',
                hasPrevious ? 'hover:bg-white/10' : 'opacity-40 cursor-not-allowed'
              )}
              aria-label="Previous image"
            >
              <ChevronLeft size={16} /> Previous
            </button>
            {positionLabel && <span className="text-white/70">{positionLabel}</span>}
            <button
              type="button"
              disabled={!hasNext}
              onClick={onNext}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 transition-colors',
                hasNext ? 'hover:bg-white/10' : 'opacity-40 cursor-not-allowed'
              )}
              aria-label="Next image"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
