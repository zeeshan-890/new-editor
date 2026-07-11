import { create } from 'zustand'
import type {
  MediaAsset,
  MediaAssetType,
  SilenceRegion,
  TimelineClip,
  TimelineLayer,
  TimelineMarker,
  VideoEditorProject,
  VideoFilmstrip,
  WaveformPeaks
} from '@shared/types'
import {
  clipDurationMs,
  createEmptyVideoEditorProject,
  generateId,
  normalizeVideoEditorProject,
  sequenceDurationMs
} from '@shared/types'
import { normalizePeaks } from '@renderer/lib/audio/normalizePeaks'
import { usePlayheadStore } from '@renderer/stores/playheadStore'
import { usePlaybackStore } from '@renderer/stores/playbackStore'

function isDerivedEditAsset(asset: MediaAsset): boolean {
  const path = asset.path.replace(/\\/g, '/')
  return /\/ve-audio-\d+\.wav$/i.test(path) || asset.name.includes('(no silence)')
}

function pruneDerivedOrphans(assets: MediaAsset[], layers: TimelineLayer[]): MediaAsset[] {
  const referenced = new Set(layers.flatMap((layer) => layer.clips.map((clip) => clip.assetId)))
  return assets.filter((asset) => referenced.has(asset.id) || !isDerivedEditAsset(asset))
}

function countAssetUsage(layers: TimelineLayer[], assetId: string): number {
  return layers.reduce((count, layer) => count + layer.clips.filter((clip) => clip.assetId === assetId).length, 0)
}

export interface AssetWaveform {
  sampleRate: number
  peaks: WaveformPeaks
  durationMs: number
}

export const EMPTY_SILENCE_REGIONS: SilenceRegion[] = []
export const EMPTY_TIMELINE_MARKERS: TimelineMarker[] = []

interface HistorySnapshot {
  layers: TimelineLayer[]
  assets: MediaAsset[]
  markers: TimelineMarker[]
}

interface ClipClipboard {
  assetId: string
  sourceInMs: number
  sourceOutMs: number
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

function layerTypeForAsset(assetType: MediaAssetType): TimelineLayer['type'] {
  if (assetType === 'audio') return 'audio'
  if (assetType === 'image') return 'overlay'
  return 'video'
}

function createLayerOfType(type: TimelineLayer['type'], layers: TimelineLayer[]): TimelineLayer {
  const count = layers.filter((l) => l.type === type).length + 1
  const label = type === 'video' ? 'Video' : type === 'audio' ? 'Audio' : 'Overlay'
  return {
    id: generateId(),
    name: `${label} ${count}`,
    type,
    clips: [],
    locked: false,
    muted: false
  }
}

export type ClipDropTarget = {
  layerId: string | null
  insertIndex: number
  createNew: boolean
  layerType: TimelineLayer['type']
}

function resolveDropTarget(
  layers: TimelineLayer[],
  assetType: MediaAssetType,
  visualIndex: number
): ClipDropTarget {
  const layerType = layerTypeForAsset(assetType)
  const idx = clamp(visualIndex, 0, layers.length)

  if (idx < layers.length) {
    const row = layers[idx]
    if (!row.locked && isLayerCompatible(row, assetType)) {
      return { layerId: row.id, insertIndex: idx, createNew: false, layerType }
    }
  }

  return { layerId: null, insertIndex: idx, createNew: true, layerType }
}

export const useVideoEditorStore = create<{
  project: VideoEditorProject
  undoStack: HistorySnapshot[]
  redoStack: HistorySnapshot[]
  durationMs: number
  waveformCache: Record<string, AssetWaveform>
  waveformLoading: Record<string, boolean>
  filmstripCache: Record<string, VideoFilmstrip>
  filmstripLoading: Record<string, boolean>
  silenceRegionsByClipId: Record<string, SilenceRegion[]>
  clipClipboard: ClipClipboard | null
  boundProjectId: string | null

  resetProject: () => void
  pushHistory: () => void
  undo: () => void
  redo: () => void
  addAsset: (asset: Omit<MediaAsset, 'id'>) => MediaAsset
  loadWaveformForAsset: (assetId: string, filePath: string, force?: boolean) => Promise<void>
  syncAssetDuration: (assetId: string, durationMs: number) => void
  setClipSilenceRegions: (clipId: string, regions: SilenceRegion[]) => void
  clearClipSilenceRegions: (clipId: string) => void
  loadFilmstripForAsset: (assetId: string, asset: Pick<MediaAsset, 'path' | 'durationMs' | 'type'>) => Promise<void>
  addLayer: (type?: TimelineLayer['type']) => void
  removeLayer: (layerId: string) => void
  toggleLayerMute: (layerId: string) => void
  toggleLayerLock: (layerId: string) => void
  selectLayer: (layerId: string | null) => void
  selectClip: (clipId: string | null) => void
  addClipToLayer: (assetId: string, layerId?: string, atMs?: number) => void
  addClipToLayerAt: (assetId: string, layerId: string, timelineStartMs: number) => string
  setMarkers: (markers: TimelineMarker[]) => void
  splitAllAtPlayhead: () => void
  splitAllAtTime: (timeMs: number) => void
  splitSelectedClipAt: (timeMs: number) => void
  splitClipAtPlayhead: () => void
  trimSelectedClip: (edge: 'in' | 'out', deltaMs: number) => void
  deleteSelectedClip: () => void
  copySelectedClip: () => void
  pasteClipAtPlayhead: () => void
  duplicateSelectedClip: () => void
  selectAdjacentLayer: (delta: number) => void
  addMarkerAtPlayhead: () => void
  saveProjectToFile: () => Promise<string | null>
  loadFromGenerationProject: (
    projectId: string,
    projectName: string,
    saved?: VideoEditorProject
  ) => void
  getProjectSnapshot: () => VideoEditorProject
  moveSelectedClip: (timelineStartMs: number) => void
  moveSelectedClipToPosition: (timelineStartMs: number, visualLayerIndex: number) => void
  peekSelectedClipDropTarget: (visualLayerIndex: number) => ClipDropTarget | null
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
  filmstripCache: {},
  filmstripLoading: {},
  silenceRegionsByClipId: {},
  clipClipboard: null,
  boundProjectId: null,

  resetProject: () =>
    set({
      project: createEmptyVideoEditorProject(),
      boundProjectId: null,
      undoStack: [],
      redoStack: [],
      durationMs: 1000,
      waveformCache: {},
      waveformLoading: {},
      filmstripCache: {},
      filmstripLoading: {},
      silenceRegionsByClipId: {},
      clipClipboard: null
    }),

  pushHistory: () => {
    const { project, undoStack } = get()
    set({
      undoStack: [
        ...undoStack.slice(-40),
        {
          layers: cloneLayers(project.layers),
          assets: [...project.assets],
          markers: [...(project.markers ?? EMPTY_TIMELINE_MARKERS)]
        }
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
        {
          layers: cloneLayers(project.layers),
          assets: [...project.assets],
          markers: [...(project.markers ?? EMPTY_TIMELINE_MARKERS)]
        }
      ],
      project: {
        ...project,
        layers: cloneLayers(prev.layers),
        assets: [...prev.assets],
        markers: [...(prev.markers ?? EMPTY_TIMELINE_MARKERS)]
      },
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
        {
          layers: cloneLayers(project.layers),
          assets: [...project.assets],
          markers: [...(project.markers ?? EMPTY_TIMELINE_MARKERS)]
        }
      ],
      project: {
        ...project,
        layers: cloneLayers(next.layers),
        assets: [...next.assets],
        markers: [...(next.markers ?? EMPTY_TIMELINE_MARKERS)]
      },
      durationMs: sequenceDurationMs(next.layers)
    })
  },

  addAsset: (assetInput) => {
    const asset: MediaAsset = { ...assetInput, id: generateId() }
    set((state) => ({
      project: { ...state.project, assets: [...state.project.assets, asset] }
    }))
    if (asset.type === 'audio') {
      void get().loadWaveformForAsset(asset.id, asset.path)
    }
    return asset
  },

  loadFilmstripForAsset: async (assetId, asset) => {
    const { filmstripCache, filmstripLoading } = get()
    if (filmstripCache[assetId] || filmstripLoading[assetId]) return
    if (!window.electronAPI?.getVideoFilmstrip) return

    set((state) => ({
      filmstripLoading: { ...state.filmstripLoading, [assetId]: true }
    }))

    try {
      const filmstrip = await window.electronAPI.getVideoFilmstrip({
        filePath: asset.path,
        durationMs: asset.durationMs,
        type: asset.type
      })
      set((state) => ({
        filmstripCache: { ...state.filmstripCache, [assetId]: filmstrip },
        filmstripLoading: { ...state.filmstripLoading, [assetId]: false }
      }))
    } catch {
      set((state) => ({
        filmstripLoading: { ...state.filmstripLoading, [assetId]: false }
      }))
    }
  },

  loadWaveformForAsset: async (assetId, filePath, force = false) => {
    const { waveformCache, waveformLoading } = get()
    if (!force && (waveformCache[assetId] || waveformLoading[assetId])) return
    if (!window.electronAPI?.getAudioPeaks) return

    set((state) => {
      const nextCache = { ...state.waveformCache }
      const nextLoading = { ...state.waveformLoading, [assetId]: true }
      if (force) delete nextCache[assetId]
      return { waveformCache: nextCache, waveformLoading: nextLoading }
    })

    try {
      const result = await window.electronAPI.getAudioPeaks(filePath)
      const prevDuration = get().durationMs
      get().syncAssetDuration(assetId, result.durationMs)
      set((state) => ({
        waveformCache: {
          ...state.waveformCache,
          [assetId]: {
            sampleRate: result.sampleRate,
            peaks: normalizePeaks(result.peaks),
            durationMs: result.durationMs
          }
        },
        waveformLoading: { ...state.waveformLoading, [assetId]: false }
      }))
      if (get().durationMs > prevDuration * 1.05) {
        usePlaybackStore.getState().fitTimelineView()
      }
    } catch {
      set((state) => ({
        waveformLoading: { ...state.waveformLoading, [assetId]: false }
      }))
    }
  },

  setClipSilenceRegions: (clipId, regions) =>
    set((state) => ({
      silenceRegionsByClipId: { ...state.silenceRegionsByClipId, [clipId]: regions }
    })),

  clearClipSilenceRegions: (clipId) =>
    set((state) => {
      const { [clipId]: _, ...silenceRegionsByClipId } = state.silenceRegionsByClipId
      return { silenceRegionsByClipId }
    }),

  syncAssetDuration: (assetId, durationMs) => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return

    const { project } = get()
    const asset = project.assets.find((a) => a.id === assetId)
    if (!asset) return
    if (Math.abs(asset.durationMs - durationMs) < 50) return

    const prevMs = asset.durationMs

    set((state) => {
      const assets = state.project.assets.map((a) =>
        a.id === assetId ? { ...a, durationMs } : a
      )
      const layers = state.project.layers.map((layer) => ({
        ...layer,
        clips: layer.clips.map((clip) => {
          if (clip.assetId !== assetId) return clip
          const wasFullLength =
            clip.sourceInMs === 0 && Math.abs(clip.sourceOutMs - prevMs) < 200
          if (wasFullLength) {
            return { ...clip, sourceOutMs: durationMs }
          }
          return {
            ...clip,
            sourceInMs: Math.min(clip.sourceInMs, Math.max(0, durationMs - 100)),
            sourceOutMs: Math.min(clip.sourceOutMs, durationMs)
          }
        })
      }))
      return {
        project: { ...state.project, assets, layers },
        durationMs: sequenceDurationMs(layers)
      }
    })
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
    const playhead = atMs ?? usePlayheadStore.getState().playheadMs
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

  addClipToLayerAt: (assetId, layerId, timelineStartMs) => {
    const { project } = get()
    const asset = project.assets.find((a) => a.id === assetId)
    if (!asset) return ''

    const layer = project.layers.find((l) => l.id === layerId)
    if (!layer || layer.locked || !isLayerCompatible(layer, asset.type)) return ''

    get().pushHistory()
    const clip: TimelineClip = {
      id: generateId(),
      assetId,
      layerId: layer.id,
      timelineStartMs: Math.max(0, timelineStartMs),
      sourceInMs: 0,
      sourceOutMs: asset.durationMs
    }

    set((state) => {
      const layers = state.project.layers.map((l) =>
        l.id === layer.id ? { ...l, clips: [...l.clips, clip] } : l
      )
      return {
        project: {
          ...state.project,
          layers,
          selectedClipId: clip.id,
          selectedLayerId: layer.id
        },
        durationMs: sequenceDurationMs(layers)
      }
    })

    return clip.id
  },

  setMarkers: (markers) => {
    get().pushHistory()
    set((state) => ({
      project: {
        ...state.project,
        markers: [...markers].sort((a, b) => a.timeMs - b.timeMs)
      }
    }))
  },

  splitAllAtPlayhead: () => {
    get().splitAllAtTime(usePlayheadStore.getState().playheadMs)
  },

  splitAllAtTime: (timeMs) => {
    const { project } = get()
    const hits: Array<{ clip: TimelineClip; layer: TimelineLayer }> = []

    const layersToScan = project.selectedLayerId
      ? project.layers.filter((layer) => layer.id === project.selectedLayerId)
      : project.layers

    for (const layer of layersToScan) {
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
    const selected = get().getSelectedClip()
    const playhead = usePlayheadStore.getState().playheadMs
    if (selected) {
      get().splitSelectedClipAt(playhead)
    } else {
      get().splitAllAtPlayhead()
    }
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
      const timeMs = usePlayheadStore.getState().playheadMs
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
      const { [clipId]: _, ...silenceRegionsByClipId } = state.silenceRegionsByClipId
      return {
        project: {
          ...state.project,
          layers,
          selectedClipId: state.project.selectedClipId === clipId ? null : state.project.selectedClipId
        },
        durationMs: sequenceDurationMs(layers),
        silenceRegionsByClipId
      }
    })
  },

  copySelectedClip: () => {
    const selected = get().getSelectedClip()
    if (!selected) return
    const { clip } = selected
    set({
      clipClipboard: {
        assetId: clip.assetId,
        sourceInMs: clip.sourceInMs,
        sourceOutMs: clip.sourceOutMs
      }
    })
  },

  pasteClipAtPlayhead: () => {
    const { clipClipboard, project } = get()
    if (!clipClipboard) return

    const asset = project.assets.find((a) => a.id === clipClipboard.assetId)
    if (!asset) return

    let layer = project.selectedLayerId
      ? project.layers.find((l) => l.id === project.selectedLayerId)
      : undefined
    if (!layer || !isLayerCompatible(layer, asset.type)) {
      layer = defaultLayerForAsset(project.layers, asset.type)
    }
    if (!layer || layer.locked) return

    get().pushHistory()
    const playhead = usePlayheadStore.getState().playheadMs
    const clip: TimelineClip = {
      id: generateId(),
      assetId: clipClipboard.assetId,
      layerId: layer.id,
      timelineStartMs: Math.max(0, playhead),
      sourceInMs: clipClipboard.sourceInMs,
      sourceOutMs: clipClipboard.sourceOutMs
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

  duplicateSelectedClip: () => {
    const selected = get().getSelectedClip()
    if (!selected || selected.layer.locked) return

    const { clip, layer } = selected
    get().pushHistory()
    const duplicate: TimelineClip = {
      id: generateId(),
      assetId: clip.assetId,
      layerId: layer.id,
      timelineStartMs: clip.timelineStartMs + clipDurationMs(clip),
      sourceInMs: clip.sourceInMs,
      sourceOutMs: clip.sourceOutMs
    }

    set((state) => {
      const layers = state.project.layers.map((l) =>
        l.id === layer.id ? { ...l, clips: [...l.clips, duplicate] } : l
      )
      return {
        project: {
          ...state.project,
          layers,
          selectedClipId: duplicate.id,
          selectedLayerId: layer.id
        },
        durationMs: sequenceDurationMs(layers)
      }
    })
  },

  selectAdjacentLayer: (delta) => {
    const { project } = get()
    const { layers } = project
    if (layers.length === 0) return

    const currentIndex = project.selectedLayerId
      ? Math.max(0, layers.findIndex((l) => l.id === project.selectedLayerId))
      : 0
    const nextIndex = clamp(currentIndex + delta, 0, layers.length - 1)
    const nextLayer = layers[nextIndex]
    if (!nextLayer) return

    const playhead = usePlayheadStore.getState().playheadMs
    const clipOnLayer = nextLayer.clips.find(
      (c) =>
        playhead >= c.timelineStartMs &&
        playhead < c.timelineStartMs + clipDurationMs(c)
    )

    set({
      project: {
        ...project,
        selectedLayerId: nextLayer.id,
        selectedClipId: clipOnLayer?.id ?? null
      }
    })
  },

  addMarkerAtPlayhead: () => {
    const timeMs = usePlayheadStore.getState().playheadMs
    const { project } = get()
    if ((project.markers ?? EMPTY_TIMELINE_MARKERS).some((m) => Math.abs(m.timeMs - timeMs) < 50)) return

    get().pushHistory()
    const marker: TimelineMarker = { id: generateId(), timeMs }
    set((state) => ({
      project: {
        ...state.project,
        markers: [...(state.project.markers ?? EMPTY_TIMELINE_MARKERS), marker].sort((a, b) => a.timeMs - b.timeMs)
      }
    }))
  },

  saveProjectToFile: async () => {
    if (!window.electronAPI?.saveVideoEditorProject) return null
    const { project } = get()
    return window.electronAPI.saveVideoEditorProject(get().getProjectSnapshot())
  },

  loadFromGenerationProject: (projectId, projectName, saved) => {
    const normalized = normalizeVideoEditorProject(saved, projectName)
    const layers = normalized.layers
    const assets = pruneDerivedOrphans(normalized.assets, layers)
    const project = { ...normalized, assets }
    set({
      boundProjectId: projectId,
      project: { ...project, id: project.id || projectId, name: projectName },
      durationMs: sequenceDurationMs(layers),
      undoStack: [],
      redoStack: [],
      silenceRegionsByClipId: {},
      clipClipboard: null,
      waveformCache: {},
      waveformLoading: {}
    })
  },

  getProjectSnapshot: () => {
    const { project } = get()
    return {
      ...project,
      layers: cloneLayers(project.layers),
      assets: [...project.assets],
      markers: [...(project.markers ?? EMPTY_TIMELINE_MARKERS)],
      selectedClipId: null,
      selectedLayerId: project.selectedLayerId
    }
  },

  moveSelectedClip: (timelineStartMs) => {
    get().moveSelectedClipToPosition(timelineStartMs, -1)
  },

  peekSelectedClipDropTarget: (visualLayerIndex) => {
    const { project } = get()
    const clipId = project.selectedClipId
    if (!clipId) return null

    let asset: MediaAsset | undefined
    let sourceLayer: TimelineLayer | undefined

    for (const layer of project.layers) {
      const hit = layer.clips.find((c) => c.id === clipId)
      if (!hit) continue
      asset = project.assets.find((a) => a.id === hit.assetId)
      sourceLayer = layer
      break
    }

    if (!asset || !sourceLayer || sourceLayer.locked) return null
    return resolveDropTarget(project.layers, asset.type, visualLayerIndex)
  },

  moveSelectedClipToPosition: (timelineStartMs, visualLayerIndex) => {
    const { project } = get()
    const clipId = project.selectedClipId
    if (!clipId) return

    let clip: TimelineClip | undefined
    let sourceLayer: TimelineLayer | undefined
    let asset: MediaAsset | undefined

    for (const layer of project.layers) {
      const hit = layer.clips.find((c) => c.id === clipId)
      if (!hit) continue
      clip = hit
      sourceLayer = layer
      asset = project.assets.find((a) => a.id === hit.assetId)
      break
    }

    if (!clip || !sourceLayer || !asset || sourceLayer.locked) return

    const startMs = Math.max(0, timelineStartMs)
    const sourceLayerId = sourceLayer.id

    if (visualLayerIndex < 0) {
      set((state) => {
        const layers = state.project.layers.map((l) => ({
          ...l,
          clips: l.clips.map((c) =>
            c.id === clipId ? { ...c, timelineStartMs: startMs } : c
          )
        }))
        return {
          project: { ...state.project, layers },
          durationMs: sequenceDurationMs(layers)
        }
      })
      return
    }

    const target = resolveDropTarget(project.layers, asset.type, visualLayerIndex)
    let layers = cloneLayers(project.layers)

    let targetLayerId = target.layerId

    if (target.createNew) {
      const newLayer = createLayerOfType(target.layerType, layers)
      layers.splice(clamp(target.insertIndex, 0, layers.length), 0, newLayer)
      targetLayerId = newLayer.id
    }

    if (!targetLayerId) return

    const targetLayer = layers.find((l) => l.id === targetLayerId)
    if (!targetLayer || targetLayer.locked || !isLayerCompatible(targetLayer, asset.type)) return

    if (targetLayerId === sourceLayerId) {
      layers = layers.map((l) => ({
        ...l,
        clips: l.clips.map((c) =>
          c.id === clipId ? { ...c, timelineStartMs: startMs, layerId: targetLayerId! } : c
        )
      }))
    } else {
      const movingClip = { ...clip, timelineStartMs: startMs, layerId: targetLayerId }
      layers = layers.map((l) => {
        if (l.id === sourceLayerId) {
          return { ...l, clips: l.clips.filter((c) => c.id !== clipId) }
        }
        if (l.id === targetLayerId) {
          return { ...l, clips: [...l.clips, movingClip] }
        }
        return l
      })

      const emptied = layers.find((l) => l.id === sourceLayerId)
      if (emptied && emptied.clips.length === 0) {
        layers = layers.filter((l) => l.id !== sourceLayerId)
      }
    }

    set({
      project: {
        ...project,
        layers,
        selectedClipId: clipId,
        selectedLayerId: targetLayerId
      },
      durationMs: sequenceDurationMs(layers)
    })
  },

  replaceClipWithAsset: (clipId, assetInput) => {
    const { project } = get()
    const clip = project.layers.flatMap((layer) => layer.clips).find((item) => item.id === clipId)
    if (!clip) return

    const oldAssetId = clip.assetId
    const oldAsset = project.assets.find((asset) => asset.id === oldAssetId)
    const usageCount = countAssetUsage(project.layers, oldAssetId)

    get().pushHistory()

    if (usageCount <= 1) {
      set((state) => {
        const layers = state.project.layers.map((layer) => ({
          ...layer,
          clips: layer.clips.map((item) =>
            item.id === clipId
              ? {
                  ...item,
                  sourceInMs: 0,
                  sourceOutMs: assetInput.durationMs
                }
              : item
          )
        }))
        const assets = pruneDerivedOrphans(
          state.project.assets.map((asset) =>
            asset.id === oldAssetId
              ? {
                  ...asset,
                  ...assetInput,
                  id: oldAssetId,
                  name: oldAsset?.name ?? assetInput.name
                }
              : asset
          ),
          layers
        )
        const { [clipId]: _, ...silenceRegionsByClipId } = state.silenceRegionsByClipId
        const { [oldAssetId]: __, ...waveformCache } = state.waveformCache
        return {
          project: {
            ...state.project,
            assets,
            layers,
            selectedClipId: clipId
          },
          durationMs: sequenceDurationMs(layers),
          silenceRegionsByClipId,
          waveformCache
        }
      })
      void get().loadWaveformForAsset(oldAssetId, assetInput.path, true)
      return
    }

    const asset: MediaAsset = {
      ...assetInput,
      id: generateId(),
      name: oldAsset?.name ?? assetInput.name
    }
    set((state) => {
      const layers = state.project.layers.map((layer) => ({
        ...layer,
        clips: layer.clips.map((item) =>
          item.id === clipId
            ? {
                ...item,
                assetId: asset.id,
                sourceInMs: 0,
                sourceOutMs: assetInput.durationMs
              }
            : item
        )
      }))
      const { [clipId]: _, ...silenceRegionsByClipId } = state.silenceRegionsByClipId
      return {
        project: {
          ...state.project,
          assets: [...state.project.assets, asset],
          layers,
          selectedClipId: clipId
        },
        durationMs: sequenceDurationMs(layers),
        silenceRegionsByClipId
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
