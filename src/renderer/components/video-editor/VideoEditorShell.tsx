import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Film,
  Layers,
  Pause,
  Play,
  Scissors,
  SkipBack,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { Button } from '../common/Button'
import { Label } from '../common/Label'
import { Dialog, DialogRow } from '../common/Dialog'
import { VideoTimeline, localMediaUrl } from './VideoTimeline'
import { VideoAudioSilencePanel } from './VideoAudioSilencePanel'
import { VideoInspectorTabs, type VideoInspectorTab } from './VideoInspectorTabs'
import { VideoExportPanel, type TimelineExportMode } from './VideoExportPanel'
import { useVideoEditorStore } from '@renderer/stores/videoEditorStore'
import { usePlayheadStore } from '@renderer/stores/playheadStore'
import { usePlaybackStore } from '@renderer/stores/playbackStore'
import { useVideoEditorHotkeys } from '@renderer/hooks/useVideoEditorHotkeys'
import { useVideoEditorPlayback } from '@renderer/hooks/useVideoEditorPlayback'
import { clipDurationMs } from '@shared/types'
import { formatTime } from '@renderer/lib/utils'
import {
  DEFAULT_VIDEO_EXPORT_OPTIONS,
  TIMELINE_AUDIO_EXPORT_FORMATS,
  VIDEO_EXPORT_PRESETS,
  VIDEO_EXPORT_QUALITY,
  suggestExportPreset,
  type TimelineAudioExportFormat
} from '@shared/videoExport'
import {
  allowFileDrop,
  filePathFromDrop,
  mediaFilesFromDataTransfer
} from '@renderer/lib/dropFiles'
import { galleryDragPayloadFromDataTransfer } from '@renderer/lib/galleryDrag'
import {
  importGenerationIntoEditor,
  isVideoGeneration,
  canPreviewVideoInBrowser,
  generationVideoSrc
} from '@renderer/lib/projectEditorMedia'
import { useProjectTabStore } from '@renderer/stores/projectTabStore'

export function VideoEditorShell({
  embedded = false,
  tabId,
  projectId
}: {
  embedded?: boolean
  tabId?: string
  projectId?: string
}): React.JSX.Element {
  const project = useVideoEditorStore((s) => s.project)
  const loadFromGenerationProject = useVideoEditorStore((s) => s.loadFromGenerationProject)
  const resetProject = useVideoEditorStore((s) => s.resetProject)
  const generationProject = useProjectTabStore((s) =>
    projectId ? s.projects[projectId] : undefined
  )
  const saveVideoEditorForProject = useProjectTabStore((s) => s.saveVideoEditorForProject)
  const linkEditorAudioToProject = useProjectTabStore((s) => s.linkEditorAudioToProject)
  const openExistingProjectTab = useProjectTabStore((s) => s.openExistingProjectTab)
  const tabs = useProjectTabStore((s) => s.tabs)
  const setActiveTab = useProjectTabStore((s) => s.setActiveTab)
  const durationMs = useVideoEditorStore((s) => s.durationMs)
  const addAsset = useVideoEditorStore((s) => s.addAsset)
  const addLayer = useVideoEditorStore((s) => s.addLayer)
  const removeLayer = useVideoEditorStore((s) => s.removeLayer)
  const selectLayer = useVideoEditorStore((s) => s.selectLayer)
  const toggleLayerMute = useVideoEditorStore((s) => s.toggleLayerMute)
  const toggleLayerLock = useVideoEditorStore((s) => s.toggleLayerLock)
  const selectedLayerId = useVideoEditorStore((s) => s.project.selectedLayerId)
  const addClipToLayer = useVideoEditorStore((s) => s.addClipToLayer)
  const splitClipAtPlayhead = useVideoEditorStore((s) => s.splitClipAtPlayhead)
  const deleteSelectedClip = useVideoEditorStore((s) => s.deleteSelectedClip)
  const selectedClipId = useVideoEditorStore((s) => s.project.selectedClipId)
  const selected = useMemo(() => {
    if (!selectedClipId) return null
    for (const layer of project.layers) {
      const clip = layer.clips.find((c) => c.id === selectedClipId)
      if (!clip) continue
      const asset = project.assets.find((a) => a.id === clip.assetId)
      if (asset) return { clip, layer, asset }
    }
    return null
  }, [selectedClipId, project.layers, project.assets])

  const sidebarLibraryAssets = useMemo(() => {
    const onTimeline = new Set(
      project.layers.flatMap((layer) => layer.clips.map((clip) => clip.assetId))
    )
    return project.assets.filter((asset) => !onTimeline.has(asset.id))
  }, [project.assets, project.layers])

  const visualClipAtPlayhead = useVideoEditorStore((s) => s.visualClipAtPlayhead)
  const audioClipAtPlayhead = useVideoEditorStore((s) => s.audioClipAtPlayhead)

  const playheadMs = usePlayheadStore((s) => s.playheadMs)
  const isPlaying = usePlayheadStore((s) => s.isPlaying)
  const setPlayheadMs = usePlayheadStore((s) => s.setPlayheadMs)
  const setIsPlaying = usePlayheadStore((s) => s.setIsPlaying)
  const zoomIn = usePlaybackStore((s) => s.zoomIn)
  const zoomOut = usePlaybackStore((s) => s.zoomOut)
  const fitTimelineView = usePlaybackStore((s) => s.fitTimelineView)
  const setScrollMs = usePlaybackStore((s) => s.setScrollMs)
  const scrollMs = usePlaybackStore((s) => s.scrollMs)
  const zoom = usePlaybackStore((s) => s.zoom)
  const timelineTool = usePlaybackStore((s) => s.timelineTool)
  const setTimelineTool = usePlaybackStore((s) => s.setTimelineTool)

  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const masterPathRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOverBin, setDragOverBin] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importingGenerationId, setImportingGenerationId] = useState<string | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<VideoInspectorTab>('inspector')
  const [exporting, setExporting] = useState(false)
  const [exportMode, setExportMode] = useState<TimelineExportMode>('video')
  const [audioExportFormat, setAudioExportFormat] = useState<TimelineAudioExportFormat>('wav')
  const [exportPresetId, setExportPresetId] = useState('1080p-vertical')
  const [exportQualityId, setExportQualityId] = useState<(typeof VIDEO_EXPORT_QUALITY)[number]['id']>('medium')
  const [includeVideoLayerAudio, setIncludeVideoLayerAudio] = useState(true)
  const [exportSuccess, setExportSuccess] = useState<string | null>(null)

  useEffect(() => {
    return window.electronAPI?.onShowShortcuts(() => setShortcutsOpen(true))
  }, [])

  useEffect(() => {
    if (!projectId) {
      if (useVideoEditorStore.getState().boundProjectId) {
        resetProject()
      }
      return
    }
    if (!generationProject) return
    if (useVideoEditorStore.getState().boundProjectId === projectId) return
    loadFromGenerationProject(projectId, generationProject.name, generationProject.videoEditor)
  }, [projectId, tabId, generationProject, loadFromGenerationProject, resetProject])

  useEffect(() => {
    if (!projectId) return
    return () => {
      saveVideoEditorForProject(projectId)
    }
  }, [projectId, tabId, saveVideoEditorForProject])

  const importPaths = useCallback(
    async (paths: string[]): Promise<void> => {
      if (!window.electronAPI?.probeMediaFile) {
        setError('File import is unavailable. Restart the app.')
        return
      }
      if (paths.length === 0) return

      setImporting(true)
      setError(null)
      let imported = 0
      let lastError: string | null = null

      for (const path of paths) {
        try {
          const meta = await window.electronAPI.probeMediaFile(path)
          const asset = addAsset(meta)

          let layerId: string | undefined
          if (meta.type === 'audio') {
            const audioLayer = useVideoEditorStore
              .getState()
              .project.layers.find((l) => l.type === 'audio')
            if (!audioLayer) {
              addLayer('audio')
            }
            layerId = useVideoEditorStore
              .getState()
              .project.layers.find((l) => l.type === 'audio')?.id
          } else if (meta.type === 'image') {
            const overlay = useVideoEditorStore
              .getState()
              .project.layers.find((l) => l.type === 'overlay')
            if (!overlay) {
              addLayer('overlay')
            }
            layerId = useVideoEditorStore
              .getState()
              .project.layers.find((l) => l.type === 'overlay')?.id
          }

          addClipToLayer(asset.id, layerId, 0)
          imported++
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          setError(lastError)
        }
      }

      setImporting(false)
      if (imported > 0) {
        fitTimelineView()
      }
      if (imported === 0 && paths.length > 0) {
        setError(lastError ?? 'Could not import the selected file(s). Check format and try again.')
      }
    },
    [addAsset, addClipToLayer, addLayer, fitTimelineView]
  )

  const importMedia = useCallback(async (): Promise<void> => {
    const paths = await window.electronAPI?.openVideoFile()
    if (!paths?.length) return
    await importPaths(paths)
  }, [importPaths])

  const importDroppedFile = useCallback(
    async (file: File): Promise<void> => {
      const path = filePathFromDrop(file)
      if (path) {
        await importPaths([path])
        return
      }
      setError('Could not read dropped file path. Use Import instead.')
    },
    [importPaths]
  )

  const onDropMedia = useCallback(
    async (e: React.DragEvent): Promise<void> => {
      allowFileDrop(e)
      setDragOverBin(false)

      const galleryPayload = galleryDragPayloadFromDataTransfer(e.dataTransfer)
      if (galleryPayload?.jobId && projectId && generationProject) {
        const generation = generationProject.generations.find((g) => g.id === galleryPayload.jobId)
        if (generation) {
          setImportingGenerationId(generation.id)
          setError(null)
          try {
            await importGenerationIntoEditor(projectId, generation)
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          } finally {
            setImportingGenerationId(null)
          }
          return
        }
      }

      const files = mediaFilesFromDataTransfer(e.dataTransfer)
      if (files.length === 0) {
        setError('Drop a video, image, audio file, or gallery item here.')
        return
      }
      for (const file of files) {
        await importDroppedFile(file)
      }
    },
    [importDroppedFile, projectId, generationProject]
  )

  const addGenerationToTimeline = useCallback(
    async (generationId: string): Promise<void> => {
      if (!projectId || !generationProject) return
      const generation = generationProject.generations.find((g) => g.id === generationId)
      if (!generation) return
      setImportingGenerationId(generationId)
      setError(null)
      try {
        await importGenerationIntoEditor(projectId, generation)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setImportingGenerationId(null)
      }
    },
    [projectId, generationProject]
  )

  const active = visualClipAtPlayhead(playheadMs)
  const audioActive = audioClipAtPlayhead(playheadMs)

  useVideoEditorPlayback(videoRef, audioRef, masterPathRef)

  useEffect(() => {
    const visibleDuration = durationMs / zoom
    const maxScroll = Math.max(0, durationMs - visibleDuration)
    if (scrollMs > maxScroll) {
      setScrollMs(maxScroll)
    }
    if (playheadMs > durationMs) {
      setPlayheadMs(durationMs)
    }
  }, [durationMs, scrollMs, playheadMs, zoom, setScrollMs, setPlayheadMs])

  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      event.preventDefault()
    }
    document.addEventListener('dragover', onDragOver)
    return () => document.removeEventListener('dragover', onDragOver)
  }, [])

  const addToTimeline = useCallback(
    (assetId: string) => {
      addClipToLayer(assetId)
    },
    [addClipToLayer]
  )

  const openExportPanel = useCallback(() => {
    const suggested = suggestExportPreset(project.assets, project.layers)
    setExportPresetId(suggested.id)
    setExportQualityId('medium')
    setIncludeVideoLayerAudio(true)
    setExportSuccess(null)
    setError(null)
    setInspectorTab('export')
  }, [project.assets, project.layers])

  const runExport = useCallback(async (): Promise<void> => {
    if (!window.electronAPI?.exportVideoSequence) return

    setExporting(true)
    setError(null)
    setExportSuccess(null)

    try {
      if (exportMode === 'audio') {
        const formatMeta =
          TIMELINE_AUDIO_EXPORT_FORMATS.find((f) => f.id === audioExportFormat) ??
          TIMELINE_AUDIO_EXPORT_FORMATS[0]
        const baseName = `${project.name || 'export'}.${formatMeta.extension}`.replace(
          /[<>:"/\\|?*]/g,
          '_'
        )
        const outputPath = await window.electronAPI.saveFile(baseName)
        if (!outputPath) return

        const result = await window.electronAPI.exportVideoSequence({
          mode: 'timeline-audio',
          assets: project.assets,
          layers: project.layers,
          outputPath
        })
        if (!('durationMs' in result)) {
          throw new Error('Audio export failed.')
        }
        setExportSuccess(`Exported ${formatTime(result.durationMs, false)} → ${result.outputPath}`)
        return
      }

      const preset = VIDEO_EXPORT_PRESETS.find((p) => p.id === exportPresetId) ?? VIDEO_EXPORT_PRESETS[0]
      const quality =
        VIDEO_EXPORT_QUALITY.find((q) => q.id === exportQualityId) ?? VIDEO_EXPORT_QUALITY[1]

      const defaultName = `${project.name || 'export'}.mp4`.replace(/[<>:"/\\|?*]/g, '_')
      const outputPath = await window.electronAPI.saveVideoFile(defaultName)
      if (!outputPath) return

      const result = await window.electronAPI.exportVideoSequence({
        assets: project.assets,
        layers: project.layers,
        outputPath,
        options: {
          width: preset.width,
          height: preset.height,
          fps: DEFAULT_VIDEO_EXPORT_OPTIONS.fps,
          crf: quality.crf,
          includeVideoLayerAudio
        }
      })
      if (!('durationMs' in result)) {
        throw new Error('Video export failed.')
      }
      setExportSuccess(`Exported ${formatTime(result.durationMs, false)} → ${result.outputPath}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }, [
    exportMode,
    audioExportFormat,
    exportPresetId,
    exportQualityId,
    includeVideoLayerAudio,
    project.assets,
    project.layers,
    project.name
  ])

  const useAudioForTiming = useCallback(async (): Promise<void> => {
    if (!projectId || !selected || selected.asset.type !== 'audio') return
    if (!window.electronAPI?.importProjectMedia) return
    try {
      const imported = await window.electronAPI.importProjectMedia(projectId, selected.asset.path)
      linkEditorAudioToProject(projectId, {
        media: {
          id: selected.asset.id,
          localPath: imported.localPath,
          name: imported.name
        },
        clipId: selected.clip.id,
        sourceInMs: selected.clip.sourceInMs,
        sourceOutMs: selected.clip.sourceOutMs
      })
      const existingGenerationTab = tabs.find((t) => t.kind === 'generation' && t.projectId === projectId)
      if (existingGenerationTab) {
        setActiveTab(existingGenerationTab.id)
      } else {
        await openExistingProjectTab(projectId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [linkEditorAudioToProject, openExistingProjectTab, projectId, selected, setActiveTab, tabs])

  useVideoEditorHotkeys({ onExport: openExportPanel })

  useEffect(() => {
    return window.electronAPI?.onMenuExport(() => openExportPanel())
  }, [openExportPanel])

  return (
    <div
      className={
        embedded
          ? 'flex-1 flex flex-col min-h-0 bg-background text-foreground'
          : 'h-screen flex flex-col bg-background text-foreground'
      }
    >
      <div className="flex flex-1 min-h-0">
        <aside className="w-56 border-r border-border bg-card flex flex-col shrink-0">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <Film size={16} className="text-primary" />
            <div className="min-w-0">
              <span className="font-semibold text-sm block">Media bin</span>
              {generationProject && (
                <span className="text-[10px] text-muted truncate block">{generationProject.name}</span>
              )}
            </div>
          </div>
          <div className="p-2 space-y-2">
            <Button
              size="sm"
              className="w-full"
              disabled={importing}
              onClick={() => void importMedia()}
            >
              <Upload size={14} className="mr-1" />
              {importing ? 'Importing…' : 'Import video / image / audio'}
            </Button>
          </div>
          <div
            className={`mx-2 mb-2 rounded border border-dashed p-3 text-center transition-colors ${
              dragOverBin ? 'border-primary bg-primary/10' : 'border-border'
            }`}
            onDragEnter={(e) => {
              allowFileDrop(e)
              setDragOverBin(true)
            }}
            onDragOver={allowFileDrop}
            onDragLeave={() => setDragOverBin(false)}
            onDrop={(e) => void onDropMedia(e)}
          >
            <p className="text-[10px] text-muted">Drop media files or gallery items here</p>
          </div>
          {error && <p className="text-xs text-red-400 px-2">{error}</p>}
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {generationProject && generationProject.generations.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-medium text-muted px-1">
                  Project gallery ({generationProject.generations.length})
                </p>
                {generationProject.generations.map((item) => {
                  const isVideo = isVideoGeneration(item)
                  const busy = importingGenerationId === item.id
                  return (
                    <div
                      key={item.id}
                      className="rounded border border-primary/30 bg-primary/5 p-2 space-y-2"
                    >
                      <div className="aspect-video rounded overflow-hidden bg-black/40 flex items-center justify-center">
                        {isVideo ? (
                          canPreviewVideoInBrowser(item) ? (
                            <video
                              src={generationVideoSrc(item)}
                              muted
                              playsInline
                              preload="metadata"
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted">
                              <Film size={20} />
                              <span className="text-[9px]">Not downloaded yet</span>
                            </div>
                          )
                        ) : (
                          <img
                            src={item.url}
                            alt={item.prompt}
                            className="h-full w-full object-contain"
                          />
                        )}
                      </div>
                      <p className="text-[10px] font-medium truncate capitalize">
                        {isVideo ? 'Video' : 'Image'} · {item.prompt || item.model}
                      </p>
                      <Button
                        size="sm"
                        className="w-full text-xs"
                        disabled={busy || importing}
                        onClick={() => void addGenerationToTimeline(item.id)}
                      >
                        {busy ? 'Adding…' : 'Add to timeline'}
                      </Button>
                    </div>
                  )
                })}
                <div className="border-t border-border pt-2" />
              </div>
            )}
            {sidebarLibraryAssets.length === 0 && !generationProject?.generations.length && (
              <p className="text-[10px] text-muted px-1">
                Import or drop clips — they are added to the timeline automatically.
              </p>
            )}
            {sidebarLibraryAssets.map((asset) => (
              <div
                key={asset.id}
                className="rounded border border-border bg-background p-2 space-y-2"
              >
                <div className="aspect-video rounded overflow-hidden bg-black/40 flex items-center justify-center">
                  {asset.type === 'video' ? (
                    <video
                      src={localMediaUrl(asset.path, asset.type)}
                      muted
                      preload="metadata"
                      className="h-full w-full object-contain"
                    />
                  ) : asset.type === 'image' ? (
                    <img
                      src={localMediaUrl(asset.path, asset.type)}
                      alt={asset.name}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <p className="text-[10px] text-muted px-2 text-center">Audio · {asset.name}</p>
                  )}
                </div>
                <p className="text-[10px] font-medium truncate">{asset.name}</p>
                <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => addToTimeline(asset.id)}>
                  Add to timeline
                </Button>
              </div>
            ))}
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="flex-1 min-h-[200px] flex items-center justify-center bg-black/80 border-b border-border relative">
            <audio ref={audioRef} className="hidden" preload="auto" />
            {active ? (
              active.asset.type === 'video' ? (
                <video
                  ref={videoRef}
                  key={active.asset.id}
                  src={localMediaUrl(active.asset.path, active.asset.type)}
                  className="max-h-full max-w-full"
                  muted={Boolean(audioActive)}
                  playsInline
                  preload="auto"
                />
              ) : (
                <img
                  ref={imageRef}
                  key={active.asset.id}
                  src={localMediaUrl(active.asset.path, active.asset.type)}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                />
              )
            ) : (
              <p className="text-sm text-muted">Add clips to the timeline to preview</p>
            )}
          </div>

          <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-card">
            <Button size="sm" variant="outline" onClick={() => setPlayheadMs(0)}>
              <SkipBack size={14} />
            </Button>
            <Button
              size="sm"
              onClick={() => setIsPlaying(!isPlaying)}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </Button>
            <span className="text-xs text-muted tabular-nums">
              {formatTime(playheadMs)} / {formatTime(durationMs)}
            </span>
            <div className="flex items-center gap-1 ml-2">
              <Button
                size="sm"
                variant={timelineTool === 'select' ? 'default' : 'outline'}
                title="Select tool (A)"
                onClick={() => setTimelineTool('select')}
              >
                A
              </Button>
              <Button
                size="sm"
                variant={timelineTool === 'split' ? 'default' : 'outline'}
                title="Split tool (B)"
                onClick={() => setTimelineTool('split')}
              >
                B
              </Button>
            </div>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={fitTimelineView} title="Fit timeline to content">
              Fit
            </Button>
            <Button size="sm" variant="outline" onClick={() => zoomOut(durationMs)}>
              <ZoomOut size={14} />
            </Button>
            <Button size="sm" variant="outline" onClick={() => zoomIn(durationMs)}>
              <ZoomIn size={14} />
            </Button>
            <Button size="sm" variant="outline" onClick={splitClipAtPlayhead}>
              <Scissors size={14} className="mr-1" /> Split
            </Button>
            <Button size="sm" variant="outline" onClick={deleteSelectedClip}>
              <Trash2 size={14} />
            </Button>
            <Button size="sm" onClick={openExportPanel} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export'}
            </Button>
          </div>

          <div className="relative flex-1 min-h-[180px] max-h-[45%] min-w-0 overflow-hidden">
            <VideoTimeline />
          </div>
        </main>

        <aside className="w-64 border-l border-border bg-card flex flex-col shrink-0 min-h-0">
          <VideoInspectorTabs active={inspectorTab} onChange={setInspectorTab} />
          <div className="flex-1 min-h-0 overflow-y-auto">
            {inspectorTab === 'export' ? (
              <VideoExportPanel
                layers={project.layers}
                exportMode={exportMode}
                audioFormat={audioExportFormat}
                exportPresetId={exportPresetId}
                exportQualityId={exportQualityId}
                includeVideoLayerAudio={includeVideoLayerAudio}
                exporting={exporting}
                exportSuccess={exportSuccess}
                onExportModeChange={setExportMode}
                onAudioFormatChange={setAudioExportFormat}
                onPresetChange={setExportPresetId}
                onQualityChange={setExportQualityId}
                onIncludeVideoLayerAudioChange={setIncludeVideoLayerAudio}
                onExport={() => void runExport()}
              />
            ) : (
              <div className="p-3 space-y-4">
                <div>
                  <Label>Layers</Label>
                  <div className="mt-2 space-y-1">
                    {project.layers.map((layer) => (
                      <button
                        key={layer.id}
                        type="button"
                        onClick={() => selectLayer(layer.id)}
                        className={`w-full text-xs flex items-center justify-between rounded px-2 py-1.5 border ${
                          layer.id === selectedLayerId
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-transparent text-muted hover:bg-background'
                        }`}
                      >
                        <span className="truncate">{layer.name}</span>
                        <span className="shrink-0 ml-2 tabular-nums">
                          {layer.clips.length}
                          {layer.muted ? ' · M' : ''}
                          {layer.locked ? ' · L' : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="w-full mt-2" onClick={() => addLayer('video')}>
                    <Layers size={14} className="mr-1" /> Video layer
                  </Button>
                  <Button size="sm" variant="outline" className="w-full mt-1" onClick={() => addLayer('overlay')}>
                    <Layers size={14} className="mr-1" /> Overlay layer
                  </Button>
                  <Button size="sm" variant="outline" className="w-full mt-1" onClick={() => addLayer('audio')}>
                    <Layers size={14} className="mr-1" /> Audio layer
                  </Button>
                  {selectedLayerId && (
                    <div className="flex gap-1 mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-[10px]"
                        onClick={() => toggleLayerMute(selectedLayerId)}
                      >
                        Mute
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-[10px]"
                        onClick={() => toggleLayerLock(selectedLayerId)}
                      >
                        Lock
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-[10px]"
                        onClick={() => removeLayer(selectedLayerId)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>

                {selected && (
                  <div className="rounded border border-border p-2 space-y-1 text-xs">
                    <p className="font-medium">Selected clip</p>
                    <p className="text-muted truncate">{selected.asset.name}</p>
                    <p className="text-muted capitalize">{selected.layer.type} · {selected.layer.name}</p>
                    <p>Start: {formatTime(selected.clip.timelineStartMs)}</p>
                    <p>Duration: {formatTime(clipDurationMs(selected.clip))}</p>
                    <p>In: {formatTime(selected.clip.sourceInMs)} · Out: {formatTime(selected.clip.sourceOutMs)}</p>
                  </div>
                )}

                {selected?.asset.type === 'audio' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => void useAudioForTiming()}
                    >
                      Use for video timing
                    </Button>
                    <VideoAudioSilencePanel
                      clipId={selected.clip.id}
                      assetPath={selected.asset.path}
                      onError={setError}
                    />
                  </>
                )}

                <div className="text-[10px] text-muted space-y-1">
                  <p className="font-medium text-foreground/80">Keyboard shortcuts</p>
                  <p>Ctrl+B — split · Del — delete</p>
                  <p>Ctrl+Z / Ctrl+Shift+Z — undo / redo</p>
                  <p>Ctrl+C / V / D — copy / paste / duplicate</p>
                  <p>Space — play · ←/→ — frame step</p>
                  <p>Shift+←/→ — 10 frames · Home/End — start/end</p>
                  <p>↑/↓ — tracks · M — marker · Ctrl+S — save · Ctrl+E — export</p>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setShortcutsOpen(true)}
                  >
                    View all shortcuts…
                  </button>
                </div>

                {error && <p className="text-xs text-red-400">{error}</p>}
              </div>
            )}
          </div>
          {error && inspectorTab === 'export' && (
            <p className="text-xs text-red-400 px-3 pb-3 shrink-0">{error}</p>
          )}
        </aside>
      </div>

      <Dialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Keyboard Shortcuts (Desktop)">
        <p className="text-xs text-muted mb-2 font-medium">Editing</p>
        <DialogRow label="Split clip at playhead" keys="Ctrl/Cmd + B" />
        <DialogRow label="Delete selected clip" keys="Delete / Backspace" />
        <DialogRow label="Undo / Redo" keys="Ctrl/Cmd + Z / Ctrl/Cmd + Shift + Z" />
        <DialogRow label="Copy / Paste" keys="Ctrl/Cmd + C / Ctrl/Cmd + V" />
        <DialogRow label="Duplicate" keys="Ctrl/Cmd + D" />
        <p className="text-xs text-muted mt-4 mb-2 font-medium">Playback</p>
        <DialogRow label="Play / Pause" keys="Space" />
        <DialogRow label="Step frame back / forward" keys="← / →" />
        <DialogRow label="Jump multiple frames" keys="Shift + ← / →" />
        <DialogRow label="Jump to start / end" keys="Home / End" />
        <p className="text-xs text-muted mt-4 mb-2 font-medium">Timeline navigation</p>
        <DialogRow label="Zoom timeline in / out" keys="Ctrl/Cmd + Scroll or + / −" />
        <DialogRow label="Move between tracks" keys="↑ / ↓" />
        <p className="text-xs text-muted mt-4 mb-2 font-medium">Markers / Tools</p>
        <DialogRow label="Add marker at playhead" keys="M" />
        <DialogRow label="Save project" keys="Ctrl/Cmd + S" />
        <DialogRow label="Open export settings" keys="Ctrl/Cmd + E" />
      </Dialog>
    </div>
  )
}
