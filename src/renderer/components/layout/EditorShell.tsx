import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { Timeline } from '../timeline/Timeline'
import { TransportBar } from '../transport/TransportBar'
import { DetectionPanel } from '../inspector/DetectionPanel'
import { ExportPanel } from '../inspector/ExportPanel'
import { InspectorTabs, type InspectorTab } from '../inspector/InspectorTabs'
import { Dialog, DialogRow } from '../common/Dialog'
import { useEditorStore } from '@renderer/stores/editorStore'
import { usePlaybackStore } from '@renderer/stores/playbackStore'
import { useAudioPlayer, useKeyboardShortcuts } from '@renderer/hooks/useKeyboardShortcuts'
import { localAudioPathUrl } from '@renderer/lib/localFileProtocol'

export function EditorShell({ embedded = false }: { embedded?: boolean }): React.JSX.Element {
  const playerRef = useAudioPlayer()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('silence')

  const setMetadata = useEditorStore((s) => s.setMetadata)
  const setPeaks = useEditorStore((s) => s.setPeaks)
  const setLoading = useEditorStore((s) => s.setLoading)
  const setError = useEditorStore((s) => s.setError)
  const addRecentFile = useEditorStore((s) => s.addRecentFile)
  const resetProject = useEditorStore((s) => s.resetProject)
  const operations = useEditorStore((s) => s.operations)
  const regions = useEditorStore((s) => s.regions)
  const params = useEditorStore((s) => s.params)
  const exportFormat = useEditorStore((s) => s.exportFormat)
  const exportBitrate = useEditorStore((s) => s.exportBitrate)
  const previewNonSilence = useEditorStore((s) => s.previewNonSilence)
  const metadata = useEditorStore((s) => s.metadata)

  const setPlayheadMs = usePlaybackStore((s) => s.setPlayheadMs)
  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const playheadMs = usePlaybackStore((s) => s.playheadMs)

  const loadFile = useCallback(
    async (filePath: string) => {
      if (!window.electronAPI) return
      setLoading(true, 'Decoding audio…')
      setError(null)
      try {
        resetProject()
        const project = await window.electronAPI.loadAudio(filePath)
        setMetadata(project.metadata)
        setPeaks(project.peaks)
        addRecentFile(filePath)

        const previewUrl = localAudioPathUrl(project.metadata.previewPath)
        const player = playerRef.current
        if (player) {
          await player.loadFromUrl(previewUrl)
        }
        setPlayheadMs(0)
      } catch (err) {
        setError(String(err))
      } finally {
        setLoading(false)
      }
    },
    [playerRef, setMetadata, setPeaks, setLoading, setError, addRecentFile, resetProject, setPlayheadMs]
  )

  const handleOpen = useCallback(async () => {
    const path = await window.electronAPI?.openFile()
    if (path) await loadFile(path)
  }, [loadFile])

  const handleExport = useCallback(async () => {
    if (!window.electronAPI) return
    const metadata = useEditorStore.getState().metadata
    if (!metadata) return

    const defaultName = metadata.fileName.replace(/\.[^.]+$/, `_edited.${exportFormat}`)
    const outputPath = await window.electronAPI.saveFile(defaultName)
    if (!outputPath) return

    let ops = operations
    if (ops.length === 0) {
      ops = regions
        .filter((r) => !r.removed)
        .map((r) => ({
          id: r.id,
          type: 'remove' as const,
          startMs: r.startMs,
          endMs: r.endMs
        }))
    }

    setLoading(true, 'Exporting…')
    try {
      await window.electronAPI.exportAudio(
        ops,
        {
          outputPath,
          format: exportFormat,
          bitrateKbps: exportFormat === 'mp3' ? exportBitrate : undefined
        },
        params.crossfadeMs
      )
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [operations, regions, params.crossfadeMs, exportFormat, exportBitrate, setLoading, setError])

  useKeyboardShortcuts(playerRef, handleOpen, handleExport)

  useEffect(() => {
    const unsubs = [
      window.electronAPI?.onMenuOpen(handleOpen),
      window.electronAPI?.onMenuExport(handleExport),
      window.electronAPI?.onMenuUndo(() => useEditorStore.getState().undo()),
      window.electronAPI?.onMenuRedo(() => useEditorStore.getState().redo()),
      window.electronAPI?.onShowShortcuts(() => setShortcutsOpen(true))
    ]
    return () => unsubs.forEach((u) => u?.())
  }, [handleOpen, handleExport])

  useEffect(() => {
    if (!previewNonSilence || !isPlaying) return
    const active = regions.filter((r) => !r.removed)
    const inside = active.find((r) => playheadMs >= r.startMs && playheadMs < r.endMs - 20)
    if (inside) {
      playerRef.current?.seek(inside.endMs)
      setPlayheadMs(inside.endMs)
    }
  }, [playheadMs, previewNonSilence, isPlaying, regions, playerRef, setPlayheadMs])

  const handlePlayPause = (): void => {
    const player = playerRef.current
    if (!player) return
    if (isPlaying) {
      player.pause()
      setIsPlaying(false)
    } else {
      player.play(usePlaybackStore.getState().playheadMs)
      setIsPlaying(true)
    }
  }

  const handleStop = (): void => {
    playerRef.current?.stop()
    setIsPlaying(false)
    setPlayheadMs(0)
  }

  const handleSeek = useCallback(
    (ms: number) => {
      if (usePlaybackStore.getState().isPlaying) {
        playerRef.current?.seek(ms)
      }
    },
    [playerRef]
  )

  return (
    <div className={embedded ? 'flex-1 flex flex-col min-h-0 bg-background text-foreground' : 'h-screen flex flex-col bg-background text-foreground'}>
      {!embedded && (
        <header className="h-10 border-b border-border flex items-center px-4 shrink-0 bg-card">
          <span className="font-semibold text-sm tracking-tight">Silence Editor</span>
          <span className="ml-2 text-[10px] text-muted uppercase">AI Silence Removal</span>
        </header>
      )}

      <div className="flex-1 flex min-h-0">
        <Sidebar onOpenFile={handleOpen} onDropFile={loadFile} />

        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <Timeline onSeek={handleSeek} />
          <TransportBar onPlayPause={handlePlayPause} onStop={handleStop} />
        </main>

        <aside className="w-72 border-l border-border bg-card flex flex-col shrink-0 min-h-0">
          <InspectorTabs active={inspectorTab} onChange={setInspectorTab} editorOnly />
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {inspectorTab === 'silence' && <DetectionPanel />}
            {inspectorTab === 'export' && <ExportPanel onExport={handleExport} />}
          </div>
        </aside>
      </div>

      <Dialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Keyboard Shortcuts">
        <DialogRow label="Play / Pause" keys="Space" />
        <DialogRow label="Stop" keys="Escape" />
        <DialogRow label="Split at playhead" keys="S / Ctrl+B" />
        <DialogRow label="Delete selection" keys="Delete" />
        <DialogRow label="Undo / Redo" keys="Ctrl+Z / Ctrl+Shift+Z" />
        <DialogRow label="Open / Export" keys="Ctrl+O / Ctrl+E" />
        <DialogRow label="Prev / Next silence" keys="[ / ]" />
        <DialogRow label="Zoom in / out" keys="Ctrl+ + / Ctrl+ -" />
        <DialogRow label="Loop selection" keys="L" />
        <DialogRow label="Go to start / end" keys="Home / End" />
        <DialogRow label="Select region" keys="Alt + Drag" />
        <DialogRow label="Pan timeline" keys="Shift + Drag" />
      </Dialog>
    </div>
  )
}
