import type { ScriptSegment } from '@shared/segmentPipeline'
import type { TimelineMarker } from '@shared/types'
import { generateId, clipDurationMs } from '@shared/types'
import { useVideoEditorStore } from '@renderer/stores/videoEditorStore'

export interface SequentialPlacementResult {
  segmentId: string
  clipId: string
  timelineStartMs: number
}

export async function placeSegmentsSequentially(
  segments: ScriptSegment[],
  options: { addSyncMarkers?: boolean } = {}
): Promise<SequentialPlacementResult[]> {
  const { addSyncMarkers = true } = options
  const sorted = [...segments]
    .filter((s) => s.videoLocalPath)
    .sort((a, b) => a.index - b.index)

  if (sorted.length === 0) {
    throw new Error('No completed video segments to place on the timeline.')
  }

  let videoLayer = useVideoEditorStore.getState().project.layers.find((l) => l.type === 'video')
  if (!videoLayer) {
    useVideoEditorStore.getState().addLayer('video')
    videoLayer = useVideoEditorStore.getState().project.layers.find((l) => l.type === 'video')
  }
  if (!videoLayer) {
    throw new Error('Could not create video layer.')
  }

  const results: SequentialPlacementResult[] = []
  let cursorMs = 0

  for (const segment of sorted) {
    if (!segment.videoLocalPath) continue

    if (!window.electronAPI?.probeMediaFile) {
      throw new Error('Media probe is unavailable.')
    }

    const meta = await window.electronAPI.probeMediaFile(segment.videoLocalPath)
    const store = useVideoEditorStore.getState()
    const existing = store.project.assets.find((a) => a.path === meta.path)
    const asset = existing ?? store.addAsset(meta)

    const clipId = useVideoEditorStore.getState().addClipToLayerAt(asset.id, videoLayer.id, cursorMs)
    results.push({ segmentId: segment.id, clipId, timelineStartMs: cursorMs })

    const clip = useVideoEditorStore
      .getState()
      .project.layers.flatMap((l) => l.clips)
      .find((c) => c.id === clipId)
    const duration = clip ? clipDurationMs(clip) : asset.durationMs
    cursorMs += duration
  }

  if (addSyncMarkers) {
    const markers: TimelineMarker[] = sorted
      .filter((s) => s.scriptMatch)
      .map((s) => ({
        id: generateId(),
        timeMs: s.scriptMatch!.startMs,
        label: `Seg ${s.index + 1}`
      }))
    if (markers.length > 0) {
      const current = useVideoEditorStore.getState().project.markers
      useVideoEditorStore.getState().setMarkers([...current, ...markers])
    }
  }

  return results
}
