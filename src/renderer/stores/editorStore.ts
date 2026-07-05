import { create } from 'zustand'
import type {
  AudioMetadata,
  DetectionParams,
  EditOperation,
  Preset,
  SilenceRegion,
  SplitMarker,
  WaveformPeaks,
  ExportOptions
} from '@shared/types'
import { DEFAULT_DETECTION_PARAMS as defaultParams, generateId } from '@shared/types'

interface HistoryState {
  regions: SilenceRegion[]
  operations: EditOperation[]
  splitMarkers: SplitMarker[]
}

interface EditorState {
  metadata: AudioMetadata | null
  peaks: WaveformPeaks | null
  regions: SilenceRegion[]
  operations: EditOperation[]
  splitMarkers: SplitMarker[]
  selection: { startMs: number; endMs: number } | null
  params: DetectionParams
  presets: Preset[]
  loading: boolean
  loadingMessage: string
  detecting: boolean
  detectionProgress: number
  error: string | null
  recentFiles: string[]
  undoStack: HistoryState[]
  redoStack: HistoryState[]
  snapToSilence: boolean
  rippleDelete: boolean
  previewNonSilence: boolean
  exportFormat: ExportOptions['format']
  exportBitrate: number

  setMetadata: (metadata: AudioMetadata | null) => void
  setPeaks: (peaks: WaveformPeaks | null) => void
  setRegions: (regions: SilenceRegion[]) => void
  setOperations: (operations: EditOperation[]) => void
  setSelection: (selection: { startMs: number; endMs: number } | null) => void
  setParams: (params: Partial<DetectionParams>) => void
  setPresets: (presets: Preset[]) => void
  setLoading: (loading: boolean, message?: string) => void
  setDetecting: (detecting: boolean, progress?: number) => void
  setError: (error: string | null) => void
  addRecentFile: (path: string) => void
  pushHistory: () => void
  undo: () => void
  redo: () => void
  splitAt: (timeMs: number) => void
  deleteSelection: () => void
  toggleRegionRemoved: (id: string) => void
  applySilenceRemoval: () => void
  setSnapToSilence: (v: boolean) => void
  setRippleDelete: (v: boolean) => void
  setPreviewNonSilence: (v: boolean) => void
  setExportFormat: (format: ExportOptions['format']) => void
  setExportBitrate: (bitrate: number) => void
  resetProject: () => void
}


export const useEditorStore = create<EditorState>((set, get) => ({
  metadata: null,
  peaks: null,
  regions: [],
  operations: [],
  splitMarkers: [],
  selection: null,
  params: { ...defaultParams },
  presets: [],
  loading: false,
  loadingMessage: '',
  detecting: false,
  detectionProgress: 0,
  error: null,
  recentFiles: [],
  undoStack: [],
  redoStack: [],
  snapToSilence: false,
  rippleDelete: false,
  previewNonSilence: false,
  exportFormat: 'wav',
  exportBitrate: 192,

  setMetadata: (metadata) => set({ metadata }),
  setPeaks: (peaks) => set({ peaks }),
  setRegions: (regions) => set({ regions }),
  setOperations: (operations) => set({ operations }),
  setSelection: (selection) => set({ selection }),
  setParams: (params) => set((s) => ({ params: { ...s.params, ...params } })),
  setPresets: (presets) => set({ presets }),
  setLoading: (loading, message = '') => set({ loading, loadingMessage: message }),
  setDetecting: (detecting, progress = 0) =>
    set({ detecting, detectionProgress: progress }),
  setError: (error) => set({ error }),
  addRecentFile: (path) =>
    set((s) => ({
      recentFiles: [path, ...s.recentFiles.filter((f) => f !== path)].slice(0, 8)
    })),

  pushHistory: () => {
    const { regions, operations, splitMarkers, undoStack } = get()
    set({
      undoStack: [...undoStack, { regions: [...regions], operations: [...operations], splitMarkers: [...splitMarkers] }],
      redoStack: []
    })
  },

  undo: () => {
    const { undoStack, regions, operations, splitMarkers, redoStack } = get()
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, { regions, operations, splitMarkers }],
      regions: prev.regions,
      operations: prev.operations,
      splitMarkers: prev.splitMarkers
    })
  },

  redo: () => {
    const { redoStack, regions, operations, splitMarkers, undoStack } = get()
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    set({
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, { regions, operations, splitMarkers }],
      regions: next.regions,
      operations: next.operations,
      splitMarkers: next.splitMarkers
    })
  },

  splitAt: (timeMs) => {
    const { splitMarkers, metadata } = get()
    if (!metadata) return
    if (timeMs <= 0 || timeMs >= metadata.durationMs) return
    get().pushHistory()
    set({
      splitMarkers: [...splitMarkers, { id: generateId(), timeMs }].sort(
        (a, b) => a.timeMs - b.timeMs
      )
    })
  },

  deleteSelection: () => {
    const { selection, regions, metadata, rippleDelete } = get()
    if (!selection || !metadata) return
    get().pushHistory()
    const newRegion: SilenceRegion = {
      id: generateId(),
      startMs: selection.startMs,
      endMs: selection.endMs,
      confidence: 1,
      source: 'manual',
      removed: false
    }
    let updatedRegions = [...regions, newRegion]

    if (rippleDelete) {
      const shift = selection.endMs - selection.startMs
      updatedRegions = updatedRegions.map((r) => ({
        ...r,
        startMs: r.startMs >= selection.endMs ? r.startMs - shift : r.startMs,
        endMs: r.endMs >= selection.endMs ? r.endMs - shift : r.endMs
      }))
    }

    set({
      regions: updatedRegions,
      selection: null
    })
  },

  toggleRegionRemoved: (id) => {
    get().pushHistory()
    set((s) => ({
      regions: s.regions.map((r) => (r.id === id ? { ...r, removed: !r.removed } : r))
    }))
  },

  applySilenceRemoval: () => {
    const { regions } = get()
    get().pushHistory()
    const ops: EditOperation[] = regions
      .filter((r) => !r.removed)
      .map((r) => ({
        id: generateId(),
        type: 'remove' as const,
        startMs: r.startMs,
        endMs: r.endMs
      }))
    set({ operations: ops })
  },

  setSnapToSilence: (v) => set({ snapToSilence: v }),
  setRippleDelete: (v) => set({ rippleDelete: v }),
  setPreviewNonSilence: (v) => set({ previewNonSilence: v }),
  setExportFormat: (exportFormat) => set({ exportFormat }),
  setExportBitrate: (exportBitrate) => set({ exportBitrate }),

  resetProject: () =>
    set({
      metadata: null,
      peaks: null,
      regions: [],
      operations: [],
      splitMarkers: [],
      selection: null,
      undoStack: [],
      redoStack: [],
      error: null
    })
}))
