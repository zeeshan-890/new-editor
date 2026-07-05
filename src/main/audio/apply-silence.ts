import type { EditOperation, SilenceRegion } from '../../shared/types'
import { generateId } from '../../shared/types'

export function regionsToRemoveOperations(regions: SilenceRegion[]): EditOperation[] {
  return regions
    .filter((r) => !r.removed)
    .map((r) => ({
      id: generateId(),
      type: 'remove' as const,
      startMs: r.startMs,
      endMs: r.endMs
    }))
}

export function applyPaddingToRegions(
  regions: SilenceRegion[],
  prePaddingMs: number,
  postPaddingMs: number,
  durationMs: number
): SilenceRegion[] {
  return regions.map((r) => ({
    ...r,
    startMs: Math.max(0, r.startMs - prePaddingMs),
    endMs: Math.min(durationMs, r.endMs + postPaddingMs)
  }))
}

export function mergeOverlappingRegions(regions: SilenceRegion[]): SilenceRegion[] {
  if (regions.length === 0) return []
  const sorted = [...regions].sort((a, b) => a.startMs - b.startMs)
  const merged: SilenceRegion[] = [{ ...sorted[0] }]

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const last = merged[merged.length - 1]
    if (current.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, current.endMs)
      last.confidence = Math.max(last.confidence, current.confidence)
    } else {
      merged.push({ ...current })
    }
  }

  return merged
}
