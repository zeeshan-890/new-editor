import type { SilenceRegion } from '../../shared/types'

export function mergeRegionsHybrid(
  traditional: SilenceRegion[],
  vad: SilenceRegion[],
  mode: 'intersection' | 'union'
): SilenceRegion[] {
  if (mode === 'union') {
    return mergeAllRegions([...traditional, ...vad])
  }

  return intersectRegions(traditional, vad)
}

function mergeAllRegions(regions: SilenceRegion[]): SilenceRegion[] {
  if (regions.length === 0) return []
  const sorted = [...regions].sort((a, b) => a.startMs - b.startMs)
  const merged: SilenceRegion[] = [{ ...sorted[0], source: 'hybrid' as const }]

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    const last = merged[merged.length - 1]
    if (cur.startMs <= last.endMs + 1) {
      last.endMs = Math.max(last.endMs, cur.endMs)
      last.confidence = Math.max(last.confidence, cur.confidence)
    } else {
      merged.push({ ...cur, source: 'hybrid' })
    }
  }

  return merged
}

function intersectRegions(a: SilenceRegion[], b: SilenceRegion[]): SilenceRegion[] {
  const result: SilenceRegion[] = []

  for (const ra of a) {
    for (const rb of b) {
      const start = Math.max(ra.startMs, rb.startMs)
      const end = Math.min(ra.endMs, rb.endMs)
      if (end - start > 0) {
        result.push({
          id: `${ra.id}-${rb.id}`,
          startMs: start,
          endMs: end,
          confidence: Math.min(ra.confidence, rb.confidence),
          source: 'hybrid',
          removed: false
        })
      }
    }
  }

  return mergeAllRegions(result)
}
