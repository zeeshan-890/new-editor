import { useEffect, useRef, useState } from 'react'

/** True once the element has entered (or is near) the viewport. Stays true after first view. */
export function useInView(options?: { rootMargin?: string; once?: boolean }): {
  ref: React.RefObject<HTMLElement | null>
  inView: boolean
} {
  const ref = useRef<HTMLElement | null>(null)
  const [inView, setInView] = useState(false)
  const rootMargin = options?.rootMargin ?? '200px 0px'
  const once = options?.once ?? true

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (once && inView) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
            if (once) observer.disconnect()
          } else if (!once) {
            setInView(false)
          }
        }
      },
      { rootMargin, threshold: 0.01 }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [rootMargin, once, inView])

  return { ref, inView }
}
