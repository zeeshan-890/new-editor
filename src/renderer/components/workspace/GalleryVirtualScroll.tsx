import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GalleryEntry } from '@renderer/lib/projectGallerySections'

const GAP_PX = 12
const SECTION_GAP_PX = 24
const HEADER_HEIGHT_PX = 36
const OVERSCAN_PX = 400

function columnsForWidth(width: number): number {
  if (width >= 1280) return 4
  if (width >= 768) return 3
  return 2
}

type GalleryRow =
  | { kind: 'header'; key: string; title: string; count: number }
  | { kind: 'tiles'; key: string; entries: GalleryEntry[] }

function buildRows(
  sections: Array<{ id: string; title: string; entries: GalleryEntry[] }>,
  columns: number
): GalleryRow[] {
  const rows: GalleryRow[] = []
  for (const section of sections) {
    if (section.entries.length === 0) continue
    rows.push({
      kind: 'header',
      key: `header-${section.id}`,
      title: section.title,
      count: section.entries.length
    })
    for (let index = 0; index < section.entries.length; index += columns) {
      rows.push({
        kind: 'tiles',
        key: `tiles-${section.id}-${index}`,
        entries: section.entries.slice(index, index + columns)
      })
    }
  }
  return rows
}

export function GalleryVirtualScroll({
  sections,
  getEntryKey,
  renderTile
}: {
  sections: Array<{ id: string; title: string; entries: GalleryEntry[] }>
  getEntryKey: (entry: GalleryEntry) => string
  renderTile: (entry: GalleryEntry) => React.ReactNode
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState({ width: 0, height: 0, scrollTop: 0 })

  const syncWidth = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setLayout((prev) => ({
      ...prev,
      width: el.clientWidth,
      height: el.clientHeight
    }))
  }, [])

  const columns = Math.max(1, columnsForWidth(layout.width))
  const tileWidth =
    layout.width > 0
      ? (layout.width - GAP_PX * (columns - 1)) / columns
      : 200
  const tileRowHeight = tileWidth + GAP_PX

  const rows = useMemo(
    () => buildRows(sections, columns),
    [sections, columns]
  )

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    syncWidth()
    const ro = new ResizeObserver(syncWidth)
    ro.observe(el)
    let rafId = 0
    const onScroll = (): void => {
      if (rafId) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        setLayout((prev) => ({ ...prev, scrollTop: el.scrollTop }))
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', onScroll)
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [syncWidth, rows.length])

  const rowMetrics = useMemo(() => {
    let offset = 0
    return rows.map((row, index) => {
      const height =
        row.kind === 'header'
          ? HEADER_HEIGHT_PX + (index > 0 ? SECTION_GAP_PX : 0)
          : tileRowHeight
      const top = offset
      offset += height
      return { top, height }
    })
  }, [rows, tileRowHeight])

  const totalHeight = rowMetrics.at(-1)
    ? rowMetrics.at(-1)!.top + rowMetrics.at(-1)!.height
    : 0

  const viewTop = layout.scrollTop
  const viewBottom = viewTop + layout.height
  let startIndex = 0
  let endIndex = Math.max(0, rows.length - 1)
  for (let index = 0; index < rows.length; index++) {
    const metric = rowMetrics[index]
    if (metric.top + metric.height >= viewTop - OVERSCAN_PX) {
      startIndex = index
      break
    }
  }
  for (let index = rows.length - 1; index >= 0; index--) {
    const metric = rowMetrics[index]
    if (metric.top <= viewBottom + OVERSCAN_PX) {
      endIndex = index
      break
    }
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden px-1">
      <div className="relative w-full" style={{ height: totalHeight }}>
        {rows.slice(startIndex, endIndex + 1).map((row, sliceIndex) => {
          const index = startIndex + sliceIndex
          const metric = rowMetrics[index]
          if (row.kind === 'header') {
            return (
              <div
                key={row.key}
                className="absolute left-0 right-0"
                style={{ top: metric.top, height: metric.height }}
              >
                {index > 0 && <div style={{ height: SECTION_GAP_PX }} />}
                <h3 className="text-xs font-semibold text-foreground/80 uppercase tracking-wide border-b border-border pb-1">
                  {row.title}
                  <span className="ml-2 text-muted font-normal normal-case">({row.count})</span>
                </h3>
              </div>
            )
          }

          return (
            <div
              key={row.key}
              className="absolute left-0 right-0 grid gap-3"
              style={{
                top: metric.top,
                height: metric.height,
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
              }}
            >
              {row.entries.map((entry) => (
                <div key={getEntryKey(entry)} className="min-w-0">
                  {renderTile(entry)}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
