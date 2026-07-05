import { Button } from '../common/Button'
import { Label } from '../common/Label'
import { Select } from '../common/Select'
import { useEditorStore } from '@renderer/stores/editorStore'

interface ExportPanelProps {
  onExport: () => void
}

export function ExportPanel({ onExport }: ExportPanelProps): React.JSX.Element {
  const metadata = useEditorStore((s) => s.metadata)
  const operations = useEditorStore((s) => s.operations)
  const params = useEditorStore((s) => s.params)
  const loading = useEditorStore((s) => s.loading)
  const format = useEditorStore((s) => s.exportFormat)
  const bitrate = useEditorStore((s) => s.exportBitrate)
  const setExportFormat = useEditorStore((s) => s.setExportFormat)
  const setExportBitrate = useEditorStore((s) => s.setExportBitrate)

  const hasEdits = operations.length > 0

  return (
    <div className="border-t border-border p-4 flex flex-col gap-3">
      <h3 className="font-semibold text-base">Export</h3>

      <div>
        <Label>Format</Label>
        <Select
          value={format}
          onChange={setExportFormat}
          options={[
            { value: 'wav', label: 'WAV (lossless)' },
            { value: 'mp3', label: 'MP3' },
            { value: 'flac', label: 'FLAC' }
          ]}
        />
      </div>

      {format === 'mp3' && (
        <div>
          <Label>Bitrate ({bitrate} kbps)</Label>
          <input
            type="range"
            min={128}
            max={320}
            step={32}
            value={bitrate}
            onChange={(e) => setExportBitrate(parseInt(e.target.value, 10))}
            className="w-full accent-primary"
          />
        </div>
      )}

      <p className="text-xs text-muted">
        Crossfade: {params.crossfadeMs} ms · {hasEdits ? `${operations.length} cut(s)` : 'No cuts applied yet'}
      </p>

      <Button onClick={onExport} disabled={!metadata || loading} className="w-full">
        Export Audio (Ctrl+E)
      </Button>
    </div>
  )
}
