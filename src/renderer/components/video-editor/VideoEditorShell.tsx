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
import { VideoTimeline, localMediaUrl } from './VideoTimeline'
import { VideoAudioSilencePanel } from './VideoAudioSilencePanel'
import { useVideoEditorStore } from '@renderer/stores/videoEditorStore'
import { usePlaybackStore } from '@renderer/stores/playbackStore'
import { useVideoEditorHotkeys } from '@renderer/hooks/useVideoEditorHotkeys'
import { clipDurationMs } from '@shared/types'
import { formatTime } from '@renderer/lib/utils'
import { localAudioPathUrl } from '@renderer/lib/localFileProtocol'
import {
  allowFileDrop,
  filePathFromDrop,
  mediaFilesFromDataTransfer
} from '@renderer/lib/dropFiles'

export function VideoEditorShell({ embedded = false }: { embedded?: boolean }): React.JSX.Element {
  const project = useVideoEditorStore((s) => s.project)
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
  const visualClipAtPlayhead = useVideoEditorStore((s) => s.visualClipAtPlayhead)
  const audioClipAtPlayhead = useVideoEditorStore((s) => s.audioClipAtPlayhead)

  useVideoEditorHotkeys()

  const playheadMs = usePlaybackStore((s) => s.playheadMs)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const setPlayheadMs = usePlaybackStore((s) => s.setPlayheadMs)
  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying)
  const zoomIn = usePlaybackStore((s) => s.zoomIn)
  const zoomOut = usePlaybackStore((s) => s.zoomOut)

  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const rafRef = useRef<number | null>(null)
  const lastTick = useRef<number>(0)
  const [error, setError] = useState<string | null>(null)
  const [dragOverBin, setDragOverBin] = useState(false)
  const [importing, setImporting] = useState(false)

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

          addClipToLayer(asset.id, layerId)
          imported++
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          setError(lastError)
        }
      }

      setImporting(false)
      if (imported === 0 && paths.length > 0) {
        setError(lastError ?? 'Could not import the selected file(s). Check format and try again.')
      }
    },
    [addAsset, addClipToLayer, addLayer]
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
      const files = mediaFilesFromDataTransfer(e.dataTransfer)
      if (files.length === 0) {
        setError('Drop a video, image, or audio file here.')
        return
      }
      for (const file of files) {
        await importDroppedFile(file)
      }
    },
    [importDroppedFile]
  )

  const active = visualClipAtPlayhead(playheadMs)
  const audioActive = audioClipAtPlayhead(playheadMs)

  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      event.preventDefault()
    }
    document.addEventListener('dragover', onDragOver)
    return () => document.removeEventListener('dragover', onDragOver)
  }, [])

  useEffect(() => {
    if (!active) return
    const { clip, asset } = active
    const sourceMs = clip.sourceInMs + (playheadMs - clip.timelineStartMs)
    if (asset.type === 'video' && videoRef.current) {
      const el = videoRef.current
      if (Math.abs(el.currentTime * 1000 - sourceMs) > 120) {
        el.currentTime = sourceMs / 1000
      }
      if (isPlaying) {
        void el.play().catch(() => {})
      } else {
        el.pause()
      }
    }
  }, [active, playheadMs, isPlaying])

  useEffect(() => {
    if (!audioActive || !audioRef.current) return
    const { clip, asset } = audioActive
    const sourceMs = clip.sourceInMs + (playheadMs - clip.timelineStartMs)
    const el = audioRef.current
    const src = localAudioPathUrl(asset.path)
    if (el.src !== src) {
      el.src = src
    }
    if (Math.abs(el.currentTime * 1000 - sourceMs) > 120) {
      el.currentTime = sourceMs / 1000
    }
  }, [audioActive, playheadMs])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (isPlaying && audioActive) {
      void el.play().catch(() => {})
    } else {
      el.pause()
    }
  }, [isPlaying, audioActive])

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }
    lastTick.current = performance.now()
    const tick = (now: number): void => {
      const delta = now - lastTick.current
      lastTick.current = now
      const ms = usePlaybackStore.getState().playheadMs
      const next = ms + delta
      if (next >= durationMs) {
        setIsPlaying(false)
        setPlayheadMs(durationMs)
      } else {
        setPlayheadMs(next)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [isPlaying, durationMs, setPlayheadMs, setIsPlaying])

  const addToTimeline = useCallback(
    (assetId: string) => {
      addClipToLayer(assetId)
    },
    [addClipToLayer]
  )

  const handleExport = useCallback(async () => {
    const outputPath = await window.electronAPI?.saveFile('export.mp4')
    if (!outputPath || !window.electronAPI?.exportVideoSequence) return
    try {
      await window.electronAPI.exportVideoSequence({
        assets: project.assets,
        layers: project.layers,
        outputPath
      })
    } catch (err) {
      setError(String(err))
    }
  }, [project.assets, project.layers])

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
            <span className="font-semibold text-sm">Media bin</span>
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
            <p className="text-[10px] text-muted">Drop media files here</p>
          </div>
          {error && <p className="text-xs text-red-400 px-2">{error}</p>}
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {project.assets.length === 0 && (
              <p className="text-[10px] text-muted px-1">
                Import or drop clips — they are added to the timeline automatically.
              </p>
            )}
            {project.assets.map((asset) => (
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
            <audio ref={audioRef} className="hidden" />
            {active ? (
              active.asset.type === 'video' ? (
                <video
                  ref={videoRef}
                  key={active.asset.id}
                  src={localMediaUrl(active.asset.path, active.asset.type)}
                  className="max-h-full max-w-full"
                  muted
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
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={zoomOut}>
              <ZoomOut size={14} />
            </Button>
            <Button size="sm" variant="outline" onClick={zoomIn}>
              <ZoomIn size={14} />
            </Button>
            <Button size="sm" variant="outline" onClick={splitClipAtPlayhead}>
              <Scissors size={14} className="mr-1" /> Split
            </Button>
            <Button size="sm" variant="outline" onClick={deleteSelectedClip}>
              <Trash2 size={14} />
            </Button>
            <Button size="sm" onClick={() => void handleExport()}>
              Export
            </Button>
          </div>

          <div className="relative flex-1 min-h-[180px] max-h-[45%]">
            <VideoTimeline />
          </div>
        </main>

        <aside className="w-64 border-l border-border bg-card p-3 space-y-4 shrink-0 overflow-y-auto">
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
            <VideoAudioSilencePanel
              clipId={selected.clip.id}
              assetPath={selected.asset.path}
              onError={setError}
            />
          )}

          <div className="text-[10px] text-muted space-y-1">
            <p>S / B — split all layers at playhead</p>
            <p>Del / Backspace — delete clip</p>
            <p>Space — play / pause</p>
            <p>Ctrl+Z — undo · Ctrl+Shift+Z — redo</p>
            <p>Drag clip edges to trim</p>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </aside>
      </div>
    </div>
  )
}
