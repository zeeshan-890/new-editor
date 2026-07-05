import { create } from 'zustand'
import type { MediaAsset, MediaAssetType, TimelineClip, TimelineLayer, VideoEditorProject, WaveformPeaks } from '@shared/types'
import {
  clipDurationMs,
  createEmptyVideoEditorProject,
  generateId,
  sequenceDurationMs
} from '@shared/types'
import { normalizePeaks } from '@renderer/lib/audio/normalizePeaks'
import { usePlaybackStore } from './playbackStore'

export interface AssetWaveform {
  sampleRate: number
  peaks: WaveformPeaks
}

interface HistorySnapshot {
  layers: TimelineLayer[]
  assets: MediaAsset[]
}

function cloneLayers(layers: TimelineLayer[]): TimelineLayer[] {
  return layers.map((layer) => ({
    ...layer,
    clips: layer.clips.map((clip) => ({ ...clip }))
  }))
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function isLayerCompatible(layer: TimelineLayer, assetType: MediaAssetType): boolean {
  if (layer.type === 'video' && assetType === 'video') return true
  if (layer.type === 'audio' && assetType === 'audio') return true
  if (layer.type === 'overlay' && (assetType === 'image' || assetType === 'video')) return true
  return false
}

function defaultLayerForAsset(
  layers: TimelineLayer[],
  assetType: MediaAssetType
): TimelineLayer | undefined {
  if (assetType === 'video') return layers.find((l) => l.type === 'video')
  if (assetType === 'audio') return layers.find((l) => l.type === 'audio')
  if (assetType === 'image') {
    return layers.find((l) => l.type === 'overlay') ?? layers.find((l) => l.type === 'video')
  }
  return undefined
}

function splitClipPair(clip: TimelineClip, timeMs: number): [TimelineClip, TimelineClip] {
  const offsetInClip = timeMs - clip.timelineStartMs
  const splitSourceMs = clip.sourceInMs + offsetInClip
  const left: TimelineClip = { ...clip, sourceOutMs: splitSourceMs }
  const right: TimelineClip = {
    ...clip,
    id: generateId(),
    timelineStartMs: timeMs,
    sourceInMs: splitSourceMs
  }
  return [left, right]
}

function clipContainsTime(clip: TimelineClip, timeMs: number, marginMs = 50): boolean {
  const end = clip.timelineStartMs + clipDurationMs(clip)
  return timeMs > clip.timelineStartMs + marginMs && timeMs < end - marginMs
}

function insertLayer(layers: TimelineLayer[], layer: TimelineLayer): TimelineLayer[] {
  const next = [...layers]
  if (layer.type === 'video') {
    next.unshift(layer)
  } else if (layer.type === 'overlay') {
    const audioIndex = next.findIndex((l) => l.type === 'audio')
    next.splice(audioIndex >= 0 ? audioIndex : next.length, 0, layer)
  } else {
    next.push(layer)
  }
  return next
}

export const useVideoEditorStore = create<{
  project: VideoEditorProject
  undoStack: HistorySnapshot[]
  redoStack: HistorySnapshot[]
  durationMs: number
  waveformCache: Record<string, AssetWaveform>
  waveformLoading: Record<string, boolean>

  resetProject: () => void
  pushHistory: () => void
  undo: () => void
  redo: () => void
  addAsset: (asset: Omit<MediaAsset, 'id'>) => MediaAsset
  loadWaveformForAsset: (assetId: string, filePath: string) => Promise<void>
  addLayer: (type?: TimelineLayer['type']) => void
  removeLayer: (layerId: string) => void
  toggleLayerMute: (layerId: string) => void
  toggleLayerLock: (layerId: string) => void
  selectLayer: (layerId: string | null) => void
  selectClip: (clipId: string | null) => void
  addClipToLayer: (assetId: string, layerId?: string, atMs?: number) => void
  splitAllAtPlayhead: () => void
  splitSelectedClipAt: (timeMs: number) => void
  splitClipAtPlayhead: () => void
  trimSelectedClip: (edge: 'in' | 'out', deltaMs: number) => void
  deleteSelectedClip: () => void
  moveSelectedClip: (timelineStartMs: number) => void
  replaceClipWithAsset: (clipId: string, assetInput: Omit<MediaAsset, 'id'>) => void
  clipsAtPlayhead: (timeMs: number) => Array<{ clip: TimelineClip; layer: TimelineLayer; asset: MediaAsset }>
  getSelectedClip: () => { clip: TimelineClip; layer: TimelineLayer; asset: MediaAsset } | null
  clipAtPlayhead: (timeMs: number) => { clip: TimelineClip; layer: TimelineLayer; asset: MediaAsset } | null
  visualClipAtPlayhead: (timeMs: number) => { clip: TimelineClip; layer: TimelineLayer; asset: MediaAsset } | null
  audioClipAtPlayhead: (timeMs: number) => { clip: TimelineClip; layer: TimelineLayer; asset: MediaAsset } | null
}>((set, get) => ({
  project: createEmptyVideoEditorProject(),
  undoStack: [],
  redoStack: [],
  durationMs: 1000,
  waveformCache: {},
  waveformLoading: {},

  resetProject: () =>
    set({
      project: createEmptyVideoEditorProject(),
      undoStack: [],
      redoStack: [],
      durationMs: 1000,
      waveformCache: {},
      waveformLoading: {}
    }),

  pushHistory: () => {
    const { project, undoStack } = get()
    set({
      undoStack: [
        ...undoStack.slice(-40),
        { layers: cloneLayers(project.layers), assets: [...project.assets] }
      ],
      redoStack: []
    })
  },

  undo: () => {
    const { project, undoStack, redoStack } = get()
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [
        ...redoStack,
        { layers: cloneLayers(project.layers), assets: [...project.assets] }
      ],
      project: { ...project, layers: cloneLayers(prev.layers), assets: [...prev.assets] },
      durationMs: sequenceDurationMs(prev.layers)
    })
  },

  redo: () => {
    const { project, undoStack, redoStack } = get()
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    set({
      redoStack: redoStack.slice(0, -1),
      undoStack: [
        ...undoStack,
        { layers: cloneLayers(project.layers), assets: [...project.assets] }
      ],
      project: { ...project, layers: cloneLayers(next.layers), assets: [...next.assets] },
      durationMs: sequenceDurationMs(next.layers)
    })
  },

  addAsset: (assetInput) => {
    const asset: MediaAsset = { ...assetInput, id: generateId() }
    set((state) => ({
      project: { ...state.project, assets: [...state.project.assets, asset] }
    }))
    if (asset.type === 'audio' || asset.type === 'video') {
      void get().loadWaveformForAsset(asset.id, asset.path)
    }
    return asset
  },

  loadWaveformForAsset: async (assetId, filePath) => {
    const { waveformCache, waveformLoading } = get()
    if (waveformCache[assetId] || waveformLoading[assetId]) return
    if (!window.electronAPI?.getAudioPeaks) return

    set((state) => ({
      waveformLoading: { ...state.waveformLoading, [assetId]: true }
    }))

    try {
      const result = await window.electronAPI.getAudioPeaks(filePath)
      set((state) => ({
        waveformCache: {
          ...state.waveformCache,
          [assetId]: {
            sampleRate: result.sampleRate,
            peaks: normalizePeaks(result.peaks)
          }
        },
        waveformLoading: { ...state.waveformLoading, [assetId]: false }
      }))
    } catch {
      set((state) => ({
        waveformLoading: { ...state.waveformLoading, [assetId]: false }
      }))
    }
  },

  addLayer: (type = 'video') => {
    get().pushHistory()
    const layer: TimelineLayer = {
      id: generateId(),
      name: `${type === 'video' ? 'Video' : type === 'audio' ? 'Audio' : 'Overlay'} ${get().project.layers.filter((l) => l.type === type).length + 1}`,
      type,
      clips: [],
      locked: false,
      muted: false
    }
    set((state) => ({
      project: {
        ...state.project,
        layers: insertLayer(state.project.layers, layer),
        selectedLayerId: layer.id
      }
    }))
  },

  removeLayer: (layerId) => {
    const { project } = get()
    const layer = project.layers.find((l) => l.id === layerId)
    if (!layer || layer.clips.length > 0) return
    get().pushHistory()
    set((state) => ({
      project: {
        ...state.project,
        layers: state.project.layers.filter((l) => l.id !== layerId),
        selectedLayerId:
          state.project.selectedLayerId === layerId
            ? state.project.layers.find((l) => l.id !== layerId)?.id ?? null
            : state.project.selectedLayerId
      }
    }))
  },

  toggleLayerMute: (layerId) =>
    set((state) => ({
      project: {
        ...state.project,
        layers: state.project.layers.map((l) =>
          l.id === layerId ? { ...l, muted: !l.muted } : l
        )
      }
    })),

  toggleLayerLock: (layerId) =>
    set((state) => ({
      project: {
        ...state.project,
        layers: state.project.layers.map((l) =>
          l.id === layerId ? { ...l, locked: !l.locked } : l
        )
      }
    })),

  selectLayer: (layerId) =>
    set((state) => ({ project: { ...state.project, selectedLayerId: layerId } })),

  selectClip: (clipId) =>
    set((state) => ({ project: { ...state.project, selectedClipId: clipId } })),

  addClipToLayer: (assetId, layerId, atMs) => {
    const { project } = get()
    const asset = project.assets.find((a) => a.id === assetId)
    if (!asset) return

    let layer = layerId ? project.layers.find((l) => l.id === layerId) : undefined
    if (!layer || !isLayerCompatible(layer, asset.type)) {
      layer = defaultLayerForAsset(project.layers, asset.type)
    }
    if (!layer || layer.locked) return

    get().pushHistory()
    const playhead = atMs ?? usePlaybackStore.getState().playheadMs
    const clip: TimelineClip = {
      id: generateId(),
      assetId,
      layerId: layer.id,
      timelineStartMs: Math.max(0, playhead),
      sourceInMs: 0,
      sourceOutMs: asset.durationMs
    }

    set((state) => {
      const layers = state.project.layers.map((l) =>
        l.id === layer!.id ? { ...l, clips: [...l.clips, clip] } : l
      )
      return {
        project: {
          ...state.project,
          layers,
          selectedClipId: clip.id,
          selectedLayerId: layer!.id
        },
        durationMs: sequenceDurationMs(layers)
      }
    })
  },

  splitAllAtPlayhead: () => {
    const timeMs = usePlaybackStore.getState().playheadMs
    const { project } = get()
    const hits: Array<{ clip: TimelineClip; layer: TimelineLayer }> = []

    for (const layer of project.layers) {
      if (layer.locked) continue
      for (const clip of layer.clips) {
        if (clipContainsTime(clip, timeMs)) {
          hits.push({ clip, layer })
        }
      }
    }

    if (hits.length === 0) return

    get().pushHistory()
    set((state) => {
      let layers = cloneLayers(state.project.layers)
      for (const { clip, layer } of hits) {
        const [left, right] = splitClipPair(clip, timeMs)
        layers = layers.map((l) =>
          l.id === layer.id
            ? { ...l, clips: l.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c])) }
            : l
        )
      }
      const rightmost = hits[hits.length - 1]
      const rightClip = layers
        .find((l) => l.id === rightmost.layer.id)
        ?.clips.find((c) => c.timelineStartMs === timeMs && c.sourceInMs > 0)
      return {
        project: {
          ...state.project,
          layers,
          selectedClipId: rightClip?.id ?? state.project.selectedClipId
        },
        durationMs: sequenceDurationMs(layers)
      }
    })
  },

  splitSelectedClipAt: (timeMs) => {
    const selected = get().getSelectedClip()
    if (!selected || selected.layer.locked) return

    const { clip, layer } = selected
    if (!clipContainsTime(clip, timeMs)) return

    get().pushHistory()
    const [left, right] = splitClipPair(clip, timeMs)

    set((state) => {
      const layers = state.project.layers.map((l) => {
        if (l.id !== layer.id) return l
        return {
          ...l,
          clips: l.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c]))
        }
      })
      return {
        project: { ...state.project, layers, selectedClipId: right.id },
        durationMs: sequenceDurationMs(layers)
      }
    })
  },

  splitClipAtPlayhead: () => {
    get().splitAllAtPlayhead()
  },

  trimSelectedClip: (edge, deltaMs) => {
    const selected = get().getSelectedClip()
    if (!selected || selected.layer.locked) return

    const { clip, layer, asset } = selected

    set((state) => {
      const layers = state.project.layers.map((l) => {
        if (l.id !== layer.id) return l
        return {
          ...l,
          clips: l.clips.map((c) => {
            if (c.id !== clip.id) return c
            if (edge === 'in') {
              const nextIn = clamp(c.sourceInMs + deltaMs, 0, c.sourceOutMs - 100)
              const deltaTimeline = nextIn - c.sourceInMs
              return {
                ...c,
                sourceInMs: nextIn,
                timelineStartMs: c.timelineStartMs + deltaTimeline
              }
            }
            const nextOut = clamp(c.sourceOutMs + deltaMs, c.sourceInMs + 100, asset.durationMs)
            return { ...c, sourceOutMs: nextOut }
          })
        }
      })
      return {
        project: { ...state.project, layers },
        durationMs: sequenceDurationMs(layers)
      }
    })
  },

  deleteSelectedClip: () => {
    const { project } = get()
    let clipId = project.selectedClipId

    if (!clipId) {
      const timeMs = usePlaybackStore.getState().playheadMs
      const layer = project.selectedLayerId
        ? project.layers.find((l) => l.id === project.selectedLayerId)
        : project.layers.find((l) => l.type === 'video')
      const hit = layer?.clips.find(
        (c) => timeMs >= c.timelineStartMs && timeMs < c.timelineStartMs + clipDurationMs(c)
      )
      clipId = hit?.id ?? null
    }

    if (!clipId) return

    const layer = project.layers.find((l) => l.clips.some((c) => c.id === clipId))
    if (layer?.locked) return

    get().pushHistory()
    set((state) => {
      const layers = state.project.layers.map((l) => ({
        ...l,
        clips: l.clips.filter((c) => c.id !== clipId)
      }))
      return {
        project: {
          ...state.project,
          layers,
          selectedClipId: state.project.selectedClipId === clipId ? null : state.project.selectedClipId
        },
        durationMs: sequenceDurationMs(layers)
      }
    })
  },

  moveSelectedClip: (timelineStartMs) => {
    const { project } = get()
    if (!project.selectedClipId) return
    const layer = project.layers.find((l) => l.clips.some((c) => c.id === project.selectedClipId))
    if (layer?.locked) return
    set((state) => {
      const layers = state.project.layers.map((l) => ({
        ...l,
        clips: l.clips.map((c) =>
          c.id === state.project.selectedClipId
            ? { ...c, timelineStartMs: Math.max(0, timelineStartMs) }
            : c
        )
      }))
      return {
        project: { ...state.project, layers },
        durationMs: sequenceDurationMs(layers)
      }
    })
  },

  replaceClipWithAsset: (clipId, assetInput) => {
    const asset: MediaAsset = { ...assetInput, id: generateId() }
    get().pushHistory()
    set((state) => {
      const layers = state.project.layers.map((l) => ({
        ...l,
        clips: l.clips.map((c) =>
          c.id === clipId
            ? {
                ...c,
                assetId: asset.id,
                sourceInMs: 0,
                sourceOutMs: asset.durationMs
              }
            : c
        )
      }))
      return {
        project: {
          ...state.project,
          assets: [...state.project.assets, asset],
          layers,
          selectedClipId: clipId
        },
        durationMs: sequenceDurationMs(layers)
      }
    })
    void get().loadWaveformForAsset(asset.id, asset.path)
  },

  clipsAtPlayhead: (timeMs) => {
    const { project } = get()
    const hits: Array<{ clip: TimelineClip; layer: TimelineLayer; asset: MediaAsset }> = []
    for (const layer of project.layers) {
      for (const clip of layer.clips) {
        const end = clip.timelineStartMs + clipDurationMs(clip)
        if (timeMs >= clip.timelineStartMs && timeMs < end) {
          const asset = project.assets.find((a) => a.id === clip.assetId)
          if (asset) hits.push({ clip, layer, asset })
        }
      }
    }
    return hits
  },

  getSelectedClip: () => {
    const { project } = get()
    if (!project.selectedClipId) return null
    for (const layer of project.layers) {
      const clip = layer.clips.find((c) => c.id === project.selectedClipId)
      if (!clip) continue
      const asset = project.assets.find((a) => a.id === clip.assetId)
      if (!asset) return null
      return { clip, layer, asset }
    }
    return null
  },

  clipAtPlayhead: (timeMs) => {
    const { project } = get()
    for (let li = project.layers.length - 1; li >= 0; li--) {
      const layer = project.layers[li]
      for (const clip of layer.clips) {
        const end = clip.timelineStartMs + clipDurationMs(clip)
        if (timeMs >= clip.timelineStartMs && timeMs < end) {
          const asset = project.assets.find((a) => a.id === clip.assetId)
          if (asset) return { clip, layer, asset }
        }
      }
    }
    return null
  },

  visualClipAtPlayhead: (timeMs) => {
    const { project } = get()
    for (let li = project.layers.length - 1; li >= 0; li--) {
      const layer = project.layers[li]
      if (layer.type === 'audio' || layer.muted) continue
      for (const clip of layer.clips) {
        const end = clip.timelineStartMs + clipDurationMs(clip)
        if (timeMs >= clip.timelineStartMs && timeMs < end) {
          const asset = project.assets.find((a) => a.id === clip.assetId)
          if (asset && asset.type !== 'audio') return { clip, layer, asset }
        }
      }
    }
    return null
  },

  audioClipAtPlayhead: (timeMs) => {
    const { project } = get()
    for (const layer of project.layers) {
      if (layer.type !== 'audio' || layer.muted) continue
      for (const clip of layer.clips) {
        const end = clip.timelineStartMs + clipDurationMs(clip)
        if (timeMs >= clip.timelineStartMs && timeMs < end) {
          const asset = project.assets.find((a) => a.id === clip.assetId)
          if (asset && asset.type === 'audio') return { clip, layer, asset }
        }
      }
    }
    return null
  }
}))
